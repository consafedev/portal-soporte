import { createHash, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from '../../apps/api/src/auth/argon2-password-hasher.js';
import { LimitadorIntentosPostgres } from '../../apps/api/src/auth/attempt-limiter.js';
import { ServicioAutenticacionCore } from '../../apps/api/src/auth/auth-service.js';
import { PostgresAuthRepository } from '../../apps/api/src/auth/postgres-auth-repository.js';
import { ServicioRecuperacionAuth } from '../../apps/api/src/auth/recovery-service.js';
import { ServicioSesion } from '../../apps/api/src/auth/session-service.js';
import { ServicioUsuariosAdmin } from '../../apps/api/src/auth/admin-user-service.js';
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';
import {
  auditEvents,
  authThrottleWindows,
  recoveryTokens,
  users,
} from '../../apps/api/src/db/schema.js';
import { cargarConfiguracionAuth } from '../../apps/api/src/config.js';
import { crearServidorAuth } from '../../apps/api/src/server.js';
import type {
  MensajeCorreoAuth,
  RelojAuth,
  ServicioCorreoAuth,
} from '../../packages/core/src/auth/ports.js';

const urlBase = process.env['TEST_DATABASE_URL'];
const database =
  urlBase === undefined
    ? null
    : crearClienteBaseDatosAuth({ DATABASE_URL: urlBase, NODE_ENV: 'test' });
const idSupportRecovery = randomUUID();
const idSupportPassword = randomUUID();
const idSupportEmail = randomUUID();
const idAdminBootstrap = randomUUID();
const idPending = randomUUID();
const sufijo = randomUUID().slice(0, 8);
const contrasenaSintetica = 'Contraseña inicial sintética ñ 123';
const contrasenaRecuperada = 'Nueva contraseña de recuperación ñ 456';
const origen = 'http://127.0.0.1:3000';
const ahora = new Date('2026-11-18T06:00:00.000Z');
const mensajes: MensajeCorreoAuth[] = [];
const correoPrueba: ServicioCorreoAuth = {
  /** Conserva solo mensajes sintéticos en memoria para verificar el flujo de entrega. */
  async enviar(mensaje) {
    mensajes.push(mensaje);
  },
};
const reloj: RelojAuth = {
  /** Devuelve una copia del reloj fijo de la suite aislada. */
  ahora(): Date {
    return new Date(ahora);
  },
};

type AplicacionRecuperacion = Awaited<ReturnType<typeof crearServidorAuth>>;
let aplicacion: AplicacionRecuperacion | null = null;
let recuperacion: ServicioRecuperacionAuth | null = null;
let cookieSupportPassword: string | null = null;
let cookieSupportEmail: string | null = null;
let cookieAdmin: string | null = null;

/** Recupera exclusivamente la base sintética que creó el harness PostgreSQL. */
function exigirBasePrueba(): NonNullable<typeof database> {
  if (database === null) {
    throw new Error('La suite requiere el clúster PostgreSQL aislado del harness.');
  }

  return database;
}

/** Recupera la aplicación Fastify configurada con adaptadores falsos y DB temporal. */
function exigirAplicacion(): AplicacionRecuperacion {
  if (aplicacion === null) {
    throw new Error('La aplicación de recuperación no está inicializada.');
  }

  return aplicacion;
}

/** Recupera el caso de uso que emite los enlaces sintéticos al transporte en memoria. */
function exigirServicioRecuperacion(): ServicioRecuperacionAuth {
  if (recuperacion === null) {
    throw new Error('El servicio de recuperación no está inicializado.');
  }

  return recuperacion;
}

/** Inserta una cuenta sintética activa con hash Argon2id antes de iniciar el servidor. */
async function insertarCuentaActiva(
  id: string,
  username: string,
  email: string,
  role: 'ADMIN' | 'SUPPORT',
  verificado = true,
): Promise<void> {
  const hasheador = new Argon2PasswordHasher();
  await exigirBasePrueba()
    .insert(users)
    .values({
      id,
      username,
      usernameNormalized: username,
      displayName: `${role} sintético`,
      email,
      emailNormalized: email,
      emailVerifiedAt: verificado ? new Date(ahora) : null,
      passwordHash: await hasheador.hash(contrasenaSintetica),
      role,
      status: 'ACTIVE',
    });
}

/** Prepara todas las cuentas sintéticas y conecta servicios al PostgreSQL efímero. */
async function prepararFlujosRecuperacion(): Promise<void> {
  const hasheador = new Argon2PasswordHasher();
  await insertarCuentaActiva(
    idSupportRecovery,
    `support_recovery_${sufijo}`,
    `recovery_${sufijo}@example.test`,
    'SUPPORT',
  );
  await insertarCuentaActiva(
    idSupportPassword,
    `support_password_${sufijo}`,
    `password_${sufijo}@example.test`,
    'SUPPORT',
  );
  await insertarCuentaActiva(
    idSupportEmail,
    `support_email_${sufijo}`,
    `email_${sufijo}@example.test`,
    'SUPPORT',
  );
  await insertarCuentaActiva(
    idAdminBootstrap,
    `admin_unverified_${sufijo}`,
    `admin_unverified_${sufijo}@example.test`,
    'ADMIN',
    false,
  );
  await exigirBasePrueba()
    .insert(users)
    .values({
      id: idPending,
      username: `pending_${sufijo}`,
      usernameNormalized: `pending_${sufijo}`,
      displayName: 'Invitación sintética',
      email: `pending_${sufijo}@example.test`,
      emailNormalized: `pending_${sufijo}@example.test`,
      emailVerifiedAt: null,
      passwordHash: null,
      role: 'SUPPORT',
      status: 'PENDING_ACTIVATION',
    });

  const base = exigirBasePrueba();
  const repositorioActual = new PostgresAuthRepository(base);
  const sesionesAuth = new ServicioSesion(repositorioActual, reloj);
  const auditoria = repositorioActual;
  const limitador = new LimitadorIntentosPostgres(base, Buffer.alloc(32, 67));
  const servicioCredenciales = new ServicioRecuperacionAuth({
    repositorio: repositorioActual,
    hasheador,
    correo: correoPrueba,
    limitador,
    auditoria,
    sesiones: sesionesAuth,
    reloj,
    publicAppOrigin: origen,
  });
  recuperacion = servicioCredenciales;
  const autenticacion = new ServicioAutenticacionCore(
    repositorioActual,
    hasheador,
    sesionesAuth,
    auditoria,
    reloj,
  );
  aplicacion = await crearServidorAuth({
    configuracion: cargarConfiguracionAuth({
      NODE_ENV: 'test',
      PUBLIC_APP_ORIGIN: origen,
      API_INTERNAL_ORIGIN: 'http://127.0.0.1:4000',
    }),
    autenticacion,
    sesiones: sesionesAuth,
    auditoria,
    reloj,
    limitador,
    recuperacion: servicioCredenciales,
    usuariosAdmin: new ServicioUsuariosAdmin(repositorioActual, reloj),
  });
  cookieSupportPassword = await iniciarSesion(`support_password_${sufijo}`);
  cookieSupportEmail = await iniciarSesion(`support_email_${sufijo}`);
  cookieAdmin = await iniciarSesion(`admin_unverified_${sufijo}`);
}

/** Cierra Fastify y elimina solo las filas de usuarios sintéticos de esta suite. */
async function cerrarFlujosRecuperacion(): Promise<void> {
  await aplicacion?.close();
  const ids = [idSupportRecovery, idSupportPassword, idSupportEmail, idAdminBootstrap, idPending];
  await exigirBasePrueba().delete(auditEvents).where(inArray(auditEvents.actorUserId, ids));
  await exigirBasePrueba().delete(auditEvents).where(inArray(auditEvents.targetUserId, ids));
  await exigirBasePrueba().delete(users).where(inArray(users.id, ids));
  await exigirBasePrueba().delete(authThrottleWindows);
  await exigirBasePrueba().$client.end({ timeout: 5 });
}

/** Extrae una cookie de sesión de Set-Cookie sin imprimir su contenido. */
function leerCookie(
  respuesta: { headers: { readonly 'set-cookie'?: unknown } },
  nombre: string,
): string {
  const cabeceras = respuesta.headers['set-cookie'];
  const lista =
    typeof cabeceras === 'string'
      ? [cabeceras]
      : Array.isArray(cabeceras)
        ? cabeceras.filter((valor): valor is string => typeof valor === 'string')
        : [];
  const cookie = lista.find((valor) => valor.startsWith(`${nombre}=`))?.split(';', 1)[0];
  if (cookie === undefined || cookie.length === 0) {
    throw new Error('La respuesta no incluyó la cookie sintética esperada.');
  }

  return cookie;
}

/** Obtiene cookie y token CSRF para las solicitudes same-origin de esta suite. */
async function obtenerCsrf(): Promise<{ token: string; cookie: string }> {
  const respuesta = await exigirAplicacion().inject({ method: 'GET', url: '/api/v1/auth/csrf' });
  return {
    token: respuesta.json<{ token: string }>().token,
    cookie: leerCookie(respuesta, 'portal_test_csrf'),
  };
}

/** Construye los headers de escritura protegidos por Origin, Fetch Metadata y token CSRF. */
async function headersEscritura(cookieSesion?: string) {
  const csrf = await obtenerCsrf();

  return {
    origin: origen,
    'sec-fetch-site': 'same-origin',
    'x-csrf-token': csrf.token,
    cookie: cookieSesion === undefined ? csrf.cookie : `${cookieSesion}; ${csrf.cookie}`,
  };
}

/** Inicia sesión con username sintético y devuelve solo la cookie opaca. */
async function iniciarSesion(username: string): Promise<string> {
  const headers = await headersEscritura();
  const respuesta = await exigirAplicacion().inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers,
    payload: { username, password: contrasenaSintetica },
  });
  if (respuesta.statusCode !== 200) {
    const codigo = respuesta.json<{ code?: string }>().code ?? 'SIN_CODIGO';
    throw new Error(
      `No se pudo preparar una sesión sintética (HTTP ${respuesta.statusCode}, ${codigo}).`,
    );
  }

  return leerCookie(respuesta, 'portal_test_session');
}

