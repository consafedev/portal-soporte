import { randomUUID } from 'node:crypto';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicioAutenticacionCore } from '../../apps/api/src/auth/auth-service.js';
import { Argon2PasswordHasher } from '../../apps/api/src/auth/argon2-password-hasher.js';
import { ServicioUsuariosAdmin } from '../../apps/api/src/auth/admin-user-service.js';
import { LimitadorIntentosPostgres } from '../../apps/api/src/auth/attempt-limiter.js';
import { ErrorRepositorioUsuariosAdmin } from '../../packages/core/src/auth/admin-ports.js';
import { PostgresAuthRepository } from '../../apps/api/src/auth/postgres-auth-repository.js';
import { ServicioSesion } from '../../apps/api/src/auth/session-service.js';
import { ServicioRecuperacionAuth } from '../../apps/api/src/auth/recovery-service.js';
import { ServicioClientesPortal } from '../../apps/api/src/clients/client-management-service.js';
import { PostgresClientRepository } from '../../apps/api/src/clients/postgres-client-repository.js';
import { cargarConfiguracionAuth } from '../../apps/api/src/config.js';
import { crearServidorAuth } from '../../apps/api/src/server.js';
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';
import {
  auditEvents,
  authThrottleWindows,
  clientSapEnvironments,
  clients,
  recoveryTokens,
  sessions,
  users,
} from '../../apps/api/src/db/schema.js';
import type { MensajeCorreoAuth, RelojAuth } from '../../packages/core/src/auth/ports.js';
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
const sufijo = randomUUID().slice(0, 8);
const usuarioAdmin = `admin_${sufijo}`;
const usuarioSupport = `support_${sufijo}`;
const contrasenaSintetica = 'Clave admin sintética Unicode ñ';
let contrasenaActualSupport = contrasenaSintetica;
const origen = 'http://127.0.0.1:3000';
const ahora = new Date();
// La cabecera Expires de la cookie expresa solo segundos completos.
ahora.setUTCMilliseconds(0);
let instanteAuth = new Date(ahora);
/** Reloj estable para persistir sesiones y auditoría dentro de las pruebas. */
const reloj: RelojAuth = {
  /** Devuelve una copia del instante controlado por la prueba de renovación de cookie. */
  ahora(): Date {
    return new Date(instanteAuth);
  },
};
/** Tipo inferido de la aplicación para comprobar las rutas sin abrir un socket. */
type AplicacionAdmin = Awaited<ReturnType<typeof crearServidorAuth>>;

let aplicacion: AplicacionAdmin | null = null;
let servicioAdmin: ServicioUsuariosAdmin | null = null;
let cookieAdmin: string | null = null;
let cookieSupport: string | null = null;
let idNuevoUsuario: string | null = null;
let idClientePrueba: string | null = null;
let limitadorAdmin: LimitadorIntentosPostgres | null = null;
let fallarCorreoAdmin = false;
const idsUsuariosCreados: string[] = [];
const idsClientesCreados: string[] = [];
const mensajesAdmin: MensajeCorreoAuth[] = [];

/** Recupera el único PostgreSQL efímero de la suite o falla de forma explícita. */
function exigirBasePrueba(): NonNullable<typeof database> {
  if (database === null) {
    throw new Error('La suite administrativa requiere PostgreSQL real aislado.');
  }

  return database;
}

/** Recupera el migrador exclusivo para consultar auditoría o preparar DDL de fixtures. */
function exigirBaseMigrador(): NonNullable<typeof databaseMigrador> {
  if (databaseMigrador === null) {
    throw new Error('La operación requiere el rol migrador de PostgreSQL de prueba.');
  }

  return databaseMigrador;
}

/** Inserta un usuario activo sintético con hash Argon2id para autenticar flujos HTTP. */
async function insertarUsuarioActivo(
  id: string,
  username: string,
  role: 'ADMIN' | 'SUPPORT',
  hasheador: Argon2PasswordHasher,
): Promise<void> {
  const correo = `${username}@example.test`;
  await exigirBasePrueba()
    .insert(users)
    .values({
      id,
      username,
      usernameNormalized: username,
      displayName: `${role} sintético`,
      email: correo,
      emailNormalized: correo,
      emailVerifiedAt: new Date(ahora),
      passwordHash: await hasheador.hash(contrasenaSintetica),
      role,
      status: 'ACTIVE',
    });
}

/** Extrae una cookie de Set-Cookie para el cliente de inyección sin imprimir su valor. */
function leerCookie(
  respuesta: { headers: { readonly 'set-cookie'?: unknown } },
  nombre: string,
): string {
  const lista = respuesta.headers['set-cookie'];
  const cookies =
    typeof lista === 'string'
      ? [lista]
      : Array.isArray(lista)
        ? lista.filter((valor): valor is string => typeof valor === 'string')
        : [];
  const cookie = cookies.find((valor) => valor.startsWith(`${nombre}=`));
  const valor = cookie?.split(';', 1)[0];
  if (valor === undefined || valor.length === 0) {
    throw new Error('La respuesta de integración omitió una cookie requerida.');
  }

  return valor;
}

/** Extrae el token de prueba únicamente del fragmento del mensaje SMTP falso. */
function extraerTokenCorreo(mensaje: MensajeCorreoAuth): string {
  const parametros = new URLSearchParams(new URL(mensaje.enlace).hash.slice(1));
  const token = parametros.get('token');
  if (token === null) {
    throw new Error('El mensaje sintético no contiene el enlace esperado.');
  }

  return token;
}

/** Obtiene token CSRF y cookie homónima con una respuesta no cacheable. */
async function obtenerCsrf(): Promise<{ token: string; cookie: string }> {
  const respuesta = await exigirAplicacion().inject({
    method: 'GET',
    url: '/api/v1/auth/csrf',
  });
  const cuerpo = respuesta.json<{ token: string }>();

  return { token: cuerpo.token, cookie: leerCookie(respuesta, 'portal_test_csrf') };
}

