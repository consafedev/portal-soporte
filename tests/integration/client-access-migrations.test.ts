import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type ConexionPostgres = ReturnType<typeof postgres>;

const marcadorRollback = new Error('ROLLBACK_FIXTURES_SINTETICOS');
let conexion: ConexionPostgres | null = null;

/** Comprueba que la integración solo alcance PostgreSQL aislado y ya migrado. */
async function prepararPostgresAislado(): Promise<void> {
  if (process.env['PORTAL_TEST_HARNESS_VERIFIED'] !== '1') {
    throw new Error('La prueba requiere el harness PostgreSQL aislado del Portal.');
  }

  const url = process.env['TEST_DATABASE_URL'];
  if (url === undefined) {
    throw new Error('TEST_DATABASE_URL debe apuntar a PostgreSQL aislado.');
  }

  conexion = postgres(url, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
    queue_timeout: 5,
    query_timeout: 10,
    connection: {
      application_name: 'portal-rf1-client-access-integration',
      statement_timeout: 10_000,
      lock_timeout: 2_000,
      idle_in_transaction_session_timeout: 5_000,
    },
  });

  const modo = process.env['TEST_DATABASE_MODE'] ?? 'local-ephemeral';
  const esperado =
    modo === 'ssh-tunnel'
      ? { base: 'portal_soporte_test', rol: 'portal_test_app' }
      : { base: 'portal_ps003_test', rol: 'ps003_test' };
  const [identidad] = await conexion<{ nombre: string; rol: string; loopback: boolean | null }[]>`
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
    await cerrarPostgresAislado();
    throw new Error('La integración no alcanzó la identidad aislada esperada y migrada.');
  }
}

/** Cierra únicamente la conexión abierta por esta prueba de integración. */
async function cerrarPostgresAislado(): Promise<void> {
  await conexion?.end({ timeout: 5 });
  conexion = null;
}

/** Ejecuta invariantes de asignación y capacidades en una transacción siempre revertida. */
async function probarRestriccionesEnPostgresReal(): Promise<void> {
  if (conexion === null) {
    throw new Error('PostgreSQL aislado no está preparado.');
  }

  const adminId = randomUUID();
  const supportId = randomUUID();
  const clientId = randomUUID();
  const assignmentId = randomUUID();
  const sufijo = randomUUID().replaceAll('-', '');

  try {
    await conexion.begin(async (transaccion) => {
      await transaccion`
        INSERT INTO portal.users
          (id, username, username_normalized, display_name, email, email_normalized, password_hash, role, status)
        VALUES
          (${adminId}, ${`admin_${sufijo}`}, ${`admin_${sufijo}`}, 'ADMIN sintético', ${`admin_${sufijo}@example.test`}, ${`admin_${sufijo}@example.test`}, 'hash-sintetico-de-prueba', 'ADMIN', 'ACTIVE'),
          (${supportId}, ${`support_${sufijo}`}, ${`support_${sufijo}`}, 'SUPPORT sintético', ${`support_${sufijo}@example.test`}, ${`support_${sufijo}@example.test`}, 'hash-sintetico-de-prueba', 'SUPPORT', 'ACTIVE')
      `;
      await transaccion`
        INSERT INTO portal.clients (id, display_name, status, created_by_user_id)
        VALUES (${clientId}, 'Cliente sintético de integración', 'ACTIVE', ${adminId})
      `;
      await transaccion`
        INSERT INTO portal.client_user_assignments (id, client_id, user_id, granted_by_user_id)
        VALUES (${assignmentId}, ${clientId}, ${supportId}, ${adminId})
      `;

      await transaccion.unsafe('SAVEPOINT asignacion_activa_unica');
      let duplicadoRechazado = false;
      try {
        await transaccion`
          INSERT INTO portal.client_user_assignments (id, client_id, user_id, granted_by_user_id)
          VALUES (${randomUUID()}, ${clientId}, ${supportId}, ${adminId})
        `;
      } catch {
        duplicadoRechazado = true;
        await transaccion.unsafe('ROLLBACK TO SAVEPOINT asignacion_activa_unica');
      }
      expect(duplicadoRechazado).toBe(true);

      await transaccion`
        UPDATE portal.client_user_assignments
        SET revoked_by_user_id = ${adminId}, revoked_at = now()
        WHERE id = ${assignmentId}
      `;
      await transaccion`
        INSERT INTO portal.client_user_assignments (id, client_id, user_id, granted_by_user_id)
        VALUES (${randomUUID()}, ${clientId}, ${supportId}, ${adminId})
      `;
      await transaccion`
        INSERT INTO portal.client_capabilities (client_id, capability_id, enabled, changed_by_user_id)
        VALUES (${clientId}, 'rf-1:read', true, ${adminId}),
               (${clientId}, 'rf-1:execute', false, ${adminId})
      `;

      await transaccion`
        UPDATE portal.client_capabilities SET enabled = true
        WHERE client_id = ${clientId} AND capability_id = 'rf-1:execute'
      `;

      const filas = await transaccion<
        { activas: number; capacidadesLectura: number; ejecucionHabilitada: boolean }[]
      >`
        SELECT
          (SELECT count(*)::integer FROM portal.client_user_assignments
           WHERE client_id = ${clientId} AND user_id = ${supportId} AND revoked_at IS NULL) AS activas,
          (SELECT count(*)::integer FROM portal.client_capabilities
           WHERE client_id = ${clientId} AND capability_id = 'rf-1:read' AND enabled) AS "capacidadesLectura",
          (SELECT enabled FROM portal.client_capabilities
           WHERE client_id = ${clientId} AND capability_id = 'rf-1:execute') AS "ejecucionHabilitada"
      `;
      expect(filas[0]).toEqual({ activas: 1, capacidadesLectura: 1, ejecucionHabilitada: true });

      throw marcadorRollback;
    });
  } catch (error) {
    if (error !== marcadorRollback) {
      throw error;
    }
  }
}

/** Registra la integración real de los invariantes de acceso por cliente. */
function definirPruebasAccesoClientePostgres(): void {
  it(
    'aplica restricciones de asignación y capacidad en PostgreSQL real',
    probarRestriccionesEnPostgresReal,
  );
}

describe(
  'asignaciones y capacidades de cliente en PostgreSQL real',
  definirPruebasAccesoClientePostgres,
);
beforeAll(prepararPostgresAislado);
afterAll(cerrarPostgresAislado);
