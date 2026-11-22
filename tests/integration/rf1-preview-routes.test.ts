import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from '../../apps/api/src/auth/argon2-password-hasher.js';
import { LimitadorIntentosPostgres } from '../../apps/api/src/auth/attempt-limiter.js';
import { ServicioAutenticacionCore } from '../../apps/api/src/auth/auth-service.js';
import { ServicioRecuperacionAuth } from '../../apps/api/src/auth/recovery-service.js';
import { ServicioSesion } from '../../apps/api/src/auth/session-service.js';
import { cargarConfiguracionAuth } from '../../apps/api/src/config.js';
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';
import {
  auditEvents,
  clientCapabilities,
  clientConnectionProfiles,
  clientUserAssignments,
  clients,
  users,
} from '../../apps/api/src/db/schema.js';
import { ServicioAccesoCliente } from '../../apps/api/src/clients/client-access-service.js';
import { ServicioPerfilesConexion } from '../../apps/api/src/clients/connection-profile-service.js';
import { PostgresClientAccessRepository } from '../../apps/api/src/clients/postgres-client-access-repository.js';
import { RepositorioPerfilesConexionPostgres } from '../../apps/api/src/clients/postgres-connection-profile-repository.js';
import { ServicioVistaPreviaRf1 } from '../../apps/api/src/clients/rf1-preview-service.js';
import { PostgresAuthRepository } from '../../apps/api/src/auth/postgres-auth-repository.js';
import { ServicioPreferenciasUsuario } from '../../packages/core/src/preferences/service.js';
import type { SeleccionSociedadArchivoRf1Contrato } from '../../packages/contracts/src/clients.js';
import { RepositorioPreferenciasUsuarioPostgres } from '../../apps/api/src/preferences/postgres-user-preferences-repository.js';
import { crearServidorAuth } from '../../apps/api/src/server.js';
import type { RelojAuth } from '../../packages/core/src/auth/ports.js';
import type { ClientConnectionBroker } from '../../packages/core/src/clients/secret-custody-ports.js';
import { PoliticaDestinosConexion } from '../../packages/connectors/src/mysql-connection-broker.js';
import { ServicioCifradoSecretos } from '../../packages/connectors/src/secret-envelope.js';
import {
  crearClienteMigradorPruebas,
  crearIdentificadoresSolicitudPrueba,
} from '../support/test-database-clients.js';

const ORIGEN = 'http://127.0.0.1:3000';
const UUID_COMPROBANTE = '550e8400-e29b-41d4-a716-446655440000';
const URL_TEST_DATABASE = process.env['TEST_DATABASE_URL'];
const baseDatos =
  URL_TEST_DATABASE === undefined
    ? null
    : crearClienteBaseDatosAuth({ DATABASE_URL: URL_TEST_DATABASE, NODE_ENV: 'test' });
const baseDatosMigrador = crearClienteMigradorPruebas();
const idSolicitudPrueba = crearIdentificadoresSolicitudPrueba();
const idAdmin = randomUUID();
const idSupport = randomUUID();
const idSupportSinAsignacion = randomUUID();
const idCliente = randomUUID();
const idClienteAjeno = randomUUID();
const idPerfil = randomUUID();
const idPerfilAjeno = randomUUID();
const sufijo = randomUUID().slice(0, 10);
const horaFixture = new Date();
const contrasenaHashableSintetica = 'Password sintético no reutilizable 2026!';
const materialCustodiaSintetico = randomBytes(32);
let aplicacion: Awaited<ReturnType<typeof crearServidorAuth>> | null = null;
let cookieAdmin = '';
let cookieSupport = '';
let cookieSupportSinAsignacion = '';
let aperturasBroker = 0;
let cierresBroker = 0;
let catalogoFalla = false;
const operacionesBroker: string[] = [];
let sociedadesMultiples = false;
const consultasProveedor: {
  readonly rfcEmisor: string;
  readonly sociedad: string;
  readonly ambienteSap: string;
}[] = [];

/** Devuelve la hora fija que usan las sesiones y eventos de la integración aislada. */
const reloj: RelojAuth = {
  /** Proporciona el instante de creación de los fixtures sin confiar en datos de la petición. */
  ahora(): Date {
    return new Date(horaFixture);
  },
};

