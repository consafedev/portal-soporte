import postgres from 'postgres';
import {
  cargarConfiguracionBasePrueba,
  cargarConfiguracionMigracionPrueba,
  exigirArnesPostgresVerificado,
} from '../../apps/api/src/runtime-config.js';
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';
import {
  validarMismaInstanciaBasePrueba,
  verificarEstadoEsquemaBasePrueba,
  verificarIdentidadBasePrueba,
} from '../../apps/api/src/db/test-database-preflight.js';
import { migrarBaseAuth } from '../../apps/api/src/db/migrate.js';

/** Prepara solo una base vacía local o la forma exacta aislada ya migrada. */
export async function setup(): Promise<void> {
  const variables = { ...process.env, NODE_ENV: 'test' };
  exigirArnesPostgresVerificado(variables);
  const configuracion = cargarConfiguracionBasePrueba(variables);
  const sqlIdentidad = postgres(configuracion.TEST_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
    queue_timeout: 5,
    query_timeout: 5,
    connection: {
      application_name: 'portal-ps003-integration-setup',
      default_transaction_read_only: true,
      statement_timeout: 5_000,
      lock_timeout: 2_000,
      idle_in_transaction_session_timeout: 5_000,
    },
  });

  try {
    await validarConexionAplicacion(
      sqlIdentidad,
      configuracion.TEST_DATABASE_URL,
      configuracion.modo,
    );
    if (configuracion.modo === 'ssh-tunnel') {
      const identidadAplicacion = await verificarIdentidadBasePrueba(
        configuracion.TEST_DATABASE_URL,
        'portal_test_app',
      );
      const identidadMigrador = await verificarIdentidadBasePrueba(
        configuracion.TEST_MIGRATOR_DATABASE_URL,
        'portal_test_migrator',
      );
      validarMismaInstanciaBasePrueba(identidadAplicacion, identidadMigrador);
    }

    const estadoInicial = await verificarEstadoEsquemaBasePrueba(
      configuracion.TEST_MIGRATOR_DATABASE_URL,
    );
    if (configuracion.modo === 'local-ephemeral' && estadoInicial !== 'vacio') {
      throw new Error('La suite local requiere una base efímera nueva sin objetos.');
    }
    if (configuracion.modo === 'local-ephemeral' || estadoInicial === 'vacio') {
      await ejecutarMigracionesPrueba(variables);
    }
    exigirMigracionesLimpias(
      await verificarEstadoEsquemaBasePrueba(configuracion.TEST_MIGRATOR_DATABASE_URL),
    );
    if (configuracion.modo === 'ssh-tunnel') {
      const identidadAplicacion = await verificarIdentidadBasePrueba(
        configuracion.TEST_DATABASE_URL,
        'portal_test_app',
      );
      const identidadMigrador = await verificarIdentidadBasePrueba(
        configuracion.TEST_MIGRATOR_DATABASE_URL,
        'portal_test_migrator',
      );
      validarMismaInstanciaBasePrueba(identidadAplicacion, identidadMigrador);
    }
  } finally {
    await sqlIdentidad.end({ timeout: 5 });
  }
}

/** Verifica el nombre y el rol de aplicación sin registrar el DSN. */
async function validarConexionAplicacion(
  sql: ReturnType<typeof postgres>,
  url: string,
  modo: 'local-ephemeral' | 'ssh-tunnel',
): Promise<void> {
  const destino = new URL(url);
  const [identidad] = await sql<
    { nombreBase: string; rol: string; direccion: string | null; puerto: number }[]
  >`
    SELECT
      current_database() AS "nombreBase",
      current_user AS rol,
      host(inet_server_addr()) AS direccion,
      inet_server_port() AS puerto
  `;
  const esperado =
    modo === 'ssh-tunnel'
      ? {
          base: 'portal_soporte_test',
          rol: 'portal_test_app',
          direccion: '127.0.0.1',
          puerto: 5432,
        }
      : {
          base: 'portal_ps003_test',
          rol: 'ps003_test',
          direccion: null,
          puerto: Number(destino.port || '5432'),
        };

  if (
    identidad?.nombreBase !== esperado.base ||
    identidad.rol !== esperado.rol ||
    (modo === 'ssh-tunnel' && identidad.direccion !== esperado.direccion) ||
    (modo === 'local-ephemeral' &&
      (identidad.direccion === null ||
        !(identidad.direccion.startsWith('127.') || identidad.direccion === '::1'))) ||
    identidad.puerto !== esperado.puerto
  ) {
    throw new Error('La integración alcanzó una base o un rol distinto al configurado.');
  }
}

/** Ejecuta Drizzle con el rol migrador separado y cierra su pool limitado. */
async function ejecutarMigracionesPrueba(variables: NodeJS.ProcessEnv): Promise<void> {
  const destino = cargarConfiguracionMigracionPrueba(variables);
  const database = crearClienteBaseDatosAuth({
    ...variables,
    NODE_ENV: 'test',
    TEST_DATABASE_ROLE: 'portal_test_migrator',
    DATABASE_URL: destino.DATABASE_URL,
  });

  try {
    await migrarBaseAuth(database);
  } finally {
    await database.$client.end({ timeout: 5 });
  }
}

/** Rechaza que una suite empiece si quedaron cuentas, sesiones o auditoría previas. */
function exigirMigracionesLimpias(estado: 'vacio' | 'migrado'): void {
  if (estado !== 'migrado') {
    throw new Error('La preparación de integración no dejó las migraciones esperadas.');
  }
}
