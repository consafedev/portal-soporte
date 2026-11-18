import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as esquema from './schema.js';

/** Tipo de la base autenticada y del cliente PostgreSQL que controla su ciclo de vida. */
export type BaseDatosAuth = PostgresJsDatabase<typeof esquema> & { $client: Sql };

/** Construye una base del portal con pool limitado y validación del destino de prueba. */
export function crearClienteBaseDatosAuth(entorno: NodeJS.ProcessEnv = process.env): BaseDatosAuth {
  const urlBaseDatos = entorno['DATABASE_URL'];
  const modo = entorno['NODE_ENV'] ?? 'development';

  if (urlBaseDatos === undefined || urlBaseDatos.length === 0) {
    throw new Error('DATABASE_URL es obligatorio para la persistencia de autenticación.');
  }

  const url = validarUrlBaseDatos(urlBaseDatos, modo);
  const requiereTls = modo === 'production' || !esLoopback(url.hostname);
  const cliente = postgres(url.href, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 5,
    max_lifetime: 1_800,
    ssl: requiereTls ? 'require' : false,
  });

  return drizzle(cliente, { schema: esquema });
}

/** Valida el protocolo y, durante pruebas, rechaza destinos fuera de la base local efímera. */
function validarUrlBaseDatos(valor: string, modo: string): URL {
  let url: URL;

  try {
    url = new URL(valor);
  } catch {
    throw new Error('DATABASE_URL debe ser una URL PostgreSQL válida.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL debe usar el protocolo PostgreSQL.');
  }

  if (modo === 'test') {
    const baseLocalPermitida =
      url.pathname === '/portal_ps003_test' &&
      esLoopback(url.hostname) &&
      url.password.length === 0 &&
      url.username === 'ps003_test' &&
      url.search.length === 0 &&
      url.hash.length === 0;

    if (!baseLocalPermitida) {
      throw new Error(
        'NODE_ENV=test solo permite la base portal_ps003_test con usuario sintético en loopback.',
      );
    }
  }

  return url;
}

/** Reconoce solo los nombres locales y direcciones IP de loopback. */
function esLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname.toLowerCase());
}
