import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicioAutenticacionCore } from '../../apps/api/src/auth/auth-service.js';
import { LimitadorIntentosPostgres } from '../../apps/api/src/auth/attempt-limiter.js';
import { Argon2PasswordHasher } from '../../apps/api/src/auth/argon2-password-hasher.js';
import { calcularDigestTokenOpaco } from '../../apps/api/src/auth/token-service.js';
import { PostgresAuthRepository } from '../../apps/api/src/auth/postgres-auth-repository.js';
import { ServicioSesion } from '../../apps/api/src/auth/session-service.js';
import { ServicioRecuperacionAuth } from '../../apps/api/src/auth/recovery-service.js';
import { cargarConfiguracionAuth } from '../../apps/api/src/config.js';
import { crearServidorAuth } from '../../apps/api/src/server.js';
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';
import { auditEvents, authThrottleWindows, sessions, users } from '../../apps/api/src/db/schema.js';
import type { RelojAuth } from '../../packages/core/src/auth/ports.js';
import {
  crearClienteMigradorPruebas,
  crearIdentificadoresSolicitudPrueba,
} from '../support/test-database-clients.js';

const baseUrl = process.env['TEST_DATABASE_URL'];
const database =
  baseUrl === undefined
    ? null
    : crearClienteBaseDatosAuth({ DATABASE_URL: baseUrl, NODE_ENV: 'test' });
const databaseMigrador = crearClienteMigradorPruebas();
const identificadoresSolicitud = crearIdentificadoresSolicitudPrueba();
const idUsuario = randomUUID();
const sufijo = idUsuario.slice(0, 8);
const contrasenaSintetica = 'Clave de prueba Unicode ñ 123';
const origenPublicoPrueba = 'http://127.0.0.1:3000';
const instantePrueba = new Date('2026-11-17T14:00:00.000Z');
/** Tipo de instancia que devuelve la fábrica Fastify del API sin otra dependencia de test. */
type AplicacionAuthPrueba = Awaited<ReturnType<typeof crearServidorAuth>>;
const relojFijo: RelojAuth = {
  /** Devuelve un instante sintético estable para las pruebas HTTP. */
  ahora(): Date {
    return new Date(instantePrueba);
  },
};

let aplicacion: AplicacionAuthPrueba | null = null;
let cookieSesionDePrueba: string | null = null;
let autenticacionCompartida: ServicioAutenticacionCore | null = null;
let sesionesCompartidas: ServicioSesion | null = null;
let limitadorCompartido: LimitadorIntentosPostgres | null = null;
let recuperacionCompartida: ServicioRecuperacionAuth | null = null;

/** Recupera la base de integración o falla sin intentar localizar otros servicios. */
function exigirBasePrueba(): NonNullable<typeof database> {
  if (database === null) {
    throw new Error('La suite de rutas requiere PostgreSQL real aislado.');
  }

  return database;
}

/** Recupera el migrador para leer auditoría y preparar DDL sintético aislado. */
function exigirBaseMigrador(): NonNullable<typeof databaseMigrador> {
  if (databaseMigrador === null) {
    throw new Error('La operación requiere el rol migrador de PostgreSQL de prueba.');
  }

  return databaseMigrador;
}

/** Recupera la aplicación Fastify que se inicializó para esta suite. */
function exigirAplicacion(): AplicacionAuthPrueba {
  if (aplicacion === null) {
    throw new Error('La aplicación Fastify de integración no está inicializada.');
  }

  return aplicacion;
}

/** Recupera el servicio real de login registrado por la preparación PostgreSQL. */
function exigirAutenticacion(): ServicioAutenticacionCore {
  if (autenticacionCompartida === null) {
    throw new Error('El servicio de autenticación de integración no está inicializado.');
  }

  return autenticacionCompartida;
}

/** Recupera el servicio de sesiones PostgreSQL registrado por la preparación. */
function exigirServicioSesiones(): ServicioSesion {
  if (sesionesCompartidas === null) {
    throw new Error('El servicio de sesiones de integración no está inicializado.');
  }

  return sesionesCompartidas;
}