/** Devuelve la conexión verificada por el runner hacia portal_soporte_test. */
function exigirBasePrueba(): NonNullable<typeof baseDatos> {
  if (baseDatos === null) {
    throw new Error('La suite requiere el harness PostgreSQL remoto aislado.');
  }
  return baseDatos;
}

/** Devuelve el cliente migrador de pruebas para crear/limpiar filas con permisos acotados. */
function exigirBaseMigrador(): NonNullable<typeof baseDatosMigrador> {
  if (baseDatosMigrador === null) {
    throw new Error('No se configuró el rol migrador de portal_soporte_test.');
  }
  return baseDatosMigrador;
}

/** Recupera Fastify inicializado para las peticiones de integración. */
function exigirAplicacion(): Awaited<ReturnType<typeof crearServidorAuth>> {
  if (aplicacion === null) {
    throw new Error('El servidor de prueba de vista previa no está inicializado.');
  }
  return aplicacion;
}

/** Extrae el valor de cookie pedido sin imprimir ni comparar el token en mensajes de error. */
function leerCookie(
  respuesta: { readonly headers: { readonly 'set-cookie'?: unknown } },
  nombre: string,
): string {
  const encabezado = respuesta.headers['set-cookie'];
  const cookies =
    typeof encabezado === 'string'
      ? [encabezado]
      : Array.isArray(encabezado)
        ? encabezado.filter((valor): valor is string => typeof valor === 'string')
        : [];
  const valor = cookies.find((cookie) => cookie.startsWith(`${nombre}=`))?.split(';', 1)[0];
  if (valor === undefined) {
    throw new Error('La respuesta omitió una cookie de integración requerida.');
  }
  return valor;
}

/** Genera headers same-origin y cookie double-submit para una petición POST de prueba. */
async function encabezadosCsrf(cookieSesion?: string): Promise<Record<string, string>> {
  const respuesta = await exigirAplicacion().inject({
    method: 'GET',
    url: '/api/v1/auth/csrf',
  });
  const token = respuesta.json<{ readonly token: string }>().token;
  const cookieCsrf = leerCookie(respuesta, 'portal_test_csrf');
  return {
    origin: ORIGEN,
    'sec-fetch-site': 'same-origin',
    'x-csrf-token': token,
    cookie: [cookieSesion, cookieCsrf].filter((valor) => valor !== undefined).join('; '),
  };
}