/** Inicia una sesión de integración con la cuenta sintética identificada. */
async function iniciarSesion(
  username: string,
  password: string = contrasenaSintetica,
): Promise<string> {
  const csrf = await obtenerCsrf();
  const respuesta = await exigirAplicacion().inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: {
      origin: origen,
      'sec-fetch-site': 'same-origin',
      'x-csrf-token': csrf.token,
      cookie: csrf.cookie,
    },
    payload: { username, password },
  });
  expect(respuesta.statusCode).toBe(200);

  return leerCookie(respuesta, 'portal_test_session');
}

/** Construye headers de escritura same-origin con token CSRF y sesión opcional. */
async function headersDeEscritura(cookieSesion?: string) {
  const csrf = await obtenerCsrf();

  return {
    origin: origen,
    'sec-fetch-site': 'same-origin',
    'x-csrf-token': csrf.token,
    cookie: cookieSesion === undefined ? csrf.cookie : `${cookieSesion}; ${csrf.cookie}`,
  };
}

/** Devuelve la aplicación inicializada por el hook para ejecutar peticiones de test. */
function exigirAplicacion(): AplicacionAdmin {
  if (aplicacion === null) {
    throw new Error('La aplicación Fastify administrativa no está inicializada.');
  }

  return aplicacion;
}

/** Crea usuarios y registra la aplicación contra la base sintética aislada. */
async function prepararAdministracion(): Promise<void> {
  const hasheador = new Argon2PasswordHasher();
  await insertarUsuarioActivo(idAdmin, usuarioAdmin, 'ADMIN', hasheador);
  await insertarUsuarioActivo(idSupport, usuarioSupport, 'SUPPORT', hasheador);
  const repositorio = new PostgresAuthRepository(exigirBasePrueba());
  const sesionesAuth = new ServicioSesion(repositorio, reloj);
  const autenticacion = new ServicioAutenticacionCore(
    repositorio,
    hasheador,
    sesionesAuth,
    repositorio,
    reloj,
  );
  const usuariosAdmin = new ServicioUsuariosAdmin(repositorio, reloj, hasheador);
  const clientes = new ServicioClientesPortal(
    new PostgresClientRepository(exigirBasePrueba()),
    reloj,
  );
  const limitador = new LimitadorIntentosPostgres(exigirBasePrueba(), Buffer.alloc(32, 29));
  limitadorAdmin = limitador;
  const recuperacion = new ServicioRecuperacionAuth({
    repositorio,
    hasheador,
    correo: {
      /** Conserva mensajes falsos solo en memoria para inspeccionar propósito/destino. */
      async enviar(mensaje) {
        if (fallarCorreoAdmin) {
          throw new Error('Fallo SMTP sintético.');
        }
        mensajesAdmin.push(mensaje);
      },
    },
    correoHabilitado: true,
    limitador,
    auditoria: repositorio,
    sesiones: sesionesAuth,
    reloj,
    publicAppOrigin: origen,
  });
  servicioAdmin = usuariosAdmin;
  aplicacion = await crearServidorAuth({
    configuracion: cargarConfiguracionAuth({
      NODE_ENV: 'test',
      PUBLIC_APP_ORIGIN: origen,
      API_INTERNAL_ORIGIN: 'http://127.0.0.1:4000',
    }),
    autenticacion,
    sesiones: sesionesAuth,
    auditoria: repositorio,
    reloj,
    limitador,
    recuperacion,
    usuariosAdmin,
    clientes,
    generarIdSolicitud: identificadoresSolicitud.generar,
  });
  cookieAdmin = await iniciarSesion(usuarioAdmin);
  cookieSupport = await iniciarSesion(usuarioSupport);
}

/** Cierra el servidor y borra únicamente las filas de usuario de esta suite. */
async function cerrarAdministracion(): Promise<void> {
  await aplicacion?.close();
  const usuariosTemporales: string[] = [idAdmin, idSupport];
  usuariosTemporales.push(...idsUsuariosCreados);
  const migrador = databaseMigrador;
  if (migrador === null) {
    throw new Error('La limpieza requiere el rol migrador de PostgreSQL de prueba.');
  }
  await migrador
    .delete(auditEvents)
    .where(
      sql`${auditEvents.metadata}->>'requestId' LIKE ${`${identificadoresSolicitud.prefijo}-%`}`,
    );
  await migrador
    .delete(auditEvents)
    .where(
      or(
        inArray(auditEvents.actorUserId, usuariosTemporales),
        inArray(auditEvents.targetUserId, usuariosTemporales),
      ),
    );
  if (idsClientesCreados.length > 0) {
    await migrador
      .delete(clientSapEnvironments)
      .where(inArray(clientSapEnvironments.clientId, idsClientesCreados));
    await migrador.delete(clients).where(inArray(clients.id, idsClientesCreados));
  }
  await migrador.delete(users).where(inArray(users.id, usuariosTemporales));
  // El preflight exige que la base aislada empiece sin filas de throttling; se retira el conjunto sintético propio.
  await migrador.delete(authThrottleWindows);
  await migrador.$client.end({ timeout: 5 });
  await exigirBasePrueba().$client.end({ timeout: 5 });
}

