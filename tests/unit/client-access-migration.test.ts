import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cerrarBaseClienteAccess,
  crearBaseClienteAccess,
} from '../support/client-access-migration-fixture.js';
import type { PGlite } from '@electric-sql/pglite';

let base: PGlite;

interface IdentidadesSinteticas {
  /** Identificador de la cuenta ADMIN que concede y revoca recursos. */
  readonly adminId: string;
  /** Identificador de la cuenta SUPPORT a la que se asigna el cliente. */
  readonly supportId: string;
  /** Identificador del cliente sintético aislado. */
  readonly clientId: string;
}

/** Aplica todas las migraciones antes de validar los invariantes del modelo. */
async function prepararBase(): Promise<void> {
  base = await crearBaseClienteAccess();
}

/** Cierra PGlite al completar las pruebas de la migración de acceso. */
async function cerrarBase(): Promise<void> {
  await cerrarBaseClienteAccess(base);
}

/** Crea ADMIN, SUPPORT y cliente con identificadores aleatorios solo de prueba. */
async function crearIdentidadesSinteticas(): Promise<IdentidadesSinteticas> {
  const adminId = randomUUID();
  const supportId = randomUUID();
  const clientId = randomUUID();
  const sufijo = randomUUID().replaceAll('-', '').slice(0, 16);

  await base.query(
    `INSERT INTO portal.users
      (id, username, username_normalized, display_name, email, email_normalized, password_hash, role, status)
     VALUES
      ($1, $3, $3, 'Admin sintético', $5, $5, 'hash-sintetico-admin', 'ADMIN', 'ACTIVE'),
      ($2, $4, $4, 'Soporte sintético', $6, $6, 'hash-sintetico-support', 'SUPPORT', 'ACTIVE')`,
    [
      adminId,
      supportId,
      `admin_${sufijo}`,
      `support_${sufijo}`,
      `admin_${sufijo}@example.test`,
      `support_${sufijo}@example.test`,
    ],
  );
  await base.query(
    `INSERT INTO portal.clients (id, display_name, status)
     VALUES ($1, 'Cliente sintético', 'ACTIVE')`,
    [clientId],
  );
  return { adminId, supportId, clientId };
}

/** Inserta una concesión sintética con actor y fecha explícitos para cada prueba. */
async function concederAcceso(
  ids: IdentidadesSinteticas,
  idAsignacion = randomUUID(),
  camposAdicionales = '',
  parametrosAdicionales: readonly unknown[] = [],
): Promise<void> {
  await base.query(
    `INSERT INTO portal.client_user_assignments
       (id, client_id, user_id, granted_by_user_id, granted_at${camposAdicionales})
     VALUES ($1, $2, $3, $4, '2026-11-21T00:00:00Z'${parametrosAdicionales.length > 0 ? ', ' + parametrosAdicionales.map((_, indice) => `$${indice + 5}`).join(', ') : ''})`,
    [idAsignacion, ids.clientId, ids.supportId, ids.adminId, ...parametrosAdicionales],
  );
}

/** Comprueba que la migración nueva y su ledger queden exclusivamente en portal. */
async function comprobarMigracionAditiva(): Promise<void> {
  const versiones = await base.query<{ cantidad: number }>(
    'SELECT count(*)::int AS cantidad FROM portal.__drizzle_migrations',
  );
  const tablas = await base.query<{ nombre: string }>(
    `SELECT table_name AS nombre FROM information_schema.tables
     WHERE table_schema = 'portal' AND table_name <> '__drizzle_migrations'
     ORDER BY table_name`,
  );
  const tablaPublica = await base.query<{ existe: boolean }>(
    "SELECT to_regclass('public.client_user_assignments') IS NOT NULL AS existe",
  );

  expect(versiones.rows).toEqual([{ cantidad: 9 }]);
  expect(tablas.rows.map((fila) => fila.nombre)).toEqual(
    [
      'audit_events',
      'auth_invariants',
      'auth_throttle_windows',
      'client_capabilities',
      'client_connection_profiles',
      'client_sap_environments',
      'client_user_assignments',
      'clients',
      'recovery_tokens',
      'sessions',
      'users',
    ].sort(),
  );
  expect(tablaPublica.rows).toEqual([{ existe: false }]);
}