/** Recupera el limitador HMAC vinculado al pool PostgreSQL de la suite. */
function exigirLimitador(): LimitadorIntentosPostgres {
  if (limitadorCompartido === null) {
    throw new Error('El limitador de integración no está inicializado.');
  }

  return limitadorCompartido;
}

/** Recupera el caso de uso de recuperación preparado con SMTP falso. */
function exigirServicioRecuperacion(): ServicioRecuperacionAuth {
  if (recuperacionCompartida === null) {
    throw new Error('El servicio de recuperación de integración no está inicializado.');
  }

  return recuperacionCompartida;
}

/** Inicializa el usuario sintético, dependencias reales y servidor sin escuchar un puerto. */
async function prepararRutasAuth(): Promise<void> {
  const hasheador = new Argon2PasswordHasher();
  const passwordHash = await hasheador.hash(contrasenaSintetica);
  await exigirBasePrueba()
    .insert(users)
    .values({
      id: idUsuario,
      username: `support_${sufijo}`,
      usernameNormalized: `support_${sufijo}`,
      displayName: 'Soporte Sintético',
      email: `support_${sufijo}@example.test`,
      emailNormalized: `support_${sufijo}@example.test`,
      passwordHash,
      role: 'SUPPORT',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(instantePrueba),
    });

  const repositorio = new PostgresAuthRepository(exigirBasePrueba());
  const sesionesAuth = new ServicioSesion(repositorio, relojFijo);
  sesionesCompartidas = sesionesAuth;
  const autenticacion = new ServicioAutenticacionCore(
    repositorio,
    hasheador,
    sesionesAuth,
    repositorio,
    relojFijo,
  );
  autenticacionCompartida = autenticacion;
  const limitador = new LimitadorIntentosPostgres(exigirBasePrueba(), Buffer.alloc(32, 53));
  limitadorCompartido = limitador;
  const recuperacion = new ServicioRecuperacionAuth({
    repositorio,
    hasheador,
    correo: { async enviar() {} },
    limitador,
    auditoria: repositorio,
    sesiones: sesionesAuth,
    reloj: relojFijo,
    publicAppOrigin: origenPublicoPrueba,
  });
  recuperacionCompartida = recuperacion;
  const configuracion = cargarConfiguracionAuth({
    NODE_ENV: 'test',
    PUBLIC_APP_ORIGIN: origenPublicoPrueba,
    API_INTERNAL_ORIGIN: 'http://127.0.0.1:4000',
  });
  aplicacion = await crearServidorAuth({
    configuracion,
    autenticacion,
    sesiones: sesionesAuth,
    auditoria: repositorio,
    reloj: relojFijo,
    limitador,
    recuperacion,
    generarIdSolicitud: identificadoresSolicitud.generar,
  });
  /** Ruta exclusiva de la suite para verificar la interpretación de headers de red. */
  aplicacion.get('/__test/client', (solicitud, respuesta) => {
    respuesta.send({
      ip: solicitud.ip,
      hostname: solicitud.hostname,
      protocol: solicitud.protocol,
    });
  });
}

/** Cierra Fastify y el pool exclusivo de esta suite. */
async function cerrarRutasAuth(): Promise<void> {
  await aplicacion?.close();
  await databaseMigrador
    ?.delete(auditEvents)
    .where(
      sql`${auditEvents.metadata}->>'requestId' LIKE ${`${identificadoresSolicitud.prefijo}-%`}`,
    );
  await databaseMigrador?.delete(auditEvents).where(eq(auditEvents.actorUserId, idUsuario));
  await databaseMigrador?.delete(auditEvents).where(eq(auditEvents.targetUserId, idUsuario));
  await databaseMigrador
    ?.delete(authThrottleWindows)
    .where(
      and(
        eq(authThrottleWindows.windowStartedAt, instantePrueba),
        inArray(authThrottleWindows.scope, ['LOGIN_ACCOUNT', 'LOGIN_NETWORK']),
      ),
    );
  await databaseMigrador?.delete(users).where(eq(users.id, idUsuario));
  await databaseMigrador?.$client.end({ timeout: 5 });
  await database?.$client.end({ timeout: 5 });
}

