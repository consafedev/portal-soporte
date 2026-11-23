import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type ConexionPostgres = ReturnType<typeof postgres>;

const marcadorRollback = new Error('ROLLBACK_DESTINOS_SINTETICOS');
let conexion: ConexionPostgres | null = null;

/** Abre PostgreSQL solo si el harness confirmó base, rol y destino aislados. */
async function prepararPostgresAislado(): Promise<void> {
  if (process.env['PORTAL_TEST_HARNESS_VERIFIED'] !== '1') {
    throw new Error('La migración requiere el harness PostgreSQL aislado del Portal.');
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
      application_name: 'portal-ps0054-destination-migration-integration',
      statement_timeout: 10_000,
      lock_timeout: 2_000,
      idle_in_transaction_session_timeout: 5_000,
    },
  });

  const [identidad] = await conexion<
    { readonly nombreBase: string; readonly rol: string; readonly loopback: boolean | null }[]
  >`
    SELECT
      current_database() AS "nombreBase",
      current_user AS rol,
      inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() <<= '::1/128'::inet AS loopback
  `;

  if (
    identidad?.nombreBase !== 'portal_soporte_test' ||
    identidad.rol !== 'portal_test_app' ||
    identidad.loopback !== true
  ) {
    await cerrarPostgresAislado();
    throw new Error('La prueba no alcanzó la identidad aislada esperada.');
  }
}

/** Cierra exclusivamente la conexión abierta por esta prueba. */
async function cerrarPostgresAislado(): Promise<void> {
  await conexion?.end({ timeout: 5 });
  conexion = null;
}

