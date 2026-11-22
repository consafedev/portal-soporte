import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from '../../apps/api/src/auth/argon2-password-hasher.js';
import { LimitadorIntentosPostgres } from '../../apps/api/src/auth/attempt-limiter.js';
import { ServicioAutenticacionCore } from '../../apps/api/src/auth/auth-service.js';
import { ServicioRecuperacionAuth } from '../../apps/api/src/auth/recovery-service.js';
import { ServicioSesion } from '../../apps/api/src/auth/session-service.js';
import { cargarConfiguracionAuth } from '../../apps/api/src/config.js';
import { ServicioPreferenciasUsuario } from '../../packages/core/src/preferences/service.js';
import { RepositorioPreferenciasUsuarioPostgres } from '../../apps/api/src/preferences/postgres-user-preferences-repository.js';
import { PostgresAuthRepository } from '../../apps/api/src/auth/postgres-auth-repository.js';
import { ServicioAccesoCliente } from '../../apps/api/src/clients/client-access-service.js';
import { PostgresClientAccessRepository } from '../../apps/api/src/clients/postgres-client-access-repository.js';
import { ServicioClientesPortal } from '../../apps/api/src/clients/client-management-service.js';
import { PostgresClientRepository } from '../../apps/api/src/clients/postgres-client-repository.js';
import { ServicioPerfilesConexion } from '../../apps/api/src/clients/connection-profile-service.js';
import { RepositorioPerfilesConexionPostgres } from '../../apps/api/src/clients/postgres-connection-profile-repository.js';
import { crearServidorAuth } from '../../apps/api/src/server.js';
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';
import {
  auditEvents,
  clientCapabilities,
  clientConnectionProfiles,
  clientSapEnvironments,
  clientUserAssignments,
  clients,
  users,
} from '../../apps/api/src/db/schema.js';
import type { RelojAuth } from '../../packages/core/src/auth/ports.js';
import type { ClientConnectionBroker } from '../../packages/core/src/clients/secret-custody-ports.js';
import { PoliticaDestinosConexion } from '../../packages/connectors/src/mysql-connection-broker.js';
import { ServicioCifradoSecretos } from '../../packages/connectors/src/secret-envelope.js';
import {
  crearClienteMigradorPruebas,
  crearIdentificadoresSolicitudPrueba,
} from '../support/test-database-clients.js';

const urlBase = process.env['TEST_DATABASE_URL'];
const database =
  urlBase === undefined
    ? null
    : crearClienteBaseDatosAuth({ DATABASE_URL: urlBase, NODE_ENV: 'test' });
const databaseMigrador = crearClienteMigradorPruebas();
const identificadoresSolicitud = crearIdentificadoresSolicitudPrueba();
const idAdmin = randomUUID();
const idSupport = randomUUID();
const idSupportConcurrente = randomUUID();
const idCliente = randomUUID();
const idClienteAjeno = randomUUID();
const idAmbiente = randomUUID();
const idAmbienteAjeno = randomUUID();
const idPerfil = randomUUID();
const idPerfilAjeno = randomUUID();
const sufijo = randomUUID().slice(0, 10);
const usernameAdmin = `access_admin_${sufijo}`;
const usernameSupport = `access_support_${sufijo}`;
const usernameSupportConcurrente = `access_support_race_${sufijo}`;
const contrasenaSintetica = 'Contrasena sintética para integración 2026!';
const origen = 'http://127.0.0.1:3000';
const ahora = new Date();
let aplicacion: Awaited<ReturnType<typeof crearServidorAuth>> | null = null;
let cookieAdmin: string | null = null;
let cookieSupport: string | null = null;
let tokenSesionSupport: string | null = null;
const claveCustodiaSintetica = randomBytes(32);

/** Reloj fijo para crear sesiones y auditoría dentro de la integración aislada. */
const reloj: RelojAuth = {
  /** Devuelve el instante estable de inicio de la prueba. */
  ahora(): Date {
    return new Date(ahora);
  },
};

/** Devuelve la conexión verificada del rol de aplicación de la base de pruebas. */
function exigirBasePrueba(): NonNullable<typeof database> {
  if (database === null) {
    throw new Error('La prueba requiere PostgreSQL real y aislado.');
  }

  return database;
}

