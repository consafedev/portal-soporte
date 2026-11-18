import postgres from 'postgres';
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';
import { migrarBaseAuth } from '../../apps/api/src/db/migrate.js';

/** Prepara migraciones una sola vez y solo sobre la base PostgreSQL loopback reservada. */
export async function setup(): Promise<void> {
  const baseUrl = process.env['TEST_DATABASE_URL'];
  if (baseUrl === undefined) {
    throw new Error('La suite de integración requiere TEST_DATABASE_URL.');
  }

  const url = new URL(baseUrl);
  const hostsLoopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(
    url.hostname.toLowerCase(),
  );
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !hostsLoopback ||
    url.username !== 'ps003_test' ||
    url.password.length !== 0 ||
    url.pathname !== '/portal_ps003_test' ||
    url.search.length !== 0 ||
    url.hash.length !== 0
  ) {
    throw new Error('La configuración global solo admite la base sintética en loopback.');
  }

  const sqlDeSeguridad = postgres(url.href, { max: 1 });
  const cliente = crearClienteBaseDatosAuth({ DATABASE_URL: url.href, NODE_ENV: 'test' });

  try {
    await verificarDestinoVacio(sqlDeSeguridad);
    await migrarBaseAuth(cliente);
  } finally {
    await cliente.$client.end({ timeout: 5 });
    await sqlDeSeguridad.end({ timeout: 5 });
  }
}

/** Verifica la identidad del servidor y rechaza tablas o esquemas previos sin borrarlos. */
async function verificarDestinoVacio(sql: ReturnType<typeof postgres>): Promise<void> {
  const [identidad] = await sql<{ nombre: string; loopback: boolean | null }[]>`
    SELECT
      current_database() AS nombre,
      (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() <<= '::1/128'::inet) AS loopback
  `;
  if (identidad?.nombre !== 'portal_ps003_test' || identidad.loopback !== true) {
    throw new Error(
      'La integración requiere portal_ps003_test en un servidor PostgreSQL de loopback.',
    );
  }

  const [estado] = await sql<{ tablas: number; esquemaMigraciones: boolean }[]>`
    SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public') AS tablas,
      EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'drizzle') AS "esquemaMigraciones"
  `;
  if (estado?.tablas !== 0 || estado.esquemaMigraciones) {
    throw new Error('La suite no modificará una base que ya tenga tablas o migraciones.');
  }
}