/** Extrae la cookie solicitada de la cabecera de respuesta sin registrar su valor. */
function extraerCookie(
  respuesta: { headers: { readonly 'set-cookie'?: unknown } },
  nombre: string,
): string {
  const entrada = normalizarSetCookie(respuesta.headers['set-cookie']).find((cookie) =>
    cookie.startsWith(`${nombre}=`),
  );
  if (entrada === undefined) {
    throw new Error('La respuesta de prueba no incluyó la cookie esperada.');
  }

  const valor = entrada.split(';', 1)[0];
  if (valor === undefined || valor.length === 0) {
    throw new Error('La cookie de prueba no contiene un valor válido.');
  }

  return valor;
}

/** Convierte Set-Cookie en una lista segura para aserciones sin revelar sus valores. */
function normalizarSetCookie(cabeceras: unknown): string[] {
  if (typeof cabeceras === 'string') {
    return [cabeceras];
  }

  return Array.isArray(cabeceras)
    ? cabeceras.filter((cabecera): cabecera is string => typeof cabecera === 'string')
    : [];
}

/** Emite cookie y token CSRF de prueba para una operación de escritura. */
async function obtenerCsrf(): Promise<{ token: string; cookie: string }> {
  const respuesta = await exigirAplicacion().inject({ method: 'GET', url: '/api/v1/auth/csrf' });
  const cuerpo = respuesta.json<{ token: string }>();

  return { token: cuerpo.token, cookie: extraerCookie(respuesta, 'portal_test_csrf') };
}

/** Construye headers same-origin con el par CSRF de doble envío de la suite. */
function crearHeadersEscritura(csrf: { token: string; cookie: string }, cookieSesion?: string) {
  return {
    origin: origenPublicoPrueba,
    'sec-fetch-site': 'same-origin',
    'x-csrf-token': csrf.token,
    cookie: cookieSesion === undefined ? csrf.cookie : `${cookieSesion}; ${csrf.cookie}`,
  };
}

/** Comprueba nombre/atributos de cookies y cache-control del endpoint CSRF. */
async function pruebaEmiteCsrfHttpOnly(): Promise<void> {
  const respuesta = await exigirAplicacion().inject({ method: 'GET', url: '/api/v1/auth/csrf' });
  const cuerpo = respuesta.json<{ token: string }>();
  const cookie = extraerCookie(respuesta, 'portal_test_csrf');

  expect(Buffer.from(cuerpo.token, 'base64url')).toHaveLength(32);
  expect(cookie).toContain('portal_test_csrf=');
  expect(respuesta.headers['set-cookie']).toContain('HttpOnly');
  expect(respuesta.headers['set-cookie']).toContain('SameSite=Strict');
  expect(respuesta.headers['set-cookie']).not.toContain('Secure');
  expect(respuesta.headers['cache-control']).toContain('no-store');
  expect(respuesta.headers['referrer-policy']).toBe('no-referrer');
}

