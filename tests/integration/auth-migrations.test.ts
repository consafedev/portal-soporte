import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';
import { migrarBaseAuth } from '../../apps/api/src/db/migrate.js';

const baseUrl = process.env['TEST_DATABASE_URL'];
const cliente =
  baseUrl === undefined
    ? null
    : crearClienteBaseDatosAuth({ DATABASE_URL: baseUrl, NODE_ENV: 'test' });
const sqlDeSeguridad = baseUrl === undefined ? null : postgres(baseUrl, { max: 1 });

/** Comprueba que el arranque global aplicó migraciones en el servidor de prueba aislado. */
async function verificarPostgresAislado(): Promise<void> {
  if (cliente === null || sqlDeSeguridad === null) {
    throw new Error('TEST_DATABASE_URL debe apuntar a portal_ps003_test en loopback.');
  }

  const [identidad] = await sqlDeSeguridad<{ nombre: string; loopback: boolean | null }[]>`
    SELECT
      current_database() AS nombre,
      (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() <<= '::1/128'::inet) AS loopback
  `;
  if (identidad?.nombre !== 'portal_ps003_test' || identidad.loopback !== true) {
    throw new Error(
      'La suite requiere la base portal_ps003_test en un servidor PostgreSQL de loopback.',
    );
  }

  const [estadoMigrado] = await sqlDeSeguridad<{ tablas: number; esquemaMigraciones: boolean }[]>`
    SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public') AS tablas,
      EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'drizzle') AS "esquemaMigraciones"
  `;
  if (estadoMigrado?.tablas !== 6 || !estadoMigrado.esquemaMigraciones) {
    throw new Error(
      'La configuración global no preparó las seis tablas versionadas de autenticación.',
    );
  }
}

/** Cierra conexiones de esta suite contra PostgreSQL local aislado. */
async function cerrarPostgresAislado(): Promise<void> {
  await cliente?.$client.end({ timeout: 5 });
  await sqlDeSeguridad?.end({ timeout: 5 });
}

/** Agrupa pruebas que necesitan comportamiento real del servidor PostgreSQL. */
function definirPruebasDeMigracionesPostgres(): void {
  it('aplica la migración limpia y deja la fila centinela', pruebaMigracionLimpia);
  it(
    'registra una sola versión y no duplica el centinela al repetir migración',
    pruebaMigracionRepetible,
  );
  it('rechaza estados activos sin credencial en PostgreSQL real', pruebaRestriccionDeCuentaActiva);
  it(
    'rellena expiración al actualizar filas previas de throttling',
    pruebaActualizacionThrottlingExistente,
  );
  it(
    'revierte el ciclo de invitaciones manteniendo una cuenta reemitible',
    pruebaReversionCicloInvitaciones,
  );
}

/** Verifica la reversión versionada de invitaciones sobre un esquema PostgreSQL aislado. */
async function pruebaReversionCicloInvitaciones(): Promise<void> {
  if (sqlDeSeguridad === null) {
    throw new Error('La suite de integración requiere PostgreSQL aislado.');
  }

  const identificadorEsquema = `ps003_rollback_${randomUUID().replaceAll('-', '')}`;
  const migracionBase = await readFile(
    new URL('../../apps/api/drizzle/0000_auth_core.sql', import.meta.url),
    'utf8',
  );
  const inicioTabla = migracionBase.indexOf('CREATE TABLE "users"');
  const finTabla = migracionBase.indexOf('--> statement-breakpoint', inicioTabla);
  if (inicioTabla < 0 || finTabla < 0) {
    throw new Error('La migración base no contiene la tabla de usuarios esperada.');
  }

  const declaracionTabla = migracionBase.slice(inicioTabla, finTabla).trim();
  const migracionArriba = await readFile(
    new URL('../../apps/api/drizzle/0002_invitation_lifecycle.sql', import.meta.url),
    'utf8',
  );
  const migracionAbajo = await readFile(
    new URL('../../apps/api/drizzle/0002_invitation_lifecycle.down.sql', import.meta.url),
    'utf8',
  );

  await sqlDeSeguridad.begin(async (transaccion) => {
    await transaccion.unsafe(`CREATE SCHEMA "${identificadorEsquema}"`);
    await transaccion.unsafe(`SET LOCAL search_path TO "${identificadorEsquema}"`);
    await transaccion.unsafe(declaracionTabla);
    await transaccion.unsafe(`
      INSERT INTO users (id, username, username_normalized, display_name, email, email_normalized, role, status)
      VALUES ('00000000-0000-4000-8000-000000000091', 'invitacion_91', 'invitacion_91', 'Invitación sintética', 'invitacion91@example.test', 'invitacion91@example.test', 'SUPPORT', 'PENDING_ACTIVATION')
    `);

    for (const sentencia of migracionArriba.split('--> statement-breakpoint')) {
      const sentenciaNormalizada = sentencia.trim();
      if (sentenciaNormalizada.length > 0) await transaccion.unsafe(sentenciaNormalizada);
    }

    await transaccion.unsafe(
      `UPDATE users SET status = 'DISABLED' WHERE username_normalized = 'invitacion_91'`,
    );

    for (const sentencia of migracionAbajo.split('--> statement-breakpoint')) {
      const sentenciaNormalizada = sentencia.trim();
      if (sentenciaNormalizada.length > 0) await transaccion.unsafe(sentenciaNormalizada);
    }

    const [cuenta] = await transaccion<{ status: string; password_hash: string | null }[]>`
      SELECT status, password_hash FROM users WHERE username_normalized = 'invitacion_91'
    `;
    expect(cuenta).toEqual({ status: 'PENDING_ACTIVATION', password_hash: null });
    await transaccion.unsafe(`DROP SCHEMA "${identificadorEsquema}" CASCADE`);
  });
}