/** Devuelve el cliente migrador, reservado a la preparación y limpieza de fixtures. */
function exigirBaseMigrador(): NonNullable<typeof databaseMigrador> {
  if (databaseMigrador === null) {
    throw new Error('La limpieza requiere el rol migrador de pruebas.');
  }

  return databaseMigrador;
}

/** Extrae el valor de cookie solicitado sin imprimir la credencial en la salida del test. */
function leerCookie(
  respuesta: { headers: { readonly 'set-cookie'?: unknown } },
  nombre: string,
): string {
  const setCookie = respuesta.headers['set-cookie'];
  const cookies =
    typeof setCookie === 'string'
      ? [setCookie]
      : Array.isArray(setCookie)
        ? setCookie.filter((valor): valor is string => typeof valor === 'string')
        : [];
  const cookie = cookies.find((valor) => valor.startsWith(`${nombre}=`))?.split(';', 1)[0];
  if (cookie === undefined) {
    throw new Error('La respuesta omitió una cookie de prueba requerida.');
  }

  return cookie;
}

/** Obtiene un token CSRF y su cookie compañera para una sola escritura de prueba. */
async function obtenerCsrf(): Promise<{ readonly token: string; readonly cookie: string }> {
  const respuesta = await exigirAplicacion().inject({
    method: 'GET',
    url: '/api/v1/auth/csrf',
  });
  return {
    token: respuesta.json<{ token: string }>().token,
    cookie: leerCookie(respuesta, 'portal_test_csrf'),
  };
}

/** Genera cabeceras same-origin con CSRF para una mutación de la integración. */
async function headersDeEscritura(cookieSesion: string): Promise<Record<string, string>> {
  const csrf = await obtenerCsrf();
  return {
    origin: origen,
    'sec-fetch-site': 'same-origin',
    'x-csrf-token': csrf.token,
    cookie: `${cookieSesion}; ${csrf.cookie}`,
  };
}

/** Recupera Fastify inicializado por la preparación de la suite. */
function exigirAplicacion(): Awaited<ReturnType<typeof crearServidorAuth>> {
  if (aplicacion === null) {
    throw new Error('La aplicación de acceso por cliente no está inicializada.');
  }

  return aplicacion;
}

/** Cifra credenciales ficticias para que las rutas prueben únicamente el DTO redactado. */
function crearCifradorSintetico(): ServicioCifradoSecretos {
  return new ServicioCifradoSecretos({
    /** Emite una copia mutable efímera de la llave de fixture. */
    async obtenerActiva() {
      return { id: 'fixture-v1', material: Buffer.from(claveCustodiaSintetica) };
    },
    /** Recupera únicamente la versión sintética de esta ejecución. */
    async obtener(id: string) {
      if (id !== 'fixture-v1') {
        throw new Error('KEY_VERSION_UNAVAILABLE');
      }
      return { id, material: Buffer.from(claveCustodiaSintetica) };
    },
  });
}

