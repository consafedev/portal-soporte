import { PGlite } from '@electric-sql/pglite';
import { getTableName } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authInvariants,
  auditEvents,
  authThrottleWindows,
  clientSapEnvironments,
  clients,
  recoveryTokens,
  sessions,
  users,
} from '../../apps/api/src/db/schema.js';
const database = new PGlite();

/** Prepara en PGlite el esquema versionado para simulaciones compatibles. */
async function prepararBaseSimulada(): Promise<void> {
  const migraciones = fileURLToPath(new URL('../../apps/api/drizzle/', import.meta.url));
  await migrate(drizzle(database), { migrationsFolder: migraciones, migrationsSchema: 'portal' });
  await database.exec('SET search_path TO portal');
}

/** Cierra PGlite después de las simulaciones del esquema. */
async function cerrarBaseSimulada(): Promise<void> {
  await database.close();
}

/** Agrupa comprobaciones de estructura y restricciones simulables en PGlite. */
function definirPruebasDeEsquemaPGlite(): void {
  it('mapea las tablas del Portal al esquema aislado portal', pruebaEsquemaPortalDrizzle);
  it('expone las tablas definidas en el esquema Drizzle', pruebaTablasDeIdentidad);
  it('siembra una sola fila centinela para invariantes de autenticación', pruebaFilaCentinelaUnica);
  it('mantiene tablas y ledger de autenticación dentro de portal', pruebaLedgerDentroDePortal);
  it(
    'permite cuenta pendiente sin hash y rechaza cuenta activa sin hash',
    pruebaHashPendienteYActivo,
  );
  it('impide duplicar nombres de usuario normalizados', pruebaUsernameUnico);
  it('impide duplicar correos normalizados', pruebaCorreoUnico);
  it('impide repetir hashes de tokens opacos', pruebaHashDeTokenUnico);
}

/** Comprueba que las consultas ORM queden cualificadas bajo el esquema propio del portal. */
function pruebaEsquemaPortalDrizzle(): void {
  const tablas = [
    users,
    sessions,
    recoveryTokens,
    authThrottleWindows,
    auditEvents,
    authInvariants,
    clients,
    clientSapEnvironments,
  ];

  expect(tablas.map((tabla) => getTableConfig(tabla).schema)).toEqual([
    'portal',
    'portal',
    'portal',
    'portal',
    'portal',
    'portal',
    'portal',
    'portal',
  ]);
}

/** Comprueba que el migrador Drizzle guarde sus versiones en el esquema aislado portal. */
async function pruebaLedgerDentroDePortal(): Promise<void> {
  const versiones = await database.query<{ cantidad: number }>(
    'SELECT count(*)::int AS cantidad FROM portal.__drizzle_migrations',
  );
  const ledgerPublico = await database.query<{ existe: boolean }>(
    "SELECT to_regclass('public.__drizzle_migrations') IS NOT NULL AS existe",
  );
  const tablasPortalPublicas = await database.query<{ cantidad: number }>(
    "SELECT count(*)::int AS cantidad FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('audit_events', 'auth_invariants', 'auth_throttle_windows', 'client_sap_environments', 'clients', 'recovery_tokens', 'sessions', 'users')",
  );
  const secuenciasLedger = await database.query<{ sequence_name: string }>(
    "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'portal'",
  );

  expect(versiones.rows).toEqual([{ cantidad: 6 }]);
  expect(ledgerPublico.rows).toEqual([{ existe: false }]);
  expect(tablasPortalPublicas.rows).toEqual([{ cantidad: 0 }]);
  expect(secuenciasLedger.rows).toEqual([{ sequence_name: '__drizzle_migrations_id_seq' }]);
}

/** Comprueba la presencia de las tablas persistentes del núcleo y catálogo de clientes. */
async function pruebaTablasDeIdentidad(): Promise<void> {
  const nombresEsperados = [
    getTableName(users),
    getTableName(sessions),
    getTableName(recoveryTokens),
    getTableName(authThrottleWindows),
    getTableName(auditEvents),
    getTableName(authInvariants),
    getTableName(clients),
    getTableName(clientSapEnvironments),
  ];
  const filas = await database.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'portal' AND table_name <> '__drizzle_migrations'",
  );

  expect(filas.rows.map((fila) => fila.table_name).sort()).toEqual(nombresEsperados.sort());
}

/** Comprueba que la migración siembre solo el identificador centinela uno. */
async function pruebaFilaCentinelaUnica(): Promise<void> {
  const filas = await database.query<{ id: number }>('SELECT id FROM auth_invariants');

  expect(filas.rows).toEqual([{ id: 1 }]);
}