/** Verifica columnas, consistencia MySQL/SSH y compatibilidad legacy dentro de un rollback. */
async function comprobarMigracionDestinosYRestricciones(): Promise<void> {
  if (conexion === null) {
    throw new Error('PostgreSQL aislado no está preparado.');
  }

  const columnas = await conexion<
    {
      readonly nombre: string;
      readonly tipo: string;
      readonly longitud: number | null;
      readonly admiteNulos: 'YES' | 'NO';
    }[]
  >`
    SELECT
      column_name AS nombre,
      data_type AS tipo,
      character_maximum_length AS longitud,
      is_nullable AS "admiteNulos"
    FROM information_schema.columns
    WHERE table_schema = 'portal'
      AND table_name = 'client_connection_profiles'
      AND column_name IN (
        'destination_hostname', 'destination_port', 'gateway_hostname',
        'gateway_port', 'gateway_fingerprint'
      )
    ORDER BY column_name
  `;

  expect(columnas).toEqual([
    {
      nombre: 'destination_hostname',
      tipo: 'character varying',
      longitud: 253,
      admiteNulos: 'YES',
    },
    { nombre: 'destination_port', tipo: 'integer', longitud: null, admiteNulos: 'YES' },
    { nombre: 'gateway_fingerprint', tipo: 'character varying', longitud: 50, admiteNulos: 'YES' },
    { nombre: 'gateway_hostname', tipo: 'character varying', longitud: 253, admiteNulos: 'YES' },
    { nombre: 'gateway_port', tipo: 'integer', longitud: null, admiteNulos: 'YES' },
  ]);

  const restricciones = await conexion<{ readonly nombre: string; readonly definicion: string }[]>`
    SELECT
      conname AS nombre,
      pg_get_constraintdef(oid) AS definicion
    FROM pg_constraint
    WHERE conrelid = 'portal.client_connection_profiles'::regclass
      AND conname IN (
        'client_connection_profiles_complete_endpoint_check',
        'client_connection_profiles_destination_endpoint_check',
        'client_connection_profiles_gateway_endpoint_check'
      )
    ORDER BY conname
  `;
  expect(restricciones.map(({ nombre }) => nombre)).toEqual([
    'client_connection_profiles_complete_endpoint_check',
    'client_connection_profiles_destination_endpoint_check',
    'client_connection_profiles_gateway_endpoint_check',
  ]);
  const definiciones = new Map(restricciones.map(({ nombre, definicion }) => [nombre, definicion]));
  expect(definiciones.get('client_connection_profiles_destination_endpoint_check')).toContain(
    'destination_hostname',
  );
  expect(definiciones.get('client_connection_profiles_gateway_endpoint_check')).toContain(
    'gateway_fingerprint',
  );
  expect(definiciones.get('client_connection_profiles_complete_endpoint_check')).toContain(
    'gateway_fingerprint IS NOT NULL',
  );
  expect(definiciones.get('client_connection_profiles_complete_endpoint_check')).toContain(
    'destination_port IS NOT NULL',
  );

  const usuarioId = randomUUID();
  const clienteId = randomUUID();
  const sufijo = randomUUID().replaceAll('-', '');

  try {
    await conexion.begin(async (transaccion) => {
      await transaccion`
        INSERT INTO portal.users
          (id, username, username_normalized, display_name, email, email_normalized,
           password_hash, role, status)
        VALUES
          (${usuarioId}, ${`admin_${sufijo}`}, ${`admin_${sufijo}`}, 'ADMIN sintético',
           ${`admin_${sufijo}@example.test`}, ${`admin_${sufijo}@example.test`},
           'hash-sintetico-no-autenticable', 'ADMIN', 'ACTIVE')
      `;
      await transaccion`
        INSERT INTO portal.clients (id, display_name, status, created_by_user_id)
        VALUES (${clienteId}, ${`Cliente sintético ${sufijo}`}, 'ACTIVE', ${usuarioId})
      `;

      /** Inserta un perfil sintético con parámetros, sin conservarlo al concluir el test. */
      async function insertarPerfil(
        tipo: 'MYSQL_TCP' | 'MYSQL_SSH',
        nombre: string,
        destino: { readonly hostname: string | null; readonly port: number | null },
        gateway: {
          readonly hostname: string | null;
          readonly port: number | null;
          readonly fingerprint: string | null;
        },
        destinoId: string,
        gatewayId: string | null,
      ): Promise<void> {
        await transaccion`
          INSERT INTO portal.client_connection_profiles
            (id, client_id, display_name, profile_type, environment, destination_id,
             gateway_id, database_name, secret_envelope, status, created_by_user_id,
             destination_hostname, destination_port, gateway_hostname, gateway_port,
             gateway_fingerprint)
          VALUES
            (${randomUUID()}, ${clienteId}, ${nombre}, ${tipo}, 'TEST', ${destinoId},
             ${gatewayId}, 'fixture_test', '{}'::jsonb, 'ACTIVE', ${usuarioId},
             ${destino.hostname}, ${destino.port}, ${gateway.hostname}, ${gateway.port},
             ${gateway.fingerprint})
        `;
      }

      /** Comprueba un rechazo de CHECK sin dejar abortada la transacción de test. */
      async function esperarRechazoCheck(insertar: () => Promise<unknown>): Promise<void> {
        await transaccion.unsafe('SAVEPOINT perfil_endpoint_invalido');
        let codigoSql: unknown;
        try {
          await insertar();
        } catch (error) {
          codigoSql =
            typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        }
        await transaccion.unsafe('ROLLBACK TO SAVEPOINT perfil_endpoint_invalido');
        expect(codigoSql).toBe('23514');
      }

      await insertarPerfil(
        'MYSQL_TCP',
        `Perfil legacy ${sufijo}`,
        { hostname: null, port: null },
        { hostname: null, port: null, fingerprint: null },
        'destino_legacy',
        null,
      );
      await insertarPerfil(
        'MYSQL_TCP',
        `Perfil directo ${sufijo}`,
        { hostname: 'mysql.example.test', port: 3306 },
        { hostname: null, port: null, fingerprint: null },
        'destino_directo',
        null,
      );
      await insertarPerfil(
        'MYSQL_SSH',
        `Perfil SSH ${sufijo}`,
        { hostname: '127.0.0.1', port: 3306 },
        {
          hostname: 'ssh.example.test',
          port: 22,
          fingerprint: `SHA256:${'A'.repeat(43)}`,
        },
        'destino_ssh',
        'gateway_ssh',
      );

      await esperarRechazoCheck(() =>
        insertarPerfil(
          'MYSQL_TCP',
          `Gateway indebido ${sufijo}`,
          { hostname: 'mysql.example.test', port: 3306 },
          {
            hostname: 'ssh.example.test',
            port: 22,
            fingerprint: `SHA256:${'A'.repeat(43)}`,
          },
          'destino_con_gateway',
          'gateway_indebido',
        ),
      );
      await esperarRechazoCheck(() =>
        insertarPerfil(
          'MYSQL_SSH',
          `Fingerprint ausente ${sufijo}`,
          { hostname: '127.0.0.1', port: 3306 },
          { hostname: 'ssh.example.test', port: 22, fingerprint: null },
          'destino_sin_huella',
          'gateway_sin_huella',
        ),
      );
      await esperarRechazoCheck(() =>
        insertarPerfil(
          'MYSQL_TCP',
          `Endpoint parcial ${sufijo}`,
          { hostname: 'mysql.example.test', port: null },
          { hostname: null, port: null, fingerprint: null },
          'destino_parcial',
          null,
        ),
      );

      throw marcadorRollback;
    });
  } catch (error) {
    if (error !== marcadorRollback) {
      throw error;
    }
  }
}

describe('migración PostgreSQL de destinos del perfil de conexión', () => {
  it(
    'guarda endpoints nullable y aplica consistencia a MySQL directo o SSH',
    comprobarMigracionDestinosYRestricciones,
  );
});

beforeAll(prepararPostgresAislado);
afterAll(cerrarPostgresAislado);