/** Inserta dos cuentas activas sintéticas y prepara clientes, ambientes y perfiles de prueba. */
async function prepararFixtures(): Promise<void> {
  const base = exigirBasePrueba();
  const hasheador = new Argon2PasswordHasher();
  const hash = await hasheador.hash(contrasenaSintetica);
  await base
    .insert(users)
    .values([
      crearUsuarioFixture(idAdmin, usernameAdmin, 'ADMIN', hash),
      crearUsuarioFixture(idSupport, usernameSupport, 'SUPPORT', hash),
      crearUsuarioFixture(idSupportConcurrente, usernameSupportConcurrente, 'SUPPORT', hash),
    ]);
  await base.insert(clients).values([
    {
      id: idCliente,
      displayName: `Cliente autorizado ${sufijo}`,
      status: 'ACTIVE',
      createdByUserId: idAdmin,
    },
    {
      id: idClienteAjeno,
      displayName: `Cliente ajeno ${sufijo}`,
      status: 'ACTIVE',
      createdByUserId: idAdmin,
    },
  ]);
  await base.insert(clientSapEnvironments).values([
    { id: idAmbiente, clientId: idCliente, code: 'QA', displayName: 'Pruebas autorizadas' },
    { id: idAmbienteAjeno, clientId: idClienteAjeno, code: 'PRD', displayName: 'Ambiente ajeno' },
  ]);
  await base
    .insert(clientConnectionProfiles)
    .values([
      crearPerfilFixture(idPerfil, idCliente, 'Perfil autorizado'),
      crearPerfilFixture(idPerfilAjeno, idClienteAjeno, 'Perfil ajeno'),
    ]);

  const repositorioAuth = new PostgresAuthRepository(base);
  const sesiones = new ServicioSesion(repositorioAuth, reloj);
  const cookieSesionAdmin = await sesiones.crear(idAdmin);
  const cookieSesionSupport = await sesiones.crear(idSupport);
  tokenSesionSupport = cookieSesionSupport.token;
  const autenticacion = new ServicioAutenticacionCore(
    repositorioAuth,
    hasheador,
    sesiones,
    repositorioAuth,
    reloj,
  );
  const limitador = new LimitadorIntentosPostgres(base, randomBytes(32));
  const recuperacion = new ServicioRecuperacionAuth({
    repositorio: repositorioAuth,
    hasheador,
    correo: { async enviar() {} },
    correoHabilitado: false,
    limitador,
    auditoria: repositorioAuth,
    sesiones,
    reloj,
    publicAppOrigin: origen,
  });
  const brokerSintetico: ClientConnectionBroker = {
    /** No abre conexiones externas; este escenario solo prueba lecturas del catálogo. */
    async probar(_perfil, secretos) {
      secretos.fill(0);
      return { code: 'MYSQL_CONNECTION_FAILED', completedAt: reloj.ahora() };
    },
    /** Impide abrir una conexión externa accidental en estas pruebas de autorización. */
    async abrirLecturaRf1(): Promise<never> {
      throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
    },
    async abrirInsercionRf1(): Promise<never> {
      throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
    },
  };
  const perfiles = new ServicioPerfilesConexion(
    new RepositorioPerfilesConexionPostgres(base),
    crearCifradorSintetico(),
    brokerSintetico,
    new PoliticaDestinosConexion([], []),
    reloj,
  );
  const preferencias = new ServicioPreferenciasUsuario(
    new RepositorioPreferenciasUsuarioPostgres(base),
  );
  aplicacion = await crearServidorAuth({
    configuracion: cargarConfiguracionAuth({
      NODE_ENV: 'test',
      PUBLIC_APP_ORIGIN: origen,
      API_INTERNAL_ORIGIN: 'http://127.0.0.1:4000',
    }),
    autenticacion,
    sesiones,
    auditoria: repositorioAuth,
    reloj,
    limitador,
    recuperacion,
    clientes: new ServicioClientesPortal(new PostgresClientRepository(base), reloj),
    perfilesConexion: perfiles,
    accesoClientes: new ServicioAccesoCliente(new PostgresClientAccessRepository(base)),
    preferencias,
    generarIdSolicitud: identificadoresSolicitud.generar,
  });
  cookieAdmin = `portal_test_session=${cookieSesionAdmin.token}`;
  cookieSupport = `portal_test_session=${cookieSesionSupport.token}`;
}

/** Construye el registro activo mínimo que exige la tabla de usuarios. */
function crearUsuarioFixture(
  id: string,
  username: string,
  role: 'ADMIN' | 'SUPPORT',
  passwordHash: string,
) {
  const correo = `${username}@example.test`;
  return {
    id,
    username,
    usernameNormalized: username,
    displayName: `${role} sintético`,
    email: correo,
    emailNormalized: correo,
    emailVerifiedAt: ahora,
    passwordHash,
    role,
    status: 'ACTIVE' as const,
  };
}