/** Construye un CFDI 4.0 mínimo con datos fiscales completamente sintéticos. */
function crearXmlSintetico(overrides: Readonly<Record<string, string>> = {}): Buffer {
  const atributos = {
    Version: '4.0',
    TipoDeComprobante: 'I',
    Fecha: '2026-11-20T14:35:00',
    Moneda: 'MXN',
    SubTotal: '100.25',
    Total: '100.25',
    ...overrides,
  };
  const textoAtributos = Object.entries(atributos)
    .map(([nombre, valor]) => `${nombre}="${valor}"`)
    .join(' ');
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<c:Comprobante xmlns:c="http://www.sat.gob.mx/cfd/4" xmlns:t="http://www.sat.gob.mx/TimbreFiscalDigital" ${textoAtributos} Serie="A" Folio="12">
  <c:Emisor Rfc="AAA010101AAA"/><c:Receptor Rfc="BBB010101BBB"/>
  <c:Complemento><t:TimbreFiscalDigital UUID="${UUID_COMPROBANTE}"/></c:Complemento>
</c:Comprobante>`,
    'utf8',
  );
}

/** Serializa partes sintéticas sin interpretar ni reenviar nombre o metadatos del archivo.
 * @param archivos - XML completamente sintéticos para el lote aislado.
 * @param boundary - Separador multipart fijo de la prueba.
 * @param seleccionesSociedad - Pares sintéticos indexados que se enviarán opcionalmente.
 * @returns Separador y cuerpo multipart sin datos reales.
 */
function crearMultipart(
  archivos: readonly Buffer[],
  boundary = 'rf1-fixture-boundary',
  seleccionesSociedad?: readonly SeleccionSociedadArchivoRf1Contrato[],
): { readonly boundary: string; readonly payload: Buffer } {
  const partes: Buffer[] = [];
  for (const archivo of archivos) {
    partes.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="fixture.xml"\r\nContent-Type: application/xml\r\n\r\n`,
      ),
      archivo,
      Buffer.from('\r\n'),
    );
  }
  if (seleccionesSociedad !== undefined) {
    partes.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="seleccionesSociedad"\r\n\r\n${JSON.stringify(seleccionesSociedad)}\r\n`,
      ),
    );
  }
  partes.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, payload: Buffer.concat(partes) };
}

/** Envía un lote sintético con CSRF y devuelve la respuesta observada.
 * @param cookieSesion - Cookie de la cuenta sintética autorizada o `undefined`.
 * @param archivos - XML sintéticos del mismo lote.
 * @param profileId - Perfil perteneciente al cliente fixture.
 * @param seleccionesSociedad - Selecciones por índice opcionales del lote.
 * @returns Respuesta inyectada de Fastify, sin contactar clientes externos.
 */
async function enviarLote(
  cookieSesion: string | undefined,
  archivos: readonly Buffer[],
  profileId = idPerfil,
  seleccionesSociedad?: readonly SeleccionSociedadArchivoRf1Contrato[],
) {
  const { boundary, payload } = crearMultipart(
    archivos,
    'rf1-fixture-boundary',
    seleccionesSociedad,
  );
  return exigirAplicacion().inject({
    method: 'POST',
    url: `/api/v1/clients/${idCliente}/modules/rf-1/preview?profileId=${profileId}&estatus=CONTABILIZADO`,
    headers: {
      ...(await encabezadosCsrf(cookieSesion)),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

/** Crea el hash de fixture y devuelve una cuenta activa sin asociar datos personales reales. */
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
    displayName: `Usuario ${role} sintético`,
    email: correo,
    emailNormalized: correo,
    emailVerifiedAt: horaFixture,
    passwordHash,
    role,
    status: 'ACTIVE' as const,
  };
}

/** Cifra bytes sintéticos con AAD de cliente/perfil para validar el paso server-side de custodia. */
async function crearSobreSintetico(
  custodia: ServicioCifradoSecretos,
  clientId: string,
  profileId: string,
) {
  const paquete = Buffer.from(
    JSON.stringify({ mysqlUsername: 'usuario_fixture', mysqlPassword: 'secreto_sintetico' }),
    'utf8',
  );
  try {
    return await custodia.cifrar(paquete, {
      clientId,
      profileId,
      purpose: 'MYSQL_CREDENTIALS',
    });
  } finally {
    paquete.fill(0);
  }
}

/** Inserta cuentas, clientes, perfil, asignación/capacidad y arma el runtime sin red externa. */
async function prepararFixtures(): Promise<void> {
  const base = exigirBasePrueba();
  const hasheador = new Argon2PasswordHasher();
  const hash = await hasheador.hash(contrasenaHashableSintetica);
  await base
    .insert(users)
    .values([
      crearUsuarioFixture(idAdmin, `preview_admin_${sufijo}`, 'ADMIN', hash),
      crearUsuarioFixture(idSupport, `preview_support_${sufijo}`, 'SUPPORT', hash),
      crearUsuarioFixture(idSupportSinAsignacion, `preview_unassigned_${sufijo}`, 'SUPPORT', hash),
    ]);
  await base.insert(clients).values([
    {
      id: idCliente,
      displayName: `Cliente RF1 fixture ${sufijo}`,
      status: 'ACTIVE',
      createdByUserId: idAdmin,
    },
    {
      id: idClienteAjeno,
      displayName: `Cliente RF1 ajeno ${sufijo}`,
      status: 'ACTIVE',
      createdByUserId: idAdmin,
    },
  ]);

  const keyring = new ServicioCifradoSecretos({
    /** Entrega una copia nueva de material sintético y no conserva buffers descifrados. */
    async obtenerActiva() {
      return { id: 'rf1-fixture-v1', material: Buffer.from(materialCustodiaSintetico) };
    },
    /** Devuelve solo la versión sintética que pertenece a esta suite. */
    async obtener(id: string) {
      if (id !== 'rf1-fixture-v1') {
        throw new Error('KEY_VERSION_UNAVAILABLE');
      }
      return { id, material: Buffer.from(materialCustodiaSintetico) };
    },
  });
  const sobrePropio = await crearSobreSintetico(keyring, idCliente, idPerfil);
  const sobreAjeno = await crearSobreSintetico(keyring, idClienteAjeno, idPerfilAjeno);
  await base
    .insert(clientConnectionProfiles)
    .values([
      crearPerfilFixture(idPerfil, idCliente, idAdmin, sobrePropio),
      crearPerfilFixture(idPerfilAjeno, idClienteAjeno, idAdmin, sobreAjeno),
    ]);
  await base.insert(clientUserAssignments).values({
    id: randomUUID(),
    clientId: idCliente,
    userId: idSupport,
    grantedByUserId: idAdmin,
    grantedAt: horaFixture,
  });
  await base.insert(clientCapabilities).values({
    clientId: idCliente,
    capabilityId: 'rf-1:read',
    enabled: true,
    changedByUserId: idAdmin,
    changedAt: horaFixture,
  });

  const repositorioAuth = new PostgresAuthRepository(base);
  const sesiones = new ServicioSesion(repositorioAuth, reloj);
  const inicioAdmin = await sesiones.crear(idAdmin);
  const inicioSupport = await sesiones.crear(idSupport);
  const inicioSupportSinAsignacion = await sesiones.crear(idSupportSinAsignacion);
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
    publicAppOrigin: ORIGEN,
  });
  const brokerSintetico: ClientConnectionBroker = {
    /** El broker de fixture no conecta; borra el paquete y devuelve un código seguro. */
    async probar(_perfil, secretos) {
      secretos.fill(0);
      return { code: 'MYSQL_CONNECTION_FAILED', completedAt: reloj.ahora() };
    },
    /** Entrega únicamente tres lecturas sintéticas tipadas y nunca admite SQL del request. */
    async abrirLecturaRf1(_perfil, secretos, senal) {
      secretos.fill(0);
      if (senal.aborted) {
        throw new Error('RF1_SESSION_ABORTED');
      }
      aperturasBroker += 1;
      return {
        /** Simula una consulta SELECT por RFC receptor, sin acceder a una base externa. */
        async buscarSociedadesPorRfc() {
          operacionesBroker.push('SELECT SOCIEDADES');
          if (catalogoFalla) throw new Error('detalle_driver_sintetico_no_publicable');
          return sociedadesMultiples
            ? [
                { sociedad: '1000', ambienteSap: 'ERP-QA' },
                { sociedad: '2000', ambienteSap: 'ERP-DEV' },
              ]
            : [{ sociedad: '1000', ambienteSap: 'E1P' }];
        },
        /** Simula lectura por RFC proveedor, sociedad y ambiente SAP sintéticos. */
        async buscarProveedoresPorContexto(rfcEmisor, sociedad, ambienteSap) {
          operacionesBroker.push('SELECT PROVEEDORES');
          consultasProveedor.push({ rfcEmisor, sociedad, ambienteSap });
          if (catalogoFalla) throw new Error('detalle_driver_sintetico_no_publicable');
          return [{ idProveedor: 'PROV-FIXTURE' }];
        },
        /** Simula una consulta de existencia UUID; nunca devuelve fila ni modifica datos. */
        async existeUuid() {
          operacionesBroker.push('SELECT UUID');
          if (catalogoFalla) throw new Error('detalle_driver_sintetico_no_publicable');
          return false;
        },
        /** Cierra la sesión de red sintética para comprobar limpieza en cada resultado. */
        async cerrar() {
          cierresBroker += 1;
        },
      };
    },
  };
  const acceso = new ServicioAccesoCliente(new PostgresClientAccessRepository(base));
  const perfiles = new ServicioPerfilesConexion(
    new RepositorioPerfilesConexionPostgres(base),
    keyring,
    brokerSintetico,
    new PoliticaDestinosConexion(
      [
        {
          id: 'mysql-fixture',
          hostname: 'mysql-fixture.example.test',
          address: '127.0.0.1',
          port: 3306,
        },
      ],
      [],
    ),
    reloj,
  );
  const preferencias = new ServicioPreferenciasUsuario(
    new RepositorioPreferenciasUsuarioPostgres(base),
  );
  aplicacion = await crearServidorAuth({
    configuracion: cargarConfiguracionAuth({
      NODE_ENV: 'test',
      PUBLIC_APP_ORIGIN: ORIGEN,
      API_INTERNAL_ORIGIN: 'http://127.0.0.1:4000',
    }),
    autenticacion,
    sesiones,
    auditoria: repositorioAuth,
    reloj,
    limitador,
    recuperacion,
    preferencias,
    accesoClientes: acceso,
    perfilesConexion: perfiles,
    vistaPreviaRf1: new ServicioVistaPreviaRf1(acceso, perfiles, repositorioAuth, reloj),
    generarIdSolicitud: idSolicitudPrueba.generar,
  });
  cookieAdmin = `portal_test_session=${inicioAdmin.token}`;
  cookieSupport = `portal_test_session=${inicioSupport.token}`;
  cookieSupportSinAsignacion = `portal_test_session=${inicioSupportSinAsignacion.token}`;
}

/** Construye un perfil con un sobre cifrado de fixture que nunca se devuelve por la API. */
function crearPerfilFixture(
  id: string,
  clientId: string,
  creador: string,
  sobre: Awaited<ReturnType<ServicioCifradoSecretos['cifrar']>>,
) {
  return {
    id,
    clientId,
    displayName: `Perfil sintético ${id.slice(0, 8)}`,
    profileType: 'MYSQL_TCP' as const,
    environment: 'TEST' as const,
    destinationId: 'mysql-fixture',
    gatewayId: null,
    databaseName: 'fixture_db',
    secretEnvelope: sobre,
    status: 'ACTIVE' as const,
    createdByUserId: creador,
  };
}

/** Cierra Fastify y elimina exclusivamente las filas UUID de esta suite. */
async function limpiarFixtures(): Promise<void> {
  await aplicacion?.close();
  aplicacion = null;
  const migrador = exigirBaseMigrador();
  await migrador
    .delete(auditEvents)
    .where(sql`${auditEvents.metadata}->>'requestId' LIKE ${`${idSolicitudPrueba.prefijo}-%`}`);
  await migrador
    .delete(auditEvents)
    .where(inArray(auditEvents.actorUserId, [idAdmin, idSupport, idSupportSinAsignacion]));
  await migrador
    .delete(clientUserAssignments)
    .where(inArray(clientUserAssignments.clientId, [idCliente, idClienteAjeno]));
  await migrador
    .delete(clientCapabilities)
    .where(inArray(clientCapabilities.clientId, [idCliente, idClienteAjeno]));
  await migrador
    .delete(clientConnectionProfiles)
    .where(inArray(clientConnectionProfiles.id, [idPerfil, idPerfilAjeno]));
  await migrador.delete(clients).where(inArray(clients.id, [idCliente, idClienteAjeno]));
  await migrador
    .delete(users)
    .where(inArray(users.id, [idAdmin, idSupport, idSupportSinAsignacion]));
  materialCustodiaSintetico.fill(0);
  await migrador.$client.end({ timeout: 5 });
  await exigirBasePrueba().$client.end({ timeout: 5 });
}

describe('vista previa RF-1 con autorización y PostgreSQL aislado', () => {
  beforeAll(prepararFixtures);
  afterAll(limpiarFixtures);

  it('permite a ADMIN con cliente/capacidad activos obtener una preview read-only', async () => {
    const respuesta = await enviarLote(cookieAdmin, [crearXmlSintetico()]);
    const resultado = respuesta.json<readonly { status: string; resolution: unknown }[]>();

    expect(respuesta.statusCode).toBe(200);
    expect(resultado).toHaveLength(1);
    expect(resultado[0]).toMatchObject({
      status: 'READY',
      resolution: { sociedad: '1000', ambienteSap: 'E1P', idProveedor: 'PROV-FIXTURE' },
    });
    expect(JSON.stringify(resultado)).not.toContain('secretEnvelope');
    expect(JSON.stringify(resultado)).not.toContain('mysqlPassword');
  });

  it('permite a SUPPORT asignado y con rf-1:read obtener preview', async () => {
    const respuesta = await enviarLote(cookieSupport, [crearXmlSintetico()]);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json<readonly { status: string }[]>()[0]?.status).toBe('READY');
  });

  it('revalida y usa el par sociedad/ambiente elegido para buscar proveedor', async () => {
    sociedadesMultiples = true;
    const xml = crearXmlSintetico();
    try {
      const pendiente = await enviarLote(cookieSupport, [xml]);
      expect(pendiente.json()[0]).toMatchObject({
        status: 'NEEDS_SELECTION',
        sociedadesDisponibles: [
          { sociedad: '1000', ambienteSap: 'ERP-QA' },
          { sociedad: '2000', ambienteSap: 'ERP-DEV' },
        ],
      });

      const respuesta = await enviarLote(cookieSupport, [xml], idPerfil, [
        { indiceArchivo: 0, sociedad: '2000', ambienteSap: 'ERP-DEV' },
      ]);

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json()[0]).toMatchObject({
        status: 'READY',
        resolution: { sociedad: '2000', ambienteSap: 'ERP-DEV', idProveedor: 'PROV-FIXTURE' },
      });
      expect(consultasProveedor.at(-1)).toEqual({
        rfcEmisor: 'AAA010101AAA',
        sociedad: '2000',
        ambienteSap: 'ERP-DEV',
      });
    } finally {
      sociedadesMultiples = false;
    }
  });

  it('rechaza índices repetidos o fuera del lote antes de abrir el broker', async () => {
    const aperturasAntes = aperturasBroker;
    const archivo = crearXmlSintetico();
    const fueraDelLote = await enviarLote(cookieAdmin, [archivo], idPerfil, [
      { indiceArchivo: 1, sociedad: '1000', ambienteSap: 'E1P' },
    ]);
    const indiceDuplicado = await enviarLote(cookieAdmin, [archivo], idPerfil, [
      { indiceArchivo: 0, sociedad: '1000', ambienteSap: 'E1P' },
      { indiceArchivo: 0, sociedad: '2000', ambienteSap: 'ERP-DEV' },
    ]);

    expect(fueraDelLote.statusCode).toBe(400);
    expect(fueraDelLote.json()).toMatchObject({ code: 'MULTIPART_SELECTION_INVALID' });
    expect(indiceDuplicado.statusCode).toBe(400);
    expect(indiceDuplicado.json()).toMatchObject({ code: 'MULTIPART_SELECTION_INVALID' });
    expect(aperturasBroker).toBe(aperturasAntes);
  });

  it('bloquea una sociedad/ambiente falsificado que no devolvió el catálogo', async () => {
    sociedadesMultiples = true;
    const consultasAntes = consultasProveedor.length;
    try {
      const respuesta = await enviarLote(cookieAdmin, [crearXmlSintetico()], idPerfil, [
        { indiceArchivo: 0, sociedad: '9999', ambienteSap: 'ERP-DEV' },
      ]);

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json()[0]).toMatchObject({
        status: 'BLOCKED',
        errorCode: 'RF1_CONTEXT_MISMATCH',
      });
      expect(consultasProveedor).toHaveLength(consultasAntes);
    } finally {
      sociedadesMultiples = false;
    }
  });

  it('exige sesión vigente antes de procesar el multipart', async () => {
    const aperturasAntes = aperturasBroker;
    const respuesta = await enviarLote(undefined, [crearXmlSintetico()]);

    expect(respuesta.statusCode).toBe(401);
    expect(aperturasBroker).toBe(aperturasAntes);
  });

  it('exige CSRF para el POST aunque la sesión esté autenticada', async () => {
    const aperturasAntes = aperturasBroker;
    const { boundary, payload } = crearMultipart([crearXmlSintetico()]);
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: `/api/v1/clients/${idCliente}/modules/rf-1/preview?profileId=${idPerfil}&estatus=PAGADA`,
      headers: { cookie: cookieAdmin, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });

    expect(respuesta.statusCode).toBe(403);
    expect(aperturasBroker).toBe(aperturasAntes);
  });

  it('deniega SUPPORT sin asignación vigente antes de abrir el broker', async () => {
    const aperturasAntes = aperturasBroker;
    const respuesta = await enviarLote(cookieSupportSinAsignacion, [crearXmlSintetico()]);

    expect(respuesta.statusCode).toBe(403);
    expect(aperturasBroker).toBe(aperturasAntes);
  });

  it('deniega un perfil de otro cliente antes de descifrar su sobre', async () => {
    const aperturasAntes = aperturasBroker;
    const respuesta = await enviarLote(cookieSupport, [crearXmlSintetico()], idPerfilAjeno);

    expect(respuesta.statusCode).toBe(403);
    expect(aperturasBroker).toBe(aperturasAntes);
  });

  it('requiere rf-1:read también para ADMIN y observa el cambio inmediato', async () => {
    const base = exigirBasePrueba();
    const aperturasAntes = aperturasBroker;
    await base
      .update(clientCapabilities)
      .set({ enabled: false })
      .where(
        and(
          eq(clientCapabilities.clientId, idCliente),
          eq(clientCapabilities.capabilityId, 'rf-1:read'),
        ),
      );
    const denegada = await enviarLote(cookieAdmin, [crearXmlSintetico()]);
    await base
      .update(clientCapabilities)
      .set({ enabled: true })
      .where(
        and(
          eq(clientCapabilities.clientId, idCliente),
          eq(clientCapabilities.capabilityId, 'rf-1:read'),
        ),
      );

    expect(denegada.statusCode).toBe(403);
    expect(aperturasBroker).toBe(aperturasAntes);
  });

  it('requiere que el cliente esté activo incluso para ADMIN', async () => {
    const base = exigirBasePrueba();
    const aperturasAntes = aperturasBroker;
    await base.update(clients).set({ status: 'DISABLED' }).where(eq(clients.id, idCliente));
    const respuesta = await enviarLote(cookieAdmin, [crearXmlSintetico()]);
    await base.update(clients).set({ status: 'ACTIVE' }).where(eq(clients.id, idCliente));

    expect(respuesta.statusCode).toBe(403);
    expect(aperturasBroker).toBe(aperturasAntes);
  });

  it('requiere perfil activo y propio antes de abrir la custodia', async () => {
    const base = exigirBasePrueba();
    const aperturasAntes = aperturasBroker;
    await base
      .update(clientConnectionProfiles)
      .set({ status: 'DISABLED' })
      .where(eq(clientConnectionProfiles.id, idPerfil));
    const respuesta = await enviarLote(cookieSupport, [crearXmlSintetico()]);
    await base
      .update(clientConnectionProfiles)
      .set({ status: 'ACTIVE' })
      .where(eq(clientConnectionProfiles.id, idPerfil));

    expect(respuesta.statusCode).toBe(403);
    expect(aperturasBroker).toBe(aperturasAntes);
  });

  it('observa revocación de SUPPORT en la siguiente solicitud con la misma sesión', async () => {
    const base = exigirBasePrueba();
    const migrador = exigirBaseMigrador();
    const [asignacion] = await migrador
      .select({ id: clientUserAssignments.id })
      .from(clientUserAssignments)
      .where(
        and(
          eq(clientUserAssignments.clientId, idCliente),
          eq(clientUserAssignments.userId, idSupport),
          isNull(clientUserAssignments.revokedAt),
        ),
      );
    if (asignacion === undefined) throw new Error('Falta la asignación sintética de SUPPORT.');

    const aperturasAntes = aperturasBroker;
    await base
      .update(clientUserAssignments)
      .set({ revokedByUserId: idAdmin, revokedAt: reloj.ahora() })
      .where(eq(clientUserAssignments.id, asignacion.id));
    const respuesta = await enviarLote(cookieSupport, [crearXmlSintetico()]);
    await base
      .update(clientUserAssignments)
      .set({ revokedByUserId: null, revokedAt: null })
      .where(eq(clientUserAssignments.id, asignacion.id));

    expect(respuesta.statusCode).toBe(403);
    expect(aperturasBroker).toBe(aperturasAntes);
  });

  it('devuelve un resultado seguro para XML malformado y cierra la sesión de lectura', async () => {
    const aperturasAntes = aperturasBroker;
    const cierresAntes = cierresBroker;
    const consultasAntes = operacionesBroker.length;
    const respuesta = await enviarLote(cookieAdmin, [Buffer.from('<comprobante', 'utf8')]);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json<readonly { status: string; errorCode?: string }[]>()).toEqual([
      expect.objectContaining({ status: 'BLOCKED', errorCode: 'XML_MALFORMED' }),
    ]);
    expect(aperturasBroker).toBe(aperturasAntes + 1);
    expect(cierresBroker).toBe(cierresAntes + 1);
    expect(operacionesBroker).toHaveLength(consultasAntes);
  });

  it('rechaza más de 100 archivos sin abrir el perfil', async () => {
    const aperturasAntes = aperturasBroker;
    const respuesta = await enviarLote(
      cookieAdmin,
      Array.from({ length: 101 }, () => Buffer.from('<x/>')),
    );

    expect(respuesta.statusCode).toBe(413);
    expect(aperturasBroker).toBe(aperturasAntes);
  });

  it('rechaza un archivo mayor que 5 MiB sin abrir el perfil', async () => {
    const aperturasAntes = aperturasBroker;
    const respuesta = await enviarLote(cookieAdmin, [Buffer.alloc(5 * 1024 * 1024 + 1, 0x20)]);

    expect(respuesta.statusCode).toBe(413);
    expect(aperturasBroker).toBe(aperturasAntes);
  });

  it('rechaza más de 25 MiB agregados aunque cada archivo cumpla su límite', async () => {
    const aperturasAntes = aperturasBroker;
    const archivos = [
      Buffer.alloc(5 * 1024 * 1024, 0x20),
      Buffer.alloc(5 * 1024 * 1024, 0x20),
      Buffer.alloc(5 * 1024 * 1024, 0x20),
      Buffer.alloc(5 * 1024 * 1024, 0x20),
      Buffer.alloc(5 * 1024 * 1024, 0x20),
      Buffer.from('x'),
    ];
    const respuesta = await enviarLote(cookieAdmin, archivos);

    expect(respuesta.statusCode).toBe(413);
    expect(aperturasBroker).toBe(aperturasAntes);
  });

  it('responde con error controlado ante un multipart truncado', async () => {
    const encabezados = await encabezadosCsrf(cookieAdmin);
    const boundary = 'rf1-truncated-boundary';
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: `/api/v1/clients/${idCliente}/modules/rf-1/preview?profileId=${idPerfil}&estatus=PAGADA`,
      headers: {
        ...encabezados,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="truncated.xml"\r\nContent-Type: application/xml\r\n\r\n<root>`,
        'utf8',
      ),
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.body).not.toContain('stack');
  });

  it('bloquea el mismo UUID repetido dentro del lote', async () => {
    const respuesta = await enviarLote(cookieAdmin, [crearXmlSintetico(), crearXmlSintetico()]);
    const resultados = respuesta.json<readonly { status: string; errorCode?: string }[]>();

    expect(respuesta.statusCode).toBe(200);
    expect(resultados.map((resultado) => resultado.status)).toEqual(['READY', 'BLOCKED']);
    expect(resultados[1]?.errorCode).toBe('RF1_DUPLICATE_UUID');
  });

  it('devuelve error de catálogo redactado sin filtrar detalle de driver', async () => {
    catalogoFalla = true;
    const respuesta = await enviarLote(cookieAdmin, [crearXmlSintetico()]);
    catalogoFalla = false;

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json<readonly { status: string; errorCode?: string }[]>()).toEqual([
      expect.objectContaining({ status: 'BLOCKED', errorCode: 'RF1_CATALOG_UNAVAILABLE' }),
    ]);
    expect(respuesta.body).not.toContain('detalle_driver_sintetico_no_publicable');
  });

  it('audita preview sin XML, nombre de archivo, hashes ni secretos', async () => {
    const eventos = await exigirBaseMigrador()
      .select({ action: auditEvents.action, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(inArray(auditEvents.actorUserId, [idAdmin, idSupport, idSupportSinAsignacion]));
    const auditoria = JSON.stringify(eventos);

    expect(eventos.map((evento) => evento.action)).toContain('RF1_PREVIEW_COMPLETED');
    expect(eventos.map((evento) => evento.action)).toContain('RF1_PREVIEW_DENIED');
    expect(auditoria).not.toContain('<c:Comprobante');
    expect(auditoria).not.toContain('fixture.xml');
    expect(auditoria).not.toContain('secretEnvelope');
    expect(auditoria).not.toContain('secreto_sintetico');
    expect(auditoria).not.toContain(contrasenaHashableSintetica);
  });

  it('no publica una ruta de ejecución de facturas', async () => {
    const encabezados = await encabezadosCsrf(cookieAdmin);
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: `/api/v1/clients/${idCliente}/modules/rf-1/execute`,
      headers: encabezados,
      payload: {},
    });

    expect(respuesta.statusCode).toBe(404);
  });

  it('solo invoca lecturas tipadas y cierra las sesiones abiertas', async () => {
    expect(operacionesBroker.length).toBeGreaterThan(0);
    expect(operacionesBroker.every((operacion) => operacion.startsWith('SELECT '))).toBe(true);
    expect(cierresBroker).toBe(aperturasBroker);
  });
});