/** Comprueba atributos de producción y login same-origin sin degradación de Secure. */
async function pruebaCookiesProduccion(): Promise<void> {
  const appProduccion = await crearServidorAuth({
    configuracion: cargarConfiguracionAuth({
      NODE_ENV: 'production',
      PUBLIC_APP_ORIGIN: 'https://portal.example.test',
      API_INTERNAL_ORIGIN: 'http://auth-api.internal:4000',
      TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
    }),
    autenticacion: exigirAutenticacion(),
    sesiones: exigirServicioSesiones(),
    auditoria: new PostgresAuthRepository(exigirBasePrueba()),
    reloj: relojFijo,
    limitador: exigirLimitador(),
    recuperacion: exigirServicioRecuperacion(),
  });

  try {
    const respuestaCsrf = await appProduccion.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
    const csrf = respuestaCsrf.json<{ token: string }>();
    const cookieCsrf = normalizarSetCookie(respuestaCsrf.headers['set-cookie']).find((valor) =>
      valor.startsWith('__Host-portal_csrf='),
    );
    if (cookieCsrf === undefined) {
      throw new Error('La respuesta productiva no incluyó la cookie CSRF segura.');
    }

    const respuestaLogin = await appProduccion.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: {
        origin: 'https://portal.example.test',
        'sec-fetch-site': 'same-origin',
        'x-csrf-token': csrf.token,
        cookie: `__Host-portal_csrf=${csrf.token}`,
      },
      payload: { username: `support_${sufijo}`, password: contrasenaSintetica },
    });
    const cookieSesion = normalizarSetCookie(respuestaLogin.headers['set-cookie']).find((valor) =>
      valor.startsWith('__Host-portal_session='),
    );

    expect(respuestaCsrf.headers['set-cookie']).toContain('Secure');
    expect(respuestaCsrf.headers['set-cookie']).toContain('HttpOnly');
    expect(cookieCsrf).toContain('SameSite=Strict');
    expect(cookieCsrf).toContain('Path=/');
    expect(cookieCsrf).not.toContain('Domain=');
    expect(respuestaLogin.statusCode).toBe(200);
    expect(cookieSesion).toContain('Secure');
    expect(cookieSesion).toContain('HttpOnly');
    expect(cookieSesion).toContain('SameSite=Strict');
    expect(cookieSesion).toContain('Path=/');
    expect(cookieSesion).not.toContain('Domain=');
    expect(respuestaLogin.headers['access-control-allow-origin']).toBeUndefined();

    if (cookieSesion !== undefined) {
      await appProduccion.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          origin: 'https://portal.example.test',
          'sec-fetch-site': 'same-origin',
          'x-csrf-token': csrf.token,
          cookie: `${cookieSesion.split(';', 1)[0]}; ${extraerCookie(respuestaCsrf, '__Host-portal_csrf')}`,
        },
      });
    }
  } finally {
    await appProduccion.close();
  }
}

/** Comprueba login real con cookie opaca y respuesta libre de credenciales. */
async function pruebaLoginSeguro(): Promise<void> {
  const csrf = await obtenerCsrf();
  const respuesta = await exigirAplicacion().inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: crearHeadersEscritura(csrf),
    payload: { username: `SUPPORT_${sufijo}`, password: contrasenaSintetica },
  });
  const cookieSesion = extraerCookie(respuesta, 'portal_test_session');
  const tokenSesion = cookieSesion.slice('portal_test_session='.length);
  const hashSesion = calcularDigestTokenOpaco(tokenSesion);
  const filas = await exigirBasePrueba()
    .select({ tokenHash: sessions.tokenHash })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashSesion));

  cookieSesionDePrueba = cookieSesion;
  expect(respuesta.statusCode).toBe(200);
  expect(respuesta.json()).toEqual({
    user: {
      id: idUsuario,
      username: `support_${sufijo}`,
      displayName: 'Soporte Sintético',
      role: 'SUPPORT',
    },
  });
  expect(respuesta.body).not.toContain(contrasenaSintetica);
  expect(respuesta.body).not.toContain(tokenSesion);
  expect(filas).toHaveLength(1);
  expect(filas[0]?.tokenHash).toBe(hashSesion);

  const respuestaMe = await exigirAplicacion().inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { cookie: cookieSesion },
  });
  expect(respuestaMe.statusCode).toBe(200);
  expect(respuestaMe.json()).toMatchObject({ user: { id: idUsuario, role: 'SUPPORT' } });
}

/** Comprueba que usuario desconocido y clave incorrecta comparten respuesta pública. */
async function pruebaLoginSinEnumeracion(): Promise<void> {
  const csrf = await obtenerCsrf();
  const cabeceras = crearHeadersEscritura(csrf);
  const conocido = await exigirAplicacion().inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: cabeceras,
    payload: { username: `support_${sufijo}`, password: 'clave incorrecta sintética' },
  });
  const desconocido = await exigirAplicacion().inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: cabeceras,
    payload: { username: 'usuario_ausente', password: 'clave incorrecta sintética' },
  });

  expect(conocido.statusCode).toBe(401);
  expect(desconocido.statusCode).toBe(401);
  expect(desconocido.body).toBe(conocido.body);
}