/** Verifica que la migración agregue expiraciones a contadores preexistentes en PostgreSQL. */
async function pruebaActualizacionThrottlingExistente(): Promise<void> {
  if (sqlDeSeguridad === null) {
    throw new Error('La suite de integración requiere PostgreSQL aislado.');
  }

  const identificadorEsquema = `ps003_migration_${randomUUID().replaceAll('-', '')}`;
  const migracionBase = await readFile(
    new URL('../../apps/api/drizzle/0000_auth_core.sql', import.meta.url),
    'utf8',
  );
  const inicioTabla = migracionBase.indexOf('CREATE TABLE "auth_throttle_windows"');
  const finTabla = migracionBase.indexOf('--> statement-breakpoint', inicioTabla);
  if (inicioTabla < 0 || finTabla < 0) {
    throw new Error('La migración base no contiene la tabla de throttling esperada.');
  }

  const declaracionTabla = migracionBase.slice(inicioTabla, finTabla).trim();
  const migracionActualizacion = await readFile(
    new URL('../../apps/api/drizzle/0001_auth_throttle_expiry.sql', import.meta.url),
    'utf8',
  );

  await sqlDeSeguridad.begin(async (transaccion) => {
    await transaccion.unsafe(`CREATE SCHEMA "${identificadorEsquema}"`);
    await transaccion.unsafe(`SET LOCAL search_path TO "${identificadorEsquema}"`);
    await transaccion.unsafe(declaracionTabla);
    await transaccion.unsafe(`
      INSERT INTO auth_throttle_windows
        (key_hash, scope, window_started_at, attempt_count, updated_at)
      VALUES ('${'a'.repeat(64)}', 'LOGIN_ACCOUNT', '2026-01-01T00:00:00Z', 3, '2026-01-01T00:01:00Z')
    `);

    for (const sentencia of migracionActualizacion.split('--> statement-breakpoint')) {
      const sentenciaNormalizada = sentencia.trim();
      if (sentenciaNormalizada.length > 0) {
        await transaccion.unsafe(sentenciaNormalizada);
      }
    }

    const filas = await transaccion<{ window_started_at: Date; expires_at: Date }[]>`
      SELECT window_started_at, expires_at FROM auth_throttle_windows
    `;
    expect(filas).toHaveLength(1);
    const fila = filas[0];
    if (fila === undefined) {
      throw new Error('La migración debe conservar el contador existente.');
    }

    expect(fila.expires_at.getTime()).toBe(fila.window_started_at.getTime() + 15 * 60_000);
    await transaccion.unsafe(`DROP SCHEMA "${identificadorEsquema}" CASCADE`);
  });
}

/** Comprueba que la migración cree entidades y siembre el invariante. */
async function pruebaMigracionLimpia(): Promise<void> {
  if (sqlDeSeguridad === null) {
    throw new Error('La suite de integración requiere PostgreSQL aislado.');
  }

  const tablas = await sqlDeSeguridad<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `;
  const invariantes = await sqlDeSeguridad<{ cantidad: number }[]>`
    SELECT count(*)::int AS cantidad FROM auth_invariants WHERE id = 1
  `;

  expect(tablas.map((tabla) => tabla.table_name).sort()).toEqual(
    [
      'audit_events',
      'auth_invariants',
      'auth_throttle_windows',
      'recovery_tokens',
      'sessions',
      'users',
    ].sort(),
  );
  expect(invariantes[0]?.cantidad).toBe(1);
}

/** Comprueba el historial versionado y la idempotencia del migrador. */
async function pruebaMigracionRepetible(): Promise<void> {
  if (cliente === null || sqlDeSeguridad === null) {
    throw new Error('La suite de integración requiere PostgreSQL aislado.');
  }

  await migrarBaseAuth(cliente);
  const versiones = await sqlDeSeguridad<{ cantidad: number }[]>`
    SELECT count(*)::int AS cantidad FROM drizzle.__drizzle_migrations
  `;
  const invariantes = await sqlDeSeguridad<{ cantidad: number }[]>`
    SELECT count(*)::int AS cantidad FROM auth_invariants
  `;

  expect(versiones[0]?.cantidad).toBe(3);
  expect(invariantes[0]?.cantidad).toBe(1);
}

/** Comprueba que PostgreSQL proteja el invariante cuenta activa-credencial. */
async function pruebaRestriccionDeCuentaActiva(): Promise<void> {
  if (sqlDeSeguridad === null) {
    throw new Error('La suite de integración requiere PostgreSQL aislado.');
  }

  await expect(
    sqlDeSeguridad.unsafe(`
      INSERT INTO users (id, username, username_normalized, display_name, email, email_normalized, role, status)
      VALUES ('00000000-0000-4000-8000-000000000099', 'activa_99', 'activa_99', 'Cuenta activa', 'activa99@example.test', 'activa99@example.test', 'SUPPORT', 'ACTIVE')
    `),
  ).rejects.toThrow();
}

describe('migraciones con PostgreSQL real e aislado', definirPruebasDeMigracionesPostgres);
beforeAll(verificarPostgresAislado);
afterAll(cerrarPostgresAislado);