/** Verifica que una concesión activa sea única y se pueda reactivar tras revocarse. */
async function comprobarConcesionUnicaYReasignacion(): Promise<void> {
  const ids = await crearIdentidadesSinteticas();
  await concederAcceso(ids);

  await expect(concederAcceso(ids)).rejects.toThrow();

  await base.query(
    `UPDATE portal.client_user_assignments
     SET revoked_by_user_id = $1, revoked_at = '2026-11-21T01:00:00Z'
     WHERE client_id = $2 AND user_id = $3 AND revoked_at IS NULL`,
    [ids.adminId, ids.clientId, ids.supportId],
  );
  await concederAcceso(ids);

  const filas = await base.query<{ total: number; activas: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE revoked_at IS NULL)::int AS activas
     FROM portal.client_user_assignments WHERE client_id = $1 AND user_id = $2`,
    [ids.clientId, ids.supportId],
  );
  expect(filas.rows).toEqual([{ total: 2, activas: 1 }]);
}

/** Rechaza borrar clientes o actores mientras permanezcan referencias de acceso. */
async function comprobarRestriccionesReferenciales(): Promise<void> {
  const ids = await crearIdentidadesSinteticas();
  await concederAcceso(ids);

  await expect(
    base.query('DELETE FROM portal.clients WHERE id = $1', [ids.clientId]),
  ).rejects.toThrow();
  await expect(
    base.query('DELETE FROM portal.users WHERE id = $1', [ids.supportId]),
  ).rejects.toThrow();
  await expect(
    base.query('DELETE FROM portal.users WHERE id = $1', [ids.adminId]),
  ).rejects.toThrow();
}

/** Aplica deny-by-default y permite habilitar capacidades conocidas de forma explícita. */
async function comprobarCapacidadesPorDefecto(): Promise<void> {
  const ids = await crearIdentidadesSinteticas();
  await base.query(
    `INSERT INTO portal.client_capabilities (client_id, capability_id, changed_by_user_id)
     VALUES ($1, 'rf-1:read', $2), ($1, 'rf-1:execute', $2)`,
    [ids.clientId, ids.adminId],
  );
  const capacidades = await base.query<{ capability_id: string; enabled: boolean }>(
    `SELECT capability_id, enabled FROM portal.client_capabilities
     WHERE client_id = $1 ORDER BY capability_id`,
    [ids.clientId],
  );

  expect(capacidades.rows).toEqual([
    { capability_id: 'rf-1:execute', enabled: false },
    { capability_id: 'rf-1:read', enabled: false },
  ]);
  await base.query(
    `UPDATE portal.client_capabilities SET enabled = true
     WHERE client_id = $1 AND capability_id = 'rf-1:execute'`,
    [ids.clientId],
  );
  const ejecucionHabilitada = await base.query<{ enabled: boolean }>(
    `SELECT enabled FROM portal.client_capabilities
     WHERE client_id = $1 AND capability_id = 'rf-1:execute'`,
    [ids.clientId],
  );
  expect(ejecucionHabilitada.rows).toEqual([{ enabled: true }]);
  await expect(
    base.query(
      `INSERT INTO portal.client_capabilities (client_id, capability_id, changed_by_user_id)
       VALUES ($1, 'rf-1:unknown', $2)`,
      [ids.clientId, ids.adminId],
    ),
  ).rejects.toThrow();
}

/** Exige coherencia entre identidad del revocador y fecha de revocación. */
async function comprobarMetadatosDeRevocacionCoherentes(): Promise<void> {
  await base.query('SELECT count(*) FROM portal.client_user_assignments');
  const idsConFecha = await crearIdentidadesSinteticas();
  const idsConActor = await crearIdentidadesSinteticas();

  await expect(
    concederAcceso(idsConFecha, randomUUID(), ', revoked_at', ['2026-11-21T01:00:00Z']),
  ).rejects.toThrow();
  await expect(
    concederAcceso(idsConActor, randomUUID(), ', revoked_by_user_id', [idsConActor.adminId]),
  ).rejects.toThrow();
}

/** Registra los casos de aceptación de la migración aditiva de acceso por cliente. */
function definirPruebasMigracionAccesoCliente(): void {
  it('aplica 0007 y crea ambas tablas únicamente en portal', comprobarMigracionAditiva);
  it(
    'permite solo una concesión activa y su regrant tras revocación',
    comprobarConcesionUnicaYReasignacion,
  );
  it(
    'restringe borrar cliente, usuario asignado y actor de la concesión',
    comprobarRestriccionesReferenciales,
  );
  it(
    'crea capacidades apagadas y permite execute solo con asignación explícita',
    comprobarCapacidadesPorDefecto,
  );
  it('rechaza actor y fecha de revocación incoherentes', comprobarMetadatosDeRevocacionCoherentes);
}

describe(
  'migración de asignaciones y capacidades PostgreSQL',
  definirPruebasMigracionAccesoCliente,
);
beforeAll(prepararBase);
afterAll(cerrarBase);