/** Construye un perfil con sobre sintético que las rutas nunca deben devolver. */
function crearPerfilFixture(id: string, clientId: string, displayName: string) {
  return {
    id,
    clientId,
    displayName,
    profileType: 'MYSQL_TCP' as const,
    environment: 'TEST' as const,
    destinationId: 'mysql-fixture',
    gatewayId: null,
    databaseName: 'fixture_db',
    secretEnvelope: {
      version: 1 as const,
      algoritmo: 'AES-256-GCM' as const,
      idClave: 'fixture-v1',
      nonceClave: 'bm9uY2UtY2xhdmU=',
      claveDatosEnvuelta: 'Y2xhdmU=',
      tagClave: 'dGFnLWNsYXZl',
      nonceDato: 'bm9uY2UtZGF0bw==',
      datoCifrado: 'c2VjcmV0by1zaW50ZXRpY28=',
      tagDato: 'dGFnLWRhdG8=',
    },
    status: 'ACTIVE' as const,
    createdByUserId: idAdmin,
  };
}

/** Cierra la app y elimina solo las filas de fixture creadas por este archivo. */
async function limpiarFixtures(): Promise<void> {
  await aplicacion?.close();
  claveCustodiaSintetica.fill(0);
  const migrador = exigirBaseMigrador();
  await migrador
    .delete(auditEvents)
    .where(
      sql`${auditEvents.metadata}->>'requestId' LIKE ${`${identificadoresSolicitud.prefijo}-%`}`,
    );
  await migrador
    .delete(auditEvents)
    .where(or(eq(auditEvents.actorUserId, idAdmin), eq(auditEvents.actorUserId, idSupport)));
  await migrador
    .delete(clientUserAssignments)
    .where(inArray(clientUserAssignments.clientId, [idCliente, idClienteAjeno]));
  await migrador
    .delete(clientCapabilities)
    .where(inArray(clientCapabilities.clientId, [idCliente, idClienteAjeno]));
  await migrador
    .delete(clientConnectionProfiles)
    .where(inArray(clientConnectionProfiles.id, [idPerfil, idPerfilAjeno]));
  await migrador
    .delete(clientSapEnvironments)
    .where(inArray(clientSapEnvironments.id, [idAmbiente, idAmbienteAjeno]));
  await migrador.delete(clients).where(inArray(clients.id, [idCliente, idClienteAjeno]));
  await migrador.delete(users).where(inArray(users.id, [idAdmin, idSupport, idSupportConcurrente]));
  await migrador.$client.end({ timeout: 5 });
  await exigirBasePrueba().$client.end({ timeout: 5 });
}