/** Comprueba que una cuenta pendiente admite hash nulo y una activa no. */
async function pruebaHashPendienteYActivo(): Promise<void> {
  await database.query(
    `INSERT INTO users (id, username, username_normalized, display_name, email, email_normalized, role, status)
     VALUES ($1, 'pendiente_1', 'pendiente_1', 'Cuenta pendiente', 'pendiente@example.test', 'pendiente@example.test', 'SUPPORT', 'PENDING_ACTIVATION')`,
    ['00000000-0000-4000-8000-000000000001'],
  );

  await database.query(
    `INSERT INTO users (id, username, username_normalized, display_name, email, email_normalized, role, status)
     VALUES ($1, 'cancelada_1', 'cancelada_1', 'Invitación cancelada', 'cancelada@example.test', 'cancelada@example.test', 'SUPPORT', 'DISABLED')`,
    ['00000000-0000-4000-8000-000000000007'],
  );

  await expect(
    database.query(
      `INSERT INTO users (id, username, username_normalized, display_name, email, email_normalized, email_verified_at, role, status)
       VALUES ($1, 'verificada_1', 'verificada_1', 'Invitación verificada', 'verificada@example.test', 'verificada@example.test', '2026-11-18T00:00:00Z', 'SUPPORT', 'DISABLED')`,
      ['00000000-0000-4000-8000-000000000008'],
    ),
  ).rejects.toThrow();

  await expect(
    database.query(
      `INSERT INTO users (id, username, username_normalized, display_name, email, email_normalized, role, status)
       VALUES ($1, 'activa_1', 'activa_1', 'Cuenta activa', 'activa@example.test', 'activa@example.test', 'SUPPORT', 'ACTIVE')`,
      ['00000000-0000-4000-8000-000000000002'],
    ),
  ).rejects.toThrow();
}

/** Comprueba la restricción única del nombre de usuario canónico. */
async function pruebaUsernameUnico(): Promise<void> {
  await database.query(
    `INSERT INTO users (id, username, username_normalized, display_name, email, email_normalized, password_hash, role, status)
     VALUES ($1, 'agente_1', 'agente_1', 'Cuenta uno', 'uno@example.test', 'uno@example.test', 'hash-sintetico-uno', 'SUPPORT', 'ACTIVE')`,
    ['00000000-0000-4000-8000-000000000003'],
  );

  await expect(
    database.query(
      `INSERT INTO users (id, username, username_normalized, display_name, email, email_normalized, password_hash, role, status)
       VALUES ($1, 'Agente_1', 'agente_1', 'Cuenta dos', 'dos@example.test', 'dos@example.test', 'hash-sintetico-dos', 'SUPPORT', 'ACTIVE')`,
      ['00000000-0000-4000-8000-000000000004'],
    ),
  ).rejects.toThrow();
}

/** Comprueba que el correo canónico tenga una restricción de unicidad. */
async function pruebaCorreoUnico(): Promise<void> {
  await database.query(
    `INSERT INTO users (id, username, username_normalized, display_name, email, email_normalized, password_hash, role, status)
     VALUES ($1, 'correo_1', 'correo_1', 'Cuenta correo uno', 'uno@example.test', 'compartido@example.test', 'hash-sintetico-uno', 'SUPPORT', 'ACTIVE')`,
    ['00000000-0000-4000-8000-000000000005'],
  );

  await expect(
    database.query(
      `INSERT INTO users (id, username, username_normalized, display_name, email, email_normalized, password_hash, role, status)
       VALUES ($1, 'correo_2', 'correo_2', 'Cuenta correo dos', 'dos@example.test', 'compartido@example.test', 'hash-sintetico-dos', 'SUPPORT', 'ACTIVE')`,
      ['00000000-0000-4000-8000-000000000006'],
    ),
  ).rejects.toThrow();
}

/** Comprueba que PostgreSQL rechace la repetición de hashes de sesión y recuperación. */
async function pruebaHashDeTokenUnico(): Promise<void> {
  const idUsuario = '00000000-0000-4000-8000-000000000010';
  await database.query(
    `INSERT INTO users (id, username, username_normalized, display_name, email, email_normalized, password_hash, role, status)
     VALUES ($1, 'token_1', 'token_1', 'Cuenta de token', 'token@example.test', 'token@example.test', 'hash-sintetico-token', 'SUPPORT', 'ACTIVE')`,
    [idUsuario],
  );

  await database.query(
    `INSERT INTO sessions (id, user_id, token_hash, idle_expires_at, absolute_expires_at)
     VALUES ($1, $2, $3, '2030-01-01T00:00:00Z', '2030-01-01T08:00:00Z')`,
    ['00000000-0000-4000-8000-000000000011', idUsuario, 'a'.repeat(64)],
  );
  await expect(
    database.query(
      `INSERT INTO sessions (id, user_id, token_hash, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, '2030-01-01T00:00:00Z', '2030-01-01T08:00:00Z')`,
      ['00000000-0000-4000-8000-000000000012', idUsuario, 'a'.repeat(64)],
    ),
  ).rejects.toThrow();

  await database.query(
    `INSERT INTO recovery_tokens (id, user_id, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, 'PASSWORD_RECOVERY', '2030-01-01T00:00:00Z')`,
    ['00000000-0000-4000-8000-000000000013', idUsuario, 'b'.repeat(64)],
  );
  await expect(
    database.query(
      `INSERT INTO recovery_tokens (id, user_id, token_hash, purpose, expires_at)
       VALUES ($1, $2, $3, 'PASSWORD_RECOVERY', '2030-01-01T00:00:00Z')`,
      ['00000000-0000-4000-8000-000000000014', idUsuario, 'b'.repeat(64)],
    ),
  ).rejects.toThrow();
}

describe('simulación del esquema PostgreSQL con PGlite', definirPruebasDeEsquemaPGlite);
beforeAll(prepararBaseSimulada);
afterAll(cerrarBaseSimulada);