/** Comprueba que toda escritura se detenga por Origin, CSRF o Fetch Metadata inválido. */
async function pruebaProteccionCsrf(): Promise<void> {
  const csrf = await obtenerCsrf();
  const casos = [
    { headers: { ...crearHeadersEscritura(csrf), origin: 'null' } },
    {
      headers: {
        ...crearHeadersEscritura(csrf),
        origin: 'http://attacker.test',
        'x-forwarded-host': '127.0.0.1:3000',
        'x-forwarded-proto': 'http',
        'x-forwarded-for': '203.0.113.9',
      },
    },
    { headers: { ...crearHeadersEscritura(csrf), 'x-csrf-token': `${csrf.token}x` } },
    { headers: { ...crearHeadersEscritura(csrf), 'sec-fetch-site': 'cross-site' } },
    { headers: { 'x-csrf-token': csrf.token, cookie: csrf.cookie } },
  ];

  for (const caso of casos) {
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: caso.headers,
    });
    expect(respuesta.statusCode).toBe(403);
  }

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    const respuesta = await exigirAplicacion().inject({
      method,
      url: '/api/v1/auth/no-disponible',
      headers: { origin: origenPublicoPrueba },
    });
    expect(respuesta.statusCode).toBe(403);
  }

  const writeAdminSinCsrf = await exigirAplicacion().inject({
    method: 'POST',
    url: '/api/v1/admin/users',
    headers: { origin: origenPublicoPrueba },
  });
  expect(writeAdminSinCsrf.statusCode).toBe(403);
}

/** Comprueba que las cabeceras forwarded no alteren la identidad de red si el peer no es proxy confiable. */
async function pruebaIgnoraHeadersProxyFalsificados(): Promise<void> {
  const respuesta = await exigirAplicacion().inject({
    method: 'GET',
    url: '/__test/client',
    headers: {
      host: 'api.internal',
      'x-forwarded-for': '203.0.113.9',
      'x-forwarded-host': 'attacker.example.test',
      'x-forwarded-proto': 'https',
    },
  });

  expect(respuesta.json()).toEqual({ ip: '127.0.0.1', hostname: 'api.internal', protocol: 'http' });
}

/** Comprueba logout, revocación en PostgreSQL y rechazo de la cookie anterior. */
async function pruebaLogoutRevocaSesion(): Promise<void> {
  const cookieSesion = cookieSesionDePrueba;
  if (cookieSesion === null) {
    throw new Error('La prueba requiere completar antes el login sintético.');
  }

  const csrf = await obtenerCsrf();
  const respuesta = await exigirAplicacion().inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: crearHeadersEscritura(csrf, cookieSesion),
  });
  const respuestaMe = await exigirAplicacion().inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { cookie: cookieSesion },
  });
  const [eventoLogin] = await exigirBaseMigrador()
    .select({ metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.actorUserId, idUsuario),
        eq(auditEvents.action, 'AUTH_LOGIN'),
        eq(auditEvents.outcome, 'SUCCESS'),
      ),
    );
  const cookiesSet = respuesta.headers['set-cookie'];
  const valoresCookies =
    typeof cookiesSet === 'string'
      ? [cookiesSet]
      : Array.isArray(cookiesSet)
        ? cookiesSet.filter((valor): valor is string => typeof valor === 'string')
        : [];

  expect(respuesta.statusCode).toBe(204);
  expect(
    valoresCookies.some(
      (valor) => valor.startsWith('portal_test_session=') && valor.includes('Max-Age=0'),
    ),
  ).toBe(true);
  expect(respuestaMe.statusCode).toBe(401);
  const [eventoLogout] = await exigirBaseMigrador()
    .select({ metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, 'AUTH_LOGOUT'),
        eq(auditEvents.actorUserId, idUsuario),
        eq(auditEvents.outcome, 'SUCCESS'),
      ),
    );
  expect(eventoLogin?.metadata).toMatchObject({ actorRole: 'SUPPORT' });
  expect(eventoLogin?.metadata['requestId']).toEqual(expect.any(String));
  expect(eventoLogout?.metadata).toMatchObject({ actorRole: 'SUPPORT' });
  expect(eventoLogout?.metadata['requestId']).toEqual(expect.any(String));
}