/** Ejecuta requests administrativos con cookie de sesión y CSRF vigentes. */
function definirPruebasAdmin(): void {
  it('renueva el vencimiento de la cookie al extender una sesión por actividad', async () => {
    const cookie = cookieAdmin;
    if (cookie === null) {
      throw new Error('La prueba requiere la sesión ADMIN preparada.');
    }
    const instanteRenovado = new Date(ahora.getTime() + 20 * 60_000);
    instanteAuth = instanteRenovado;
    try {
      const respuesta = await exigirAplicacion().inject({
        method: 'GET',
        url: '/api/v1/admin/users',
        headers: { cookie },
      });
      const setCookie = respuesta.headers['set-cookie'];
      const cookies = Array.isArray(setCookie)
        ? setCookie.filter((valor): valor is string => typeof valor === 'string')
        : typeof setCookie === 'string'
          ? [setCookie]
          : [];
      const cookieRenovada = cookies.find((valor) => valor.startsWith('portal_test_session='));
      const fechaExpiracion = cookieRenovada?.match(/Expires=([^;]+)/u)?.[1];

      expect(respuesta.statusCode).toBe(200);
      expect(fechaExpiracion).toBeDefined();
      expect(new Date(fechaExpiracion ?? '').getTime()).toBe(
        instanteRenovado.getTime() + 30 * 60_000,
      );
    } finally {
      instanteAuth = new Date(ahora);
    }
  });
  it('devuelve 401 sin sesión y audita 403 para SUPPORT en rutas administrativas', async () => {
    const anónimo = await exigirAplicacion().inject({ method: 'GET', url: '/api/v1/admin/users' });
    const cookie = cookieSupport;
    if (cookie === null) {
      throw new Error('La prueba requiere la sesión SUPPORT preparada.');
    }
    const soporte = await exigirAplicacion().inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie },
    });
    const eventos = await exigirBaseMigrador()
      .select({ action: auditEvents.action, outcome: auditEvents.outcome })
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, idSupport));

    expect(anónimo.statusCode).toBe(401);
    expect(soporte.statusCode).toBe(403);
    expect(eventos).toContainEqual({ action: 'AUTHORIZATION_DENIED', outcome: 'DENIED' });
  });

  it('devuelve 403 a SUPPORT para todas las operaciones administrativas registradas', async () => {
    const cookie = cookieSupport;
    if (cookie === null) {
      throw new Error('La prueba requiere la sesión SUPPORT preparada.');
    }
    const operaciones = [
      {
        method: 'POST' as const,
        url: '/api/v1/admin/users',
        payload: {
          username: `deny_${sufijo}`,
          email: `deny_${sufijo}@example.test`,
          displayName: 'Denegada',
          role: 'SUPPORT',
        },
      },
      {
        method: 'PATCH' as const,
        url: `/api/v1/admin/users/${idSupport}`,
        payload: { displayName: 'No autorizada' },
      },
      {
        method: 'POST' as const,
        url: `/api/v1/admin/users/${idSupport}/sessions/revoke`,
      },
      {
        method: 'POST' as const,
        url: `/api/v1/admin/users/${idSupport}/reset`,
      },
      {
        method: 'POST' as const,
        url: `/api/v1/admin/users/${idSupport}/email-change`,
        payload: { newEmail: `deny_${sufijo}@example.test` },
      },
    ];

    for (const operacion of operaciones) {
      const respuesta = await exigirAplicacion().inject({
        ...operacion,
        headers: await headersDeEscritura(cookie),
      });
      expect(respuesta.statusCode).toBe(403);
    }
  });

  it('rechaza propiedades desconocidas con error 400 sin reflejar la entrada', async () => {
    const cookie = cookieAdmin;
    if (cookie === null) {
      throw new Error('La prueba requiere la sesión ADMIN preparada.');
    }
    const secretoSintetico = 'campo no permitido sintético';
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: await headersDeEscritura(cookie),
      payload: {
        username: `bad_${sufijo}`,
        email: `bad_${sufijo}@example.test`,
        displayName: 'Entrada inválida',
        role: 'SUPPORT',
        password: secretoSintetico,
      },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(respuesta.body).not.toContain(secretoSintetico);
  });

  it('permite a ADMIN crear una cuenta pendiente sin devolver contraseña ni hash', async () => {
    const cookie = cookieAdmin;
    if (cookie === null) {
      throw new Error('La prueba requiere la sesión ADMIN preparada.');
    }
    const headers = await headersDeEscritura(cookie);
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers,
      payload: {
        username: `new_${sufijo}`,
        email: `new_${sufijo}@example.test`,
        displayName: 'Cuenta pendiente',
        role: 'SUPPORT',
      },
    });
    const resultadoAlta = respuesta.json<{
      user: { id: string };
      invitationStatus: 'ACCEPTED' | 'RATE_LIMITED' | 'DELIVERY_FAILED';
    }>();
    const idCreado = resultadoAlta.user.id;
    idNuevoUsuario = idCreado;
    idsUsuariosCreados.push(idCreado);
    const fila = await exigirBasePrueba().select().from(users).where(eq(users.id, idCreado));

    expect(respuesta.statusCode).toBe(201);
    expect(resultadoAlta).toMatchObject({
      user: {
        username: `new_${sufijo}`,
        email: `new_${sufijo}@example.test`,
        status: 'PENDING_ACTIVATION',
        emailVerifiedAt: null,
        hasPassword: false,
      },
      invitationStatus: 'ACCEPTED',
    });
    expect(respuesta.body).not.toContain('passwordHash');
    expect(respuesta.body).not.toContain('password');
    expect(fila).toHaveLength(1);
    expect(fila[0]?.passwordHash).toBeNull();
  });

  it('permite a ADMIN crear cuenta directa sin SMTP y persiste solo hash Argon2id', async () => {
    const cookie = cookieAdmin;
    if (cookie === null) {
      throw new Error('La prueba requiere la sesión ADMIN preparada.');
    }
    const contrasenaInicialSintetica = 'Clave directa sintética para pruebas 2032';
    const mensajesPrevios = mensajesAdmin.length;
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: await headersDeEscritura(cookie),
      payload: {
        username: `direct_${sufijo}`,
        email: `direct_${sufijo}@example.test`,
        displayName: 'Cuenta directa',
        role: 'SUPPORT',
        initialPassword: contrasenaInicialSintetica,
      },
    });
    const resultado = respuesta.json<{
      user: { id: string; status: string; hasPassword: boolean; emailVerifiedAt: null };
      credentialStatus: string;
    }>();
    const [fila] = await exigirBasePrueba()
      .select({ passwordHash: users.passwordHash, status: users.status })
      .from(users)
      .where(eq(users.id, resultado.user.id));
    idsUsuariosCreados.push(resultado.user.id);
    const hasheador = new Argon2PasswordHasher();

    expect(respuesta.statusCode).toBe(201);
    expect(resultado).toMatchObject({
      user: {
        username: `direct_${sufijo}`,
        status: 'ACTIVE',
        hasPassword: true,
        emailVerifiedAt: null,
      },
      credentialStatus: 'SET_BY_ADMIN',
    });
    expect(respuesta.body).not.toContain(contrasenaInicialSintetica);
    expect(respuesta.body).not.toContain('passwordHash');
    expect(fila?.status).toBe('ACTIVE');
    expect(fila?.passwordHash).toMatch(/^\$argon2id\$/u);
    expect(await hasheador.verificar(fila?.passwordHash ?? '', contrasenaInicialSintetica)).toBe(
      true,
    );
    expect(mensajesAdmin).toHaveLength(mensajesPrevios);
  });
  it(
    'expone el estado de invitación y nunca presenta como enviado un correo limitado o fallido',
    pruebaEstadosDeEntregaAlta,
  );
  it(
    'permite cancelar y reactivar una invitación invalidando sesiones y tokens anteriores',
    pruebaCancelarYReactivarInvitacion,
  );

  it('permite a ADMIN enviar reset sin devolver ni almacenar el token en claro', async () => {
    const cookie = cookieAdmin;
    if (cookie === null) {
      throw new Error('La prueba requiere la sesión ADMIN preparada.');
    }
    const mensajesPrevios = mensajesAdmin.length;
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: `/api/v1/admin/users/${idSupport}/reset`,
      headers: await headersDeEscritura(cookie),
    });
    const mensaje = mensajesAdmin
      .slice(mensajesPrevios)
      .find((elemento) => elemento.tipo === 'RECUPERACION');
    if (mensaje === undefined) {
      throw new Error('El SMTP falso no recibió el restablecimiento sintético.');
    }
    const token = extraerTokenCorreo(mensaje);
    const filas = await exigirBasePrueba()
      .select({ tokenHash: recoveryTokens.tokenHash, purpose: recoveryTokens.purpose })
      .from(recoveryTokens)
      .where(eq(recoveryTokens.userId, idSupport));

    expect(respuesta.statusCode).toBe(202);
    expect(respuesta.json()).toEqual({ accepted: true });
    expect(respuesta.body).not.toContain(token);
    expect(filas).toContainEqual({
      tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      purpose: 'PASSWORD_RECOVERY',
    });
    expect(filas.some((fila) => fila.tokenHash === token)).toBe(false);
  });

  it('restablece contraseña directamente, audita y revoca las sesiones previas', async () => {
    const cookieAdminActual = cookieAdmin;
    const cookieSupportAnterior = cookieSupport;
    if (cookieAdminActual === null || cookieSupportAnterior === null) {
      throw new Error('La prueba requiere sesiones sintéticas de ADMIN y SUPPORT.');
    }
    const passwordNuevaSintetica = 'Contraseña reiniciada sintética 2041';
    const denegada = await exigirAplicacion().inject({
      method: 'POST',
      url: `/api/v1/admin/users/${idSupport}/password`,
      headers: await headersDeEscritura(cookieSupportAnterior),
      payload: { newPassword: passwordNuevaSintetica },
    });
    const [hashAnterior] = await exigirBasePrueba()
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, idSupport));
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: `/api/v1/admin/users/${idSupport}/password`,
      headers: await headersDeEscritura(cookieAdminActual),
      payload: { newPassword: passwordNuevaSintetica },
    });
    const [hashActual] = await exigirBasePrueba()
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, idSupport));
    const eventos = await exigirBaseMigrador()
      .select({ action: auditEvents.action, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(eq(auditEvents.targetUserId, idSupport));
    const sesionAnterior = await exigirAplicacion().inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieSupportAnterior },
    });
    const nuevoLogin = await iniciarSesion(usuarioSupport, passwordNuevaSintetica);

    expect(denegada.statusCode).toBe(403);
    expect(respuesta.statusCode).toBe(204);
    expect(respuesta.body).toBe('');
    expect(respuesta.body).not.toContain(passwordNuevaSintetica);
    expect(hashActual?.passwordHash).not.toBe(hashAnterior?.passwordHash);
    expect(hashActual?.passwordHash).toMatch(/^\$argon2id\$/u);
    expect(
      await new Argon2PasswordHasher().verificar(
        hashActual?.passwordHash ?? '',
        passwordNuevaSintetica,
      ),
    ).toBe(true);
    expect(eventos.some((evento) => evento.action === 'ADMIN_USER_PASSWORD_RESET')).toBe(true);
    expect(JSON.stringify(eventos)).not.toContain(passwordNuevaSintetica);
    expect(sesionAnterior.statusCode).toBe(401);
    expect(nuevoLogin).toMatch(/^portal_test_session=/u);
    contrasenaActualSupport = passwordNuevaSintetica;
    cookieSupport = nuevoLogin;
  });

  it('permite a ADMIN cambiar correo solo mediante el enlace de verificación', async () => {
    const cookie = cookieAdmin;
    const correoNuevo = `correo_nuevo_${sufijo}@example.test`;
    if (cookie === null) {
      throw new Error('La prueba requiere la sesión ADMIN preparada.');
    }
    const mensajesPrevios = mensajesAdmin.length;
    const ocupado = await exigirAplicacion().inject({
      method: 'POST',
      url: `/api/v1/admin/users/${idSupport}/email-change`,
      headers: await headersDeEscritura(cookie),
      payload: { newEmail: `${usuarioAdmin}@example.test` },
    });
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: `/api/v1/admin/users/${idSupport}/email-change`,
      headers: await headersDeEscritura(cookie),
      payload: { newEmail: correoNuevo },
    });
    const mensaje = mensajesAdmin
      .slice(mensajesPrevios)
      .find((elemento) => elemento.tipo === 'CAMBIO_CORREO');
    if (mensaje === undefined) {
      throw new Error('El SMTP falso no recibió la verificación sintética de correo.');
    }
    const token = extraerTokenCorreo(mensaje);
    const filas = await exigirBasePrueba()
      .select({
        tokenHash: recoveryTokens.tokenHash,
        purpose: recoveryTokens.purpose,
        targetEmail: recoveryTokens.targetEmail,
      })
      .from(recoveryTokens)
      .where(eq(recoveryTokens.userId, idSupport));
    const cuenta = await exigirBasePrueba()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, idSupport));

    expect(respuesta.statusCode).toBe(202);
    expect(ocupado.statusCode).toBe(respuesta.statusCode);
    expect(ocupado.json()).toEqual(respuesta.json());
    expect(respuesta.body).not.toContain(token);
    expect(filas).toContainEqual({
      tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      purpose: 'EMAIL_CHANGE',
      targetEmail: correoNuevo,
    });
    expect(filas.some((fila) => fila.tokenHash === token)).toBe(false);
    expect(cuenta[0]?.email).toBe(`${usuarioSupport}@example.test`);
  });

  it('lista únicamente DTOs administrativos sin hashes ni secretos', async () => {
    const cookie = cookieAdmin;
    if (cookie === null) {
      throw new Error('La prueba requiere la sesión ADMIN preparada.');
    }
    const respuesta = await exigirAplicacion().inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie },
    });
    const usuariosRespuesta = respuesta.json<
      Array<{
        id: string;
        email: string;
        role: string;
        status: string;
        hasPassword: boolean;
      }>
    >();

    expect(respuesta.statusCode).toBe(200);
    expect(usuariosRespuesta.some((usuario) => usuario.id === idAdmin)).toBe(true);
    expect(usuariosRespuesta.some((usuario) => usuario.id === idSupport)).toBe(true);
    expect(usuariosRespuesta.find((usuario) => usuario.id === idAdmin)?.hasPassword).toBe(true);
    expect(usuariosRespuesta.find((usuario) => usuario.id === idSupport)?.hasPassword).toBe(true);
    expect(usuariosRespuesta.find((usuario) => usuario.id === idNuevoUsuario)?.hasPassword).toBe(
      false,
    );
    expect(respuesta.body).not.toContain('passwordHash');
    expect(respuesta.body).not.toContain(contrasenaSintetica);
  });

  it('traduce la violación de índice de username a un error estable de dominio', async () => {
    const repositorio = new PostgresAuthRepository(exigirBasePrueba());
    const entrada = {
      id: randomUUID(),
      username: usuarioAdmin,
      usernameNormalized: usuarioAdmin,
      displayName: 'Cuenta sintética duplicada',
      email: `duplicada_${sufijo}@example.test`,
      emailNormalized: `duplicada_${sufijo}@example.test`,
      emailVerifiedAt: null,
      passwordHash: null,
      role: 'SUPPORT' as const,
      status: 'PENDING_ACTIVATION' as const,
      createdAt: new Date(ahora),
      updatedAt: new Date(ahora),
    };
    const sesion = await new ServicioSesion(repositorio, reloj).crear(idAdmin);
    const error = await repositorio
      .crearUsuario(
        entrada,
        {
          actorUserId: idAdmin,
          action: 'ADMIN_USER_CREATED',
          targetUserId: entrada.id,
          outcome: 'SUCCESS',
          metadata: {},
          createdAt: new Date(ahora),
        },
        sesion.sessionId,
      )
      .then(
        () => null,
        (rechazo: unknown) => rechazo,
      );
    const resumen = {
      nombre: error instanceof Error ? error.name : 'NO_ERROR',
      codigo: error instanceof ErrorRepositorioUsuariosAdmin ? error.code : null,
    };

    expect(resumen).toEqual({
      nombre: 'ErrorRepositorioUsuariosAdmin',
      codigo: 'USERNAME_TAKEN',
    });
  });

  it('rechaza usernames o correos normalizados que ya pertenecen a otra cuenta', async () => {
    const cookie = cookieAdmin;
    if (cookie === null) {
      throw new Error('La prueba requiere la sesión ADMIN preparada.');
    }
    const duplicadoUsuario = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: await headersDeEscritura(cookie),
      payload: {
        username: `NEW_${sufijo}`,
        email: `distinto_${sufijo}@example.test`,
        displayName: 'Duplicado sintético',
        role: 'SUPPORT',
      },
    });
    const duplicadoCorreo = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: await headersDeEscritura(cookie),
      payload: {
        username: `other_${sufijo}`,
        email: `NEW_${sufijo}@example.test`,
        displayName: 'Duplicado sintético',
        role: 'SUPPORT',
      },
    });

    expect(duplicadoUsuario.statusCode).toBe(409);
    expect(duplicadoUsuario.json()).toMatchObject({ code: 'USERNAME_TAKEN' });
    expect(duplicadoCorreo.statusCode).toBe(409);
    expect(duplicadoCorreo.json()).toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it('no permite activar una invitación mientras no tenga contraseña', async () => {
    const cookie = cookieAdmin;
    const id = idNuevoUsuario;
    if (cookie === null || id === null) {
      throw new Error('La prueba requiere primero crear una cuenta pendiente.');
    }
    const respuesta = await exigirAplicacion().inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${id}`,
      headers: await headersDeEscritura(cookie),
      payload: { status: 'ACTIVE' },
    });
    const cuenta = await exigirBasePrueba().select().from(users).where(eq(users.id, id));

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json()).toMatchObject({ code: 'ACTIVATION_REQUIRED' });
    expect(cuenta[0]?.status).toBe('PENDING_ACTIVATION');
    expect(cuenta[0]?.passwordHash).toBeNull();
  });

  it('permite actualizar datos no secretos y rechaza el correo sin flujo de verificación', async () => {
    const cookie = cookieAdmin;
    if (cookie === null) {
      throw new Error('La prueba requiere la sesión ADMIN preparada.');
    }
    const base = await headersDeEscritura(cookie);
    const actualizar = await exigirAplicacion().inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${idSupport}`,
      headers: base,
      payload: { displayName: 'Nombre actualizado' },
    });
    const cambiarCorreo = await exigirAplicacion().inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${idSupport}`,
      headers: await headersDeEscritura(cookie),
      payload: { email: `nuevo_${sufijo}@example.test` },
    });

    expect(actualizar.statusCode).toBe(200);
    expect(actualizar.json()).toMatchObject({ displayName: 'Nombre actualizado' });
    expect(cambiarCorreo.statusCode).toBe(409);
    expect(cambiarCorreo.json()).toMatchObject({ code: 'EMAIL_VERIFICATION_REQUIRED' });
  });

  it('impide degradar o desactivar al último ADMIN activo', async () => {
    const cookie = cookieAdmin;
    if (cookie === null) {
      throw new Error('La prueba requiere la sesión ADMIN preparada.');
    }
    const headers = await headersDeEscritura(cookie);
    const respuesta = await exigirAplicacion().inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${idAdmin}`,
      headers,
      payload: { role: 'SUPPORT' },
    });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json()).toMatchObject({ code: 'LAST_ADMIN_REQUIRED' });
    const cuenta = await exigirBasePrueba().select().from(users).where(eq(users.id, idAdmin));
    expect(cuenta[0]?.role).toBe('ADMIN');
    expect(cuenta[0]?.status).toBe('ACTIVE');
  });

  it('revierte la modificación de cuenta si el evento de auditoría no se puede insertar', async () => {
    const base = exigirBasePrueba();
    const servicio = servicioAdmin;
    if (servicio === null) {
      throw new Error('La prueba requiere el servicio administrativo preparado.');
    }
    const cuentaAntes = await base
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, idSupport));
    const migrador = exigirBaseMigrador();
    const eventosAntes = await migrador
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, 'ADMIN_USER_UPDATED'), eq(auditEvents.targetUserId, idSupport)),
      );
    await migrador.$client.unsafe(`
      CREATE OR REPLACE FUNCTION ps003_test_rechazar_auditoria_admin()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'ADMIN_USER_UPDATED' THEN
          RAISE EXCEPTION 'fallo de auditoría sintético';
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER ps003_test_rechazar_auditoria_admin
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION ps003_test_rechazar_auditoria_admin();
    `);

    try {
      await expect(
        servicio.actualizar(
          idSupport,
          { displayName: 'No debe confirmarse' },
          {
            userId: idAdmin,
            role: 'ADMIN',
            sessionId: (
              await new ServicioSesion(new PostgresAuthRepository(exigirBasePrueba()), reloj).crear(
                idAdmin,
              )
            ).sessionId,
            requestId: 'audit-rollback-test',
          },
        ),
      ).rejects.toThrow();
      const cuenta = await base.select().from(users).where(eq(users.id, idSupport));
      const eventos = await migrador
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, 'ADMIN_USER_UPDATED'),
            eq(auditEvents.targetUserId, idSupport),
          ),
        );

      expect(cuenta[0]?.displayName).toBe(cuentaAntes[0]?.displayName);
      expect(eventos).toHaveLength(eventosAntes.length);
    } finally {
      await migrador.$client.unsafe(`
        DROP TRIGGER IF EXISTS ps003_test_rechazar_auditoria_admin ON audit_events;
        DROP FUNCTION IF EXISTS ps003_test_rechazar_auditoria_admin();
      `);
    }
  });

  it('revoca sesiones administrativas del usuario objetivo', async () => {
    const admin = cookieAdmin;
    const soporte = cookieSupport;
    if (admin === null || soporte === null) {
      throw new Error('La prueba requiere sesiones ADMIN y SUPPORT preparadas.');
    }
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: `/api/v1/admin/users/${idSupport}/sessions/revoke`,
      headers: await headersDeEscritura(admin),
    });
    const consulta = await exigirAplicacion().inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: soporte },
    });
    const filas = await exigirBasePrueba()
      .select({ revokedAt: sessions.revokedAt })
      .from(sessions)
      .where(eq(sessions.userId, idSupport));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({ revokedSessions: 1 });
    expect(consulta.statusCode).toBe(401);
    expect(filas.every((sesion) => sesion.revokedAt !== null)).toBe(true);
  });

  it('revoca sesiones inmediatamente cuando cambia el rol actual del usuario', async () => {
    const admin = cookieAdmin;
    if (admin === null) {
      throw new Error('La prueba requiere la sesión ADMIN preparada.');
    }
    const sessionToInvalidate = await iniciarSesion(usuarioSupport, contrasenaActualSupport);
    const respuesta = await exigirAplicacion().inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${idSupport}`,
      headers: await headersDeEscritura(admin),
      payload: { role: 'ADMIN' },
    });
    const consulta = await exigirAplicacion().inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: sessionToInvalidate },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({ role: 'ADMIN' });
    expect(consulta.statusCode).toBe(401);
  });

  it('permite a ADMIN administrar clientes y ambientes SAP con auditoría transaccional', async () => {
    const admin = cookieAdmin;
    if (admin === null) {
      throw new Error('La prueba requiere la sesión ADMIN preparada.');
    }
    const nombreCliente = `Cliente sintético ${sufijo}`;
    const respuestaAlta = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/admin/clients',
      headers: await headersDeEscritura(admin),
      payload: { nombre: nombreCliente },
    });
    const cliente = respuestaAlta.json<{ id: string; nombre: string; estado: string }>();
    idClientePrueba = cliente.id;
    idsClientesCreados.push(cliente.id);

    const sinCsrf = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/admin/clients',
      headers: { origin: origen, 'sec-fetch-site': 'same-origin', cookie: admin },
      payload: { nombre: `Sin CSRF ${sufijo}` },
    });
    const codigoAmbiente = `PRD_${sufijo.toUpperCase()}`;
    const respuestaAmbiente = await exigirAplicacion().inject({
      method: 'POST',
      url: `/api/v1/admin/clients/${cliente.id}/sap-environments`,
      headers: await headersDeEscritura(admin),
      payload: { codigo: codigoAmbiente.toLowerCase(), nombre: 'Producción sintética' },
    });
    const ambiente = respuestaAmbiente.json<{ id: string; codigo: string; estado: string }>();
    const duplicado = await exigirAplicacion().inject({
      method: 'POST',
      url: `/api/v1/admin/clients/${cliente.id}/sap-environments`,
      headers: await headersDeEscritura(admin),
      payload: { codigo: codigoAmbiente, nombre: 'Duplicado sintético' },
    });
    const actualizarCliente = await exigirAplicacion().inject({
      method: 'PATCH',
      url: `/api/v1/admin/clients/${cliente.id}`,
      headers: await headersDeEscritura(admin),
      payload: { nombre: `${nombreCliente} editado` },
    });
    const actualizarAmbiente = await exigirAplicacion().inject({
      method: 'PATCH',
      url: `/api/v1/admin/clients/${cliente.id}/sap-environments/${ambiente.id}`,
      headers: await headersDeEscritura(admin),
      payload: { codigo: `QAS_${sufijo.toUpperCase()}`, nombre: 'Calidad sintética' },
    });
    const desactivarAmbiente = await exigirAplicacion().inject({
      method: 'PATCH',
      url: `/api/v1/admin/clients/${cliente.id}/sap-environments/${ambiente.id}`,
      headers: await headersDeEscritura(admin),
      payload: { estado: 'DISABLED' },
    });
    const desactivarCliente = await exigirAplicacion().inject({
      method: 'PATCH',
      url: `/api/v1/admin/clients/${cliente.id}`,
      headers: await headersDeEscritura(admin),
      payload: { estado: 'DISABLED' },
    });
    const clientesRespuesta = await exigirAplicacion().inject({
      method: 'GET',
      url: '/api/v1/admin/clients',
      headers: { cookie: admin },
    });
    const auditoria = await exigirBaseMigrador()
      .select({ action: auditEvents.action, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(sql`${auditEvents.metadata}->>'clientId' = ${cliente.id}`);

    expect(respuestaAlta.statusCode).toBe(201);
    expect(cliente).toMatchObject({ nombre: nombreCliente, estado: 'ACTIVE' });
    expect(respuestaAlta.body).not.toContain('passwordHash');
    expect(respuestaAlta.body).not.toContain('credential');
    expect(sinCsrf.statusCode).toBe(403);
    expect(respuestaAmbiente.statusCode).toBe(201);
    expect(ambiente.codigo).toBe(codigoAmbiente);
    expect(duplicado.statusCode).toBe(409);
    expect(duplicado.json()).toMatchObject({ code: 'SAP_ENVIRONMENT_DUPLICATE' });
    expect(actualizarCliente.json()).toMatchObject({ nombre: `${nombreCliente} editado` });
    expect(actualizarAmbiente.json()).toMatchObject({
      codigo: `QAS_${sufijo.toUpperCase()}`,
      nombre: 'Calidad sintética',
    });
    expect(desactivarAmbiente.json()).toMatchObject({ estado: 'DISABLED' });
    expect(desactivarCliente.json()).toMatchObject({ estado: 'DISABLED' });
    expect(clientesRespuesta.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: cliente.id, estado: 'DISABLED' })]),
    );
    expect(auditoria.map((evento) => evento.action)).toEqual(
      expect.arrayContaining([
        'CLIENT_CREATED',
        'CLIENT_UPDATED',
        'CLIENT_DISABLED',
        'CLIENT_SAP_ENVIRONMENT_CREATED',
        'CLIENT_SAP_ENVIRONMENT_UPDATED',
        'CLIENT_SAP_ENVIRONMENT_DISABLED',
      ]),
    );
    expect(JSON.stringify(auditoria)).not.toContain(nombreCliente);
  });

  it('deniega a SUPPORT todos los endpoints de clientes incluso con sesión y CSRF', async () => {
    const support = cookieSupport;
    const clientId = idClientePrueba;
    if (support === null || clientId === null) {
      throw new Error('La prueba requiere las sesiones y el cliente sintético previos.');
    }
    const escritura = await headersDeEscritura(support);
    const respuestas = await Promise.all([
      exigirAplicacion().inject({
        method: 'GET',
        url: '/api/v1/admin/clients',
        headers: { cookie: support },
      }),
      exigirAplicacion().inject({
        method: 'POST',
        url: '/api/v1/admin/clients',
        headers: escritura,
        payload: { nombre: `Denegado ${sufijo}` },
      }),
      exigirAplicacion().inject({
        method: 'PATCH',
        url: `/api/v1/admin/clients/${clientId}`,
        headers: escritura,
        payload: { estado: 'DISABLED' },
      }),
      exigirAplicacion().inject({
        method: 'GET',
        url: `/api/v1/admin/clients/${clientId}/sap-environments`,
        headers: { cookie: support },
      }),
      exigirAplicacion().inject({
        method: 'POST',
        url: `/api/v1/admin/clients/${clientId}/sap-environments`,
        headers: escritura,
        payload: { codigo: 'DENIED', nombre: 'No autorizado' },
      }),
    ]);
    const cliente = await exigirBasePrueba()
      .select({ status: clients.status })
      .from(clients)
      .where(eq(clients.id, clientId));

    expect(respuestas.map((respuesta) => respuesta.statusCode)).toEqual([403, 403, 403, 403, 403]);
    expect(cliente[0]?.status).toBe('DISABLED');
  });
}

/**
 * Comprueba los resultados expuestos para la entrega SMTP de una cuenta recién creada.
 *
 * @returns Promesa resuelta cuando se verifican limitación y fallo de transporte.
 */
async function pruebaEstadosDeEntregaAlta(): Promise<void> {
  const cookie = cookieAdmin;
  const limitador = limitadorAdmin;
  if (cookie === null || limitador === null) {
    throw new Error('La prueba requiere una sesión ADMIN y el limitador sintético.');
  }

  const registrarIntentoOriginal = limitador.registrarIntento;
  limitador.registrarIntento = async () => false;
  let respuestaLimitada;
  try {
    respuestaLimitada = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: await headersDeEscritura(cookie),
      payload: {
        username: `limited_${sufijo}`,
        email: `limited_${sufijo}@example.test`,
        displayName: 'Invitación limitada',
        role: 'SUPPORT',
      },
    });
  } finally {
    limitador.registrarIntento = registrarIntentoOriginal;
  }
  const resultadoLimitado = respuestaLimitada.json<{
    user?: { id: string };
    invitationStatus: string;
  }>();
  if (resultadoLimitado.user !== undefined) {
    idsUsuariosCreados.push(resultadoLimitado.user.id);
  }

  const cantidadMensajes = mensajesAdmin.length;
  fallarCorreoAdmin = true;
  let respuestaFallida;
  try {
    respuestaFallida = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: await headersDeEscritura(cookie),
      payload: {
        username: `smtp_${sufijo}`,
        email: `smtp_${sufijo}@example.test`,
        displayName: 'Invitación con fallo SMTP',
        role: 'SUPPORT',
      },
    });
  } finally {
    fallarCorreoAdmin = false;
  }
  const resultadoFallido = respuestaFallida.json<{
    user?: { id: string };
    invitationStatus: string;
  }>();
  if (resultadoFallido.user !== undefined) {
    idsUsuariosCreados.push(resultadoFallido.user.id);
  }

  expect(respuestaLimitada.statusCode).toBe(201);
  expect(resultadoLimitado.invitationStatus).toBe('RATE_LIMITED');
  expect(respuestaLimitada.body).not.toContain('passwordHash');
  expect(respuestaFallida.statusCode).toBe(201);
  expect(resultadoFallido.invitationStatus).toBe('DELIVERY_FAILED');
  expect(respuestaFallida.body).not.toContain('passwordHash');
  expect(mensajesAdmin).toHaveLength(cantidadMensajes);
}

/**
 * Comprueba que una invitación cancelada no conserve tokens ni sesiones autorizables.
 *
 * @returns Promesa resuelta después de cancelar, reactivar y comprobar los enlaces.
 */
async function pruebaCancelarYReactivarInvitacion(): Promise<void> {
  const cookie = cookieAdmin;
  const id = idNuevoUsuario;
  if (cookie === null || id === null) {
    throw new Error('La prueba requiere una invitación aceptada en la prueba anterior.');
  }
  const base = exigirBasePrueba();
  const instante = new Date(ahora);
  await base.insert(sessions).values({
    id: randomUUID(),
    userId: id,
    tokenHash: 'c'.repeat(64),
    createdAt: instante,
    lastUsedAt: instante,
    idleExpiresAt: new Date(instante.getTime() + 30 * 60_000),
    absoluteExpiresAt: new Date(instante.getTime() + 8 * 60 * 60_000),
  });
  const tokensAntes = await base
    .select({ tokenHash: recoveryTokens.tokenHash })
    .from(recoveryTokens)
    .where(eq(recoveryTokens.userId, id));
  const cancelar = await exigirAplicacion().inject({
    method: 'PATCH',
    url: `/api/v1/admin/users/${id}`,
    headers: await headersDeEscritura(cookie),
    payload: { status: 'DISABLED' },
  });
  const estadoCancelado = await base.select().from(users).where(eq(users.id, id));
  const tokensCancelados = await base
    .select({ usedAt: recoveryTokens.usedAt })
    .from(recoveryTokens)
    .where(eq(recoveryTokens.userId, id));
  const sesionesCanceladas = await base
    .select({ revokedAt: sessions.revokedAt })
    .from(sessions)
    .where(eq(sessions.userId, id));

  expect(cancelar.statusCode).toBe(200);
  expect(estadoCancelado[0]?.status).toBe('DISABLED');
  expect(estadoCancelado[0]?.passwordHash).toBeNull();
  expect(tokensCancelados).toHaveLength(tokensAntes.length);
  expect(tokensCancelados.every((token) => token.usedAt !== null)).toBe(true);
  expect(sesionesCanceladas.every((sesion) => sesion.revokedAt !== null)).toBe(true);

  const reactivar = await exigirAplicacion().inject({
    method: 'PATCH',
    url: `/api/v1/admin/users/${id}`,
    headers: await headersDeEscritura(cookie),
    payload: { status: 'PENDING_ACTIVATION' },
  });
  const reenviar = await exigirAplicacion().inject({
    method: 'POST',
    url: `/api/v1/admin/users/${id}/reset`,
    headers: await headersDeEscritura(cookie),
  });
  const mensajesReactivacion = mensajesAdmin.filter(
    (mensaje) => mensaje.destinatario === `new_${sufijo}@example.test`,
  );
  const tokensReactivados = await base
    .select({ tokenHash: recoveryTokens.tokenHash, usedAt: recoveryTokens.usedAt })
    .from(recoveryTokens)
    .where(eq(recoveryTokens.userId, id));
  fallarCorreoAdmin = true;
  let reenvioFallido;
  try {
    reenvioFallido = await exigirAplicacion().inject({
      method: 'POST',
      url: `/api/v1/admin/users/${id}/reset`,
      headers: await headersDeEscritura(cookie),
    });
  } finally {
    fallarCorreoAdmin = false;
  }

  expect(reactivar.statusCode).toBe(200);
  expect(reenviar.statusCode).toBe(202);
  expect(mensajesReactivacion).toHaveLength(2);
  expect(tokensReactivados.filter((token) => token.usedAt === null)).toHaveLength(1);
  expect(tokensReactivados.find((token) => token.usedAt === null)?.tokenHash).not.toBe(
    tokensAntes[0]?.tokenHash,
  );
  expect(reenvioFallido.statusCode).toBe(503);
  expect(reenvioFallido.json()).toMatchObject({ code: 'SMTP_DELIVERY_FAILED' });
}

describe('rutas de administración sobre PostgreSQL aislado', definirPruebasAdmin);
beforeAll(prepararAdministracion);
afterAll(cerrarAdministracion);
