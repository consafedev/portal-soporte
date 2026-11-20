import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';
import { migrarBaseAuth } from '../../apps/api/src/db/migrate.js';
import { cargarConfiguracionConexionPrueba } from '../../apps/api/src/runtime-config.js';

const entornoMigrador = {
  ...process.env,
  NODE_ENV: 'test',
  TEST_DATABASE_ROLE: 'portal_test_migrator',
};
const urlMigrador =
  process.env['TEST_DATABASE_URL'] === undefined
    ? null
    : cargarConfiguracionConexionPrueba(entornoMigrador, 'portal_test_migrator').DATABASE_URL;
const cliente =
  urlMigrador === null
    ? null
    : crearClienteBaseDatosAuth({
        ...entornoMigrador,
        DATABASE_URL: urlMigrador,
      });
const sqlDeSeguridad =
  urlMigrador === null
    ? null
    : postgres(urlMigrador, {
        max: 1,
        idle_timeout: 5,
        connect_timeout: 5,
        queue_timeout: 5,
        query_timeout: 20,
        connection: {
          search_path: 'portal',
          statement_timeout: 15_000,
          lock_timeout: 5_000,
          idle_in_transaction_session_timeout: 10_000,
        },
      });

/** Comprueba que el arnés migró PostgreSQL aislado con la identidad prevista. */
async function verificarPostgresAislado(): Promise<void> {
  if (cliente === null || sqlDeSeguridad === null) {
    throw new Error('TEST_DATABASE_URL debe apuntar a PostgreSQL de pruebas aislado.');
  }

  const modo = process.env['TEST_DATABASE_MODE'] ?? 'local-ephemeral';
  const esperado =
    modo === 'ssh-tunnel'
      ? { base: 'portal_soporte_test', rol: 'portal_test_migrator' }
      : { base: 'portal_ps003_test', rol: 'ps003_test' };
  const [identidad] = await sqlDeSeguridad<
    { nombre: string; rol: string; loopback: boolean | null }[]
  >`
    SELECT
      current_database() AS nombre,
      current_user AS rol,
      (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() <<= '::1/128'::inet) AS loopback
  `;
  if (
    identidad?.nombre !== esperado.base ||
    identidad.rol !== esperado.rol ||
    identidad.loopback !== true
  ) {
    throw new Error(
      'La suite alcanzó una identidad PostgreSQL distinta de la base de prueba permitida.',
    );
  }

  const [estadoMigrado] = await sqlDeSeguridad<
    {
      tablasPortal: number;
      ledgerPortal: boolean;
      tablasAuthPublicas: number;
    }[]
  >`
    SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'portal' AND table_name <> '__drizzle_migrations') AS "tablasPortal",
      to_regclass('portal.__drizzle_migrations') IS NOT NULL AS "ledgerPortal",
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('audit_events', 'auth_invariants', 'auth_throttle_windows', 'client_sap_environments', 'clients', 'recovery_tokens', 'sessions', 'users')) AS "tablasAuthPublicas"
  `;
  if (
    estadoMigrado?.tablasPortal !== 8 ||
    !estadoMigrado.ledgerPortal ||
    estadoMigrado.tablasAuthPublicas !== 0
  ) {
    throw new Error(
      'La configuración global no aisló las ocho tablas del Portal y su ledger dentro de portal.',
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
    'simula en PGlite la expiración de filas previas de throttling',
    pruebaActualizacionThrottlingExistente,
  );
  it('simula en PGlite la reversión del ciclo de invitaciones', pruebaReversionCicloInvitaciones);
}

/** Simula la reversión versionada de invitaciones en una base PGlite efímera. */
async function pruebaReversionCicloInvitaciones(): Promise<void> {
  const simulacion = new PGlite();
  const identificadorEsquema = `ps003_rollback_${randomUUID().replaceAll('-', '')}`;
  const migracionBase = await readFile(
    new URL('../../apps/api/drizzle/0000_auth_core.sql', import.meta.url),
    'utf8',
  );
  const inicioTabla = migracionBase.indexOf('CREATE TABLE "portal"."users"');
  const finTabla = migracionBase.indexOf('--> statement-breakpoint', inicioTabla);
  if (inicioTabla < 0 || finTabla < 0) {
    throw new Error('La migración base no contiene la tabla de usuarios esperada.');
  }

  const declaracionTabla = migracionBase
    .slice(inicioTabla, finTabla)
    .trim()
    .replaceAll('"portal".', `"${identificadorEsquema}".`);
  const migracionArriba = await readFile(
    new URL('../../apps/api/drizzle/0002_invitation_lifecycle.sql', import.meta.url),
    'utf8',
  );
  const migracionAbajo = await readFile(
    new URL('../../apps/api/drizzle/0002_invitation_lifecycle.down.sql', import.meta.url),
    'utf8',
  );

  try {
    await simulacion.exec(`CREATE SCHEMA "${identificadorEsquema}"`);
    await simulacion.exec(`SET search_path TO "${identificadorEsquema}"`);
    await simulacion.exec(declaracionTabla);
    await simulacion.exec(`
      INSERT INTO users (id, username, username_normalized, display_name, email, email_normalized, role, status)
      VALUES ('00000000-0000-4000-8000-000000000091', 'invitacion_91', 'invitacion_91', 'Invitación sintética', 'invitacion91@example.test', 'invitacion91@example.test', 'SUPPORT', 'PENDING_ACTIVATION')
    `);

    for (const sentencia of migracionArriba
      .replaceAll('"portal".', `"${identificadorEsquema}".`)
      .split('--> statement-breakpoint')) {
      const sentenciaNormalizada = sentencia.trim();
      if (sentenciaNormalizada.length > 0) await simulacion.exec(sentenciaNormalizada);
    }

    await simulacion.exec(
      `UPDATE users SET status = 'DISABLED' WHERE username_normalized = 'invitacion_91'`,
    );

    for (const sentencia of migracionAbajo
      .replaceAll('"portal".', `"${identificadorEsquema}".`)
      .split('--> statement-breakpoint')) {
      const sentenciaNormalizada = sentencia.trim();
      if (sentenciaNormalizada.length > 0) await simulacion.exec(sentenciaNormalizada);
    }

    const cuenta = await simulacion.query<{ status: string; password_hash: string | null }>(
      "SELECT status, password_hash FROM users WHERE username_normalized = 'invitacion_91'",
    );
    expect(cuenta.rows[0]).toEqual({ status: 'PENDING_ACTIVATION', password_hash: null });
  } finally {
    await simulacion.close();
  }
}

/** Simula en PGlite la actualización de expiración de contadores preexistentes. */
async function pruebaActualizacionThrottlingExistente(): Promise<void> {
  const simulacion = new PGlite();
  const identificadorEsquema = `ps003_migration_${randomUUID().replaceAll('-', '')}`;
  const migracionBase = await readFile(
    new URL('../../apps/api/drizzle/0000_auth_core.sql', import.meta.url),
    'utf8',
  );
  const inicioTabla = migracionBase.indexOf('CREATE TABLE "portal"."auth_throttle_windows"');
  const finTabla = migracionBase.indexOf('--> statement-breakpoint', inicioTabla);
  if (inicioTabla < 0 || finTabla < 0) {
    throw new Error('La migración base no contiene la tabla de throttling esperada.');
  }

  const declaracionTabla = migracionBase
    .slice(inicioTabla, finTabla)
    .trim()
    .replaceAll('"portal".', `"${identificadorEsquema}".`);
  const migracionActualizacion = await readFile(
    new URL('../../apps/api/drizzle/0001_auth_throttle_expiry.sql', import.meta.url),
    'utf8',
  );

  try {
    await simulacion.exec(`CREATE SCHEMA "${identificadorEsquema}"`);
    await simulacion.exec(`SET search_path TO "${identificadorEsquema}"`);
    await simulacion.exec(declaracionTabla);
    await simulacion.exec(`
      INSERT INTO auth_throttle_windows
        (key_hash, scope, window_started_at, attempt_count, updated_at)
      VALUES ('${'a'.repeat(64)}', 'LOGIN_ACCOUNT', '2026-01-01T00:00:00Z', 3, '2026-01-01T00:01:00Z')
    `);

    for (const sentencia of migracionActualizacion
      .replaceAll('"portal".', `"${identificadorEsquema}".`)
      .split('--> statement-breakpoint')) {
      const sentenciaNormalizada = sentencia.trim();
      if (sentenciaNormalizada.length > 0) {
        await simulacion.exec(sentenciaNormalizada);
      }
    }

    const filas = await simulacion.query<{ window_started_at: Date; expires_at: Date }>(
      'SELECT window_started_at, expires_at FROM auth_throttle_windows',
    );
    expect(filas.rows).toHaveLength(1);
    const fila = filas.rows[0];
    if (fila === undefined) {
      throw new Error('La migración debe conservar el contador existente.');
    }

    expect(fila.expires_at.getTime()).toBe(fila.window_started_at.getTime() + 15 * 60_000);
  } finally {
    await simulacion.close();
  }
}

/** Comprueba que la migración cree entidades y siembre el invariante. */
async function pruebaMigracionLimpia(): Promise<void> {
  if (sqlDeSeguridad === null) {
    throw new Error('La suite de integración requiere PostgreSQL aislado.');
  }

  const tablas = await sqlDeSeguridad<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'portal' AND table_name <> '__drizzle_migrations'
  `;
  const invariantes = await sqlDeSeguridad<{ cantidad: number }[]>`
    SELECT count(*)::int AS cantidad FROM portal.auth_invariants WHERE id = 1
  `;

  expect(tablas.map((tabla) => tabla.table_name).sort()).toEqual(
    [
      'audit_events',
      'auth_invariants',
      'auth_throttle_windows',
      'recovery_tokens',
      'sessions',
      'users',
      'clients',
      'client_sap_environments',
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
    SELECT count(*)::int AS cantidad FROM portal.__drizzle_migrations
  `;
  const invariantes = await sqlDeSeguridad<{ cantidad: number }[]>`
    SELECT count(*)::int AS cantidad FROM portal.auth_invariants
  `;

  expect(versiones[0]?.cantidad).toBe(6);
  expect(invariantes[0]?.cantidad).toBe(1);
}

/** Comprueba que PostgreSQL proteja el invariante cuenta activa-credencial. */
async function pruebaRestriccionDeCuentaActiva(): Promise<void> {
  if (sqlDeSeguridad === null) {
    throw new Error('La suite de integración requiere PostgreSQL aislado.');
  }

  await expect(
    sqlDeSeguridad.unsafe(`
      INSERT INTO portal.users (id, username, username_normalized, display_name, email, email_normalized, role, status)
      VALUES ('00000000-0000-4000-8000-000000000099', 'activa_99', 'activa_99', 'Cuenta activa', 'activa99@example.test', 'activa99@example.test', 'SUPPORT', 'ACTIVE')
    `),
  ).rejects.toThrow();
}

describe('migraciones con PostgreSQL real e aislado', definirPruebasDeMigracionesPostgres);
beforeAll(verificarPostgresAislado);
afterAll(cerrarPostgresAislado);