/** Fuerza un fallo de auditoría en el clúster efímero y comprueba el rollback de la sesión. */
async function pruebaRollbackLogout(): Promise<void> {
  const base = exigirBasePrueba();
  const migrador = exigirBaseMigrador();
  const sesion = await exigirServicioSesiones().crear(idUsuario);
  const csrf = await obtenerCsrf();
  await migrador.execute(
    sql`ALTER TABLE audit_events ADD CONSTRAINT prueba_rechazo_logout CHECK (action <> 'AUTH_LOGOUT') NOT VALID`,
  );
  try {
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: crearHeadersEscritura(csrf, `portal_test_session=${sesion.token}`),
    });
    const [registro] = await base
      .select({ revokedAt: sessions.revokedAt })
      .from(sessions)
      .where(eq(sessions.id, sesion.sessionId));
    expect(registro?.revokedAt).toBeNull();
    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.headers['set-cookie']).toBeUndefined();
  } finally {
    await migrador.execute(sql`ALTER TABLE audit_events DROP CONSTRAINT prueba_rechazo_logout`);
  }
}

/** Comprueba un único evento anónimo por logout sin credencial vigente. */
async function pruebaLogoutAnonimo(): Promise<void> {
  const csrf = await obtenerCsrf();
  const base = exigirBasePrueba();
  const migrador = exigirBaseMigrador();
  const condicion = and(eq(auditEvents.action, 'AUTH_LOGOUT'), isNull(auditEvents.actorUserId));
  const anteriores = await migrador
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(condicion);
  const servicio = exigirServicioSesiones();
  const revocada = await servicio.crear(idUsuario);
  await servicio.revocar(revocada.token);
  const vencida = await servicio.crear(idUsuario);
  await base
    .update(sessions)
    .set({ idleExpiresAt: instantePrueba })
    .where(eq(sessions.id, vencida.sessionId));
  const cookies = [
    undefined,
    'portal_test_session=malformada',
    `portal_test_session=${Buffer.alloc(32, 2).toString('base64url')}`,
    `portal_test_session=${revocada.token}`,
    `portal_test_session=${vencida.token}`,
  ];
  for (const cookie of cookies) {
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: crearHeadersEscritura(csrf, cookie),
    });
    expect(respuesta.statusCode).toBe(204);
  }
  const posteriores = await migrador
    .select({
      id: auditEvents.id,
      metadata: auditEvents.metadata,
      objetivo: auditEvents.targetUserId,
    })
    .from(auditEvents)
    .where(condicion);
  const nuevos = posteriores.filter(
    (fila) => !anteriores.some((anterior) => anterior.id === fila.id),
  );
  expect(nuevos).toHaveLength(cookies.length);
  for (const fila of nuevos) {
    expect(fila.metadata).toEqual({ requestId: expect.any(String) });
    expect(fila.objetivo).toBeNull();
  }
}

/** Agrupa pruebas de origen, anti-enumeración, sesión y controles de cookie del API. */
function definirPruebasDeRutasAuth(): void {
  it('emite CSRF no cacheable en cookie HttpOnly', pruebaEmiteCsrfHttpOnly);
  it(
    'mantiene Secure, __Host-, same-site y ausencia de CORS en producción',
    pruebaCookiesProduccion,
  );
  it('autentica y devuelve identidad sin revelar credenciales', pruebaLoginSeguro);
  it('mantiene respuesta genérica ante cuenta desconocida', pruebaLoginSinEnumeracion);
  it('rechaza writes sin Origin/CSRF same-origin válido', pruebaProteccionCsrf);
  it(
    'ignora X-Forwarded falsificado por un peer no confiable',
    pruebaIgnoraHeadersProxyFalsificados,
  );
  it('cierra la sesión y bloquea la cookie revocada', pruebaLogoutRevocaSesion);
  it('revierte el logout si PostgreSQL rechaza el evento', pruebaRollbackLogout);
  it('registra logout anónimo para cookies ausentes o inválidas', pruebaLogoutAnonimo);
}

describe('rutas de autenticación con PostgreSQL aislado', definirPruebasDeRutasAuth);
beforeAll(prepararRutasAuth);
afterAll(cerrarRutasAuth);