/** Ejecuta pruebas HTTP reales con PostgreSQL de pruebas, cookies opacas y CSRF. */
describe('rutas de acceso por cliente sobre PostgreSQL aislado', () => {
  beforeAll(prepararFixtures);
  afterAll(limpiarFixtures);

  it('ADMIN consulta asignaciones y capacidades con DTOs redactados', async () => {
    const respuesta = await exigirAplicacion().inject({
      method: 'GET',
      url: `/api/v1/admin/clients/${idCliente}/access`,
      headers: { cookie: cookieAdmin ?? '' },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({
      asignaciones: [],
      capacidades: [
        { clientId: idCliente, capabilityId: 'rf-1:read', enabled: false, changedAt: null },
        { clientId: idCliente, capabilityId: 'rf-1:execute', enabled: false, changedAt: null },
      ],
    });
  });

  it('exige CSRF, registra cambios atómicos y evita concesiones activas duplicadas', async () => {
    const sinCsrf = await exigirAplicacion().inject({
      method: 'PUT',
      url: `/api/v1/admin/clients/${idCliente}/capabilities/rf-1%3Aread`,
      headers: { origin: origen, cookie: cookieAdmin ?? '' },
      payload: { enabled: true },
    });
    const capacidad = await exigirAplicacion().inject({
      method: 'PUT',
      url: `/api/v1/admin/clients/${idCliente}/capabilities/rf-1%3Aread`,
      headers: await headersDeEscritura(cookieAdmin ?? ''),
      payload: { enabled: true },
    });
    const concesion = await exigirAplicacion().inject({
      method: 'PUT',
      url: `/api/v1/admin/clients/${idCliente}/access/users/${idSupport}`,
      headers: await headersDeEscritura(cookieAdmin ?? ''),
    });
    const duplicada = await exigirAplicacion().inject({
      method: 'PUT',
      url: `/api/v1/admin/clients/${idCliente}/access/users/${idSupport}`,
      headers: await headersDeEscritura(cookieAdmin ?? ''),
    });
    const asignaciones = await exigirAplicacion().inject({
      method: 'GET',
      url: `/api/v1/admin/clients/${idCliente}/access`,
      headers: { cookie: cookieAdmin ?? '' },
    });
    const cuerpo = asignaciones.json<{
      asignaciones: readonly { userId: string; userActive: boolean; revokedAt: null }[];
      capacidades: readonly { capabilityId: string; enabled: boolean }[];
    }>();
    const eventos = await exigirBaseMigrador()
      .select({ action: auditEvents.action, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorUserId, idAdmin),
          sql`${auditEvents.metadata}->>'requestId' LIKE ${`${identificadoresSolicitud.prefijo}-%`}`,
        ),
      );

    expect(sinCsrf.statusCode).toBe(403);
    expect(capacidad.statusCode).toBe(204);
    expect(concesion.statusCode).toBe(204);
    expect(duplicada.statusCode).toBe(409);
    expect(cuerpo.asignaciones).toEqual([
      expect.objectContaining({ userId: idSupport, userActive: true, revokedAt: null }),
    ]);
    expect(cuerpo.capacidades).toContainEqual(
      expect.objectContaining({ capabilityId: 'rf-1:read', enabled: true }),
    );
    expect(eventos.map((evento) => evento.action)).toEqual(
      expect.arrayContaining(['CLIENT_ACCESS_GRANTED', 'CLIENT_CAPABILITY_UPDATED']),
    );
    expect(
      eventos.some((evento) => JSON.stringify(evento.metadata).includes(contrasenaSintetica)),
    ).toBe(false);
  });

  it('SUPPORT lista solo clientes asignados, ambientes y perfiles redactados', async () => {
    const cookie = cookieSupport ?? '';
    const clientesAccesibles = await exigirAplicacion().inject({
      method: 'GET',
      url: '/api/v1/clients',
      headers: { cookie },
    });
    const ambientes = await exigirAplicacion().inject({
      method: 'GET',
      url: `/api/v1/clients/${idCliente}/sap-environments`,
      headers: { cookie },
    });
    const perfiles = await exigirAplicacion().inject({
      method: 'GET',
      url: `/api/v1/clients/${idCliente}/connection-profiles`,
      headers: { cookie },
    });
    const jsonPerfiles = JSON.stringify(perfiles.json());

    expect(clientesAccesibles.statusCode).toBe(200);
    expect(clientesAccesibles.json()).toEqual([expect.objectContaining({ id: idCliente })]);
    expect(ambientes.statusCode).toBe(200);
    expect(ambientes.json()).toEqual([
      expect.objectContaining({ id: idAmbiente, clientId: idCliente }),
    ]);
    expect(perfiles.statusCode).toBe(200);
    expect(perfiles.json()).toEqual([
      expect.objectContaining({ id: idPerfil, clientId: idCliente }),
    ]);
    expect(jsonPerfiles).not.toContain('secretEnvelope');
    expect(jsonPerfiles).not.toContain('datoCifrado');
    expect(jsonPerfiles).not.toContain('destinoMySqlId');
    expect(jsonPerfiles).not.toContain('gatewaySshId');
    expect(jsonPerfiles).not.toContain('databaseName');
  });

  it('serializa concesiones concurrentes y conserva una sola asignación activa', async () => {
    const respuestas = await Promise.all(
      Array.from({ length: 2 }, async () =>
        exigirAplicacion().inject({
          method: 'PUT',
          url: `/api/v1/admin/clients/${idCliente}/access/users/${idSupportConcurrente}`,
          headers: await headersDeEscritura(cookieAdmin ?? ''),
        }),
      ),
    );
    const resultado = respuestas.map((respuesta) => respuesta.statusCode).sort((a, b) => a - b);
    const filas = await exigirBasePrueba()
      .select({ id: clientUserAssignments.id })
      .from(clientUserAssignments)
      .where(
        and(
          eq(clientUserAssignments.clientId, idCliente),
          eq(clientUserAssignments.userId, idSupportConcurrente),
          sql`${clientUserAssignments.revokedAt} IS NULL`,
        ),
      );

    expect(resultado).toEqual([204, 409]);
    expect(filas).toHaveLength(1);
  });

  it('SUPPORT recibe 403 en administración y ante recursos de otro cliente', async () => {
    const cookie = cookieSupport ?? '';
    const admin = await exigirAplicacion().inject({
      method: 'GET',
      url: `/api/v1/admin/clients/${idCliente}/access`,
      headers: { cookie },
    });
    const clienteAjeno = await exigirAplicacion().inject({
      method: 'GET',
      url: `/api/v1/clients/${idClienteAjeno}/sap-environments`,
      headers: { cookie },
    });
    const perfilAjeno = await exigirAplicacion().inject({
      method: 'GET',
      url: `/api/v1/clients/${idCliente}/connection-profiles/${idPerfilAjeno}`,
      headers: { cookie },
    });
    const ambienteAjeno = await exigirAplicacion().inject({
      method: 'GET',
      url: `/api/v1/clients/${idCliente}/sap-environments/${idAmbienteAjeno}`,
      headers: { cookie },
    });
    const cambiarCapacidad = await exigirAplicacion().inject({
      method: 'PUT',
      url: `/api/v1/admin/clients/${idCliente}/capabilities/rf-1%3Aread`,
      headers: await headersDeEscritura(cookie),
      payload: { enabled: false },
    });

    expect(admin.statusCode).toBe(403);
    expect(clienteAjeno.statusCode).toBe(403);
    expect(perfilAjeno.statusCode).toBe(403);
    expect(ambienteAjeno.statusCode).toBe(403);
    expect(perfilAjeno.json()).toEqual(clienteAjeno.json());
    expect(ambienteAjeno.json()).toEqual(clienteAjeno.json());
    expect(cambiarCapacidad.statusCode).toBe(403);
  });

  it('ADMIN puede asignar rf-1:execute y la revocación rige con la misma sesión', async () => {
    const cookie = cookieSupport ?? '';
    const intentoHabilitarInserción = await exigirAplicacion().inject({
      method: 'PUT',
      url: `/api/v1/admin/clients/${idCliente}/capabilities/rf-1%3Aexecute`,
      headers: await headersDeEscritura(cookieAdmin ?? ''),
      payload: { enabled: true },
    });
    const antesDeRevocar = await exigirAplicacion().inject({
      method: 'GET',
      url: `/api/v1/clients/${idCliente}/connection-profiles`,
      headers: { cookie },
    });
    const deshabilitarLectura = await exigirAplicacion().inject({
      method: 'PUT',
      url: `/api/v1/admin/clients/${idCliente}/capabilities/rf-1%3Aread`,
      headers: await headersDeEscritura(cookieAdmin ?? ''),
      payload: { enabled: false },
    });
    const lecturaDeshabilitada = await exigirAplicacion().inject({
      method: 'GET',
      url: `/api/v1/clients/${idCliente}/connection-profiles`,
      headers: { cookie },
    });
    const habilitarLectura = await exigirAplicacion().inject({
      method: 'PUT',
      url: `/api/v1/admin/clients/${idCliente}/capabilities/rf-1%3Aread`,
      headers: await headersDeEscritura(cookieAdmin ?? ''),
      payload: { enabled: true },
    });
    const revocacion = await exigirAplicacion().inject({
      method: 'DELETE',
      url: `/api/v1/admin/clients/${idCliente}/access/users/${idSupport}`,
      headers: await headersDeEscritura(cookieAdmin ?? ''),
    });
    const despuesDeRevocar = await exigirAplicacion().inject({
      method: 'GET',
      url: `/api/v1/clients/${idCliente}/connection-profiles`,
      headers: { cookie },
    });

    expect(intentoHabilitarInserción.statusCode).toBe(204);
    expect(antesDeRevocar.statusCode).toBe(200);
    expect(deshabilitarLectura.statusCode).toBe(204);
    expect(lecturaDeshabilitada.statusCode).toBe(403);
    expect(habilitarLectura.statusCode).toBe(204);
    expect(revocacion.statusCode).toBe(204);
    expect(despuesDeRevocar.statusCode).toBe(403);
    expect(tokenSesionSupport).not.toBeNull();
  });
});
