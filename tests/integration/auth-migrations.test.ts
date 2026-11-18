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

  expect(versiones[0]?.cantidad).toBe(2);
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