/** Extrae el token de un enlace usando exclusivamente su fragmento. */
function tokenDeMensaje(indice = mensajes.length - 1): string {
  const mensaje = mensajes[indice];
  if (mensaje === undefined) {
    throw new Error('El transporte falso no recibió el mensaje esperado.');
  }
  const fragmento = new URLSearchParams(new URL(mensaje.enlace).hash.slice(1));
  const token = fragmento.get('token');
  if (token === null) {
    throw new Error('El enlace sintético no contiene su token en el fragmento.');
  }

  return token;
}

/** Solicita recuperación por correo y retorna el resultado HTTP sin filtrar el email. */
async function solicitarRecuperacion(email: string) {
  return exigirAplicacion().inject({
    method: 'POST',
    url: '/api/v1/auth/recovery/request',
    headers: await headersEscritura(),
    payload: { email },
  });
}

/** Agrupa las pruebas HTTP reales de token, recuperación y cambios de credenciales. */
function definirPruebasRecuperacion(): void {
  it('responde igual para email conocido/desconocido y solo guarda SHA-256 del token', async () => {
    const cantidadMensajesAntes = mensajes.length;
    const conocida = await solicitarRecuperacion(`recovery_${sufijo}@example.test`);
    const desconocida = await solicitarRecuperacion(`missing_${sufijo}@example.test`);
    const token = tokenDeMensaje(cantidadMensajesAntes);
    const filas = await exigirBasePrueba()
      .select({ tokenHash: recoveryTokens.tokenHash, purpose: recoveryTokens.purpose })
      .from(recoveryTokens)
      .where(eq(recoveryTokens.userId, idSupportRecovery));
    const cuerpoPublico = JSON.stringify([conocida.json(), desconocida.json()]);

    expect(conocida.statusCode).toBe(202);
    expect(desconocida.statusCode).toBe(202);
    expect(conocida.json()).toEqual(desconocida.json());
    expect(filas).toContainEqual({
      tokenHash: createHash('sha256').update(token, 'utf8').digest('hex'),
      purpose: 'PASSWORD_RECOVERY',
    });
    expect(cuerpoPublico).not.toContain(token);
    expect(cuerpoPublico).not.toContain(`recovery_${sufijo}`);
    expect(new URL(mensajes[cantidadMensajesAntes]?.enlace ?? origen).search).toBe('');
  });

  it('no entrega recuperación al correo sin verificar', async () => {
    const cantidadMensajesAntes = mensajes.length;
    const respuesta = await solicitarRecuperacion(`admin_unverified_${sufijo}@example.test`);

    expect(respuesta.statusCode).toBe(202);
    expect(respuesta.json()).toEqual({ accepted: true });
    expect(mensajes).toHaveLength(cantidadMensajesAntes);
  });

  it('rechaza propósito equivocado, acepta activación una sola vez y verifica el correo', async () => {
    await exigirServicioRecuperacion().solicitarInvitacion(
      idPending,
      null,
      '127.0.0.1',
      'integration-invitation',
    );
    const token = tokenDeMensaje();
    const recovery = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/auth/recovery/complete',
      headers: await headersEscritura(),
      payload: { token, newPassword: contrasenaRecuperada },
    });
    const activation = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/auth/activation/complete',
      headers: await headersEscritura(),
      payload: { token, newPassword: contrasenaRecuperada },
    });
    const replay = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/auth/activation/complete',
      headers: await headersEscritura(),
      payload: { token, newPassword: contrasenaRecuperada },
    });
    const [cuenta] = await exigirBasePrueba().select().from(users).where(eq(users.id, idPending));

    expect(recovery.statusCode).toBe(400);
    expect(activation.statusCode).toBe(204);
    expect(replay.statusCode).toBe(400);
    expect(cuenta).toMatchObject({ status: 'ACTIVE', emailVerifiedAt: ahora });
    expect(activation.body).not.toContain(token);
    expect(activation.body).not.toContain(contrasenaRecuperada);
  });

  it('rechaza recuperación vencida sin consumirla ni filtrar el token', async () => {
    await solicitarRecuperacion(`recovery_${sufijo}@example.test`);
    const token = tokenDeMensaje();
    await exigirBasePrueba()
      .update(recoveryTokens)
      .set({ expiresAt: new Date(ahora.getTime() - 1_000) })
      .where(eq(recoveryTokens.tokenHash, createHash('sha256').update(token).digest('hex')));
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/auth/recovery/complete',
      headers: await headersEscritura(),
      payload: { token, newPassword: contrasenaRecuperada },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.body).not.toContain(token);
    expect(respuesta.body).not.toContain(contrasenaRecuperada);
  });

  it('requiere contraseña actual, revoca sesiones anteriores y crea una sesión nueva', async () => {
    const cookie = cookieSupportPassword;
    if (cookie === null) {
      throw new Error('Falta la sesión SUPPORT de la suite.');
    }
    const before = await exigirBasePrueba()
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, idSupportPassword));
    const incorrecta = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: await headersEscritura(cookie),
      payload: {
        currentPassword: 'Actual incorrecta sintética',
        newPassword: contrasenaRecuperada,
      },
    });
    const correcta = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: await headersEscritura(cookie),
      payload: { currentPassword: contrasenaSintetica, newPassword: contrasenaRecuperada },
    });
    const cookieNueva = leerCookie(correcta, 'portal_test_session');
    const anterior = await exigirAplicacion().inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });
    const nueva = await exigirAplicacion().inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieNueva },
    });
    const after = await exigirBasePrueba()
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, idSupportPassword));

    expect(incorrecta.statusCode).toBe(401);
    expect(correcta.statusCode).toBe(204);
    expect(anterior.statusCode).toBe(401);
    expect(nueva.statusCode).toBe(200);
    expect(after[0]?.passwordHash).not.toBe(before[0]?.passwordHash);
    expect(correcta.body).not.toContain(contrasenaRecuperada);
    expect(correcta.body).not.toContain(after[0]?.passwordHash ?? 'hash');
  });

  it('no cambia correo sin contraseña actual y aplica el destino solo al verificar', async () => {
    const cookie = cookieSupportEmail;
    if (cookie === null) {
      throw new Error('Falta la sesión SUPPORT de la suite.');
    }
    const correoNuevo = `nuevo_${sufijo}@example.test`;
    const incorrecta = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/auth/email-change/request',
      headers: await headersEscritura(cookie),
      payload: { currentPassword: 'Actual incorrecta sintética', newEmail: correoNuevo },
    });
    const sinCambio = await exigirBasePrueba()
      .select()
      .from(users)
      .where(eq(users.id, idSupportEmail));
    const solicitud = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/auth/email-change/request',
      headers: await headersEscritura(cookie),
      payload: { currentPassword: contrasenaSintetica, newEmail: correoNuevo },
    });
    const mensaje = mensajes.at(-1);
    if (mensaje === undefined) {
      throw new Error('No se emitió el mensaje de cambio de correo.');
    }
    const token = tokenDeMensaje();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const antes = await exigirBasePrueba().select().from(users).where(eq(users.id, idSupportEmail));
    const completo = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/auth/email-change/complete',
      headers: await headersEscritura(),
      payload: { token },
    });
    const despues = await exigirBasePrueba()
      .select()
      .from(users)
      .where(eq(users.id, idSupportEmail));
    const tokenPersistido = await exigirBasePrueba()
      .select({ tokenHash: recoveryTokens.tokenHash, usedAt: recoveryTokens.usedAt })
      .from(recoveryTokens)
      .where(eq(recoveryTokens.tokenHash, tokenHash));

    expect(incorrecta.statusCode).toBe(401);
    expect(sinCambio[0]?.email).toBe(`email_${sufijo}@example.test`);
    expect(solicitud.statusCode).toBe(202);
    expect(mensaje.tipo).toBe('CAMBIO_CORREO');
    expect(new URL(mensaje.enlace).hash).toContain('flow=email-change');
    expect(antes[0]?.email).toBe(`email_${sufijo}@example.test`);
    expect(completo.statusCode).toBe(204);
    expect(despues[0]).toMatchObject({ email: correoNuevo, emailVerifiedAt: ahora });
    expect(tokenPersistido).toEqual([{ tokenHash, usedAt: ahora }]);
    expect(JSON.stringify(tokenPersistido)).not.toContain(token);
  });

  it('permite al ADMIN iniciar verificación de su mismo correo no verificado', async () => {
    const cookie = cookieAdmin;
    if (cookie === null) {
      throw new Error('Falta la sesión ADMIN de bootstrap de la suite.');
    }
    const respuesta = await exigirAplicacion().inject({
      method: 'POST',
      url: '/api/v1/auth/email-change/request',
      headers: await headersEscritura(cookie),
      payload: {
        currentPassword: contrasenaSintetica,
        newEmail: `admin_unverified_${sufijo}@example.test`,
      },
    });
    const mensaje = mensajes.at(-1);

    expect(respuesta.statusCode).toBe(202);
    expect(mensaje?.tipo).toBe('VERIFICACION_CORREO');
    expect(new URL(mensaje?.enlace ?? origen).hash).toContain('flow=verify-email');
  });

  it('aplica limitación de login por username/IP tras cinco intentos inválidos', async () => {
    const username = `support_recovery_${sufijo}`;
    const resultados: number[] = [];
    for (let intento = 0; intento < 6; intento += 1) {
      const respuesta = await exigirAplicacion().inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: await headersEscritura(),
        payload: { username, password: 'Clave incorrecta sintética' },
      });
      resultados.push(respuesta.statusCode);
    }
    const ventanas = await exigirBasePrueba().select().from(authThrottleWindows);
    const eventos = await exigirBasePrueba()
      .select({
        action: auditEvents.action,
        outcome: auditEvents.outcome,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(eq(auditEvents.action, 'AUTH_ATTEMPT_LIMITED'));

    expect(resultados).toEqual([401, 401, 401, 401, 401, 429]);
    expect(JSON.stringify(ventanas)).not.toContain(username);
    expect(JSON.stringify(ventanas)).not.toContain('127.0.0.1');
    expect(eventos).toContainEqual(
      expect.objectContaining({
        outcome: 'DENIED',
        metadata: expect.objectContaining({ scope: 'LOGIN' }),
      }),
    );
    expect(JSON.stringify(eventos)).not.toContain(username);
  });
}

describe('rutas de recuperación en PostgreSQL aislado', definirPruebasRecuperacion);
beforeAll(prepararFlujosRecuperacion);
afterAll(cerrarFlujosRecuperacion);
