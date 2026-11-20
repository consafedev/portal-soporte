import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ConnectionOptions as OpcionesTls } from 'node:tls';
import postgres, { type Sql } from 'postgres';
import {
  cargarConfiguracionConexionPrueba,
  exigirArnesPostgresVerificado,
} from '../runtime-config.js';
import * as esquema from './schema.js';

/** Tipo de la base autenticada y del cliente PostgreSQL que controla su ciclo de vida. */
export type BaseDatosAuth = PostgresJsDatabase<typeof esquema> & { $client: Sql };

/** Construye una base del portal con pool limitado y validación del destino de prueba. */
export function crearClienteBaseDatosAuth(entorno: NodeJS.ProcessEnv = process.env): BaseDatosAuth {
  const configuracion = { ...process.env, ...entorno };
  const urlBaseDatos = configuracion['DATABASE_URL'];
  const modo = configuracion['NODE_ENV'] ?? 'development';

  if (modo === 'test') {
    exigirArnesPostgresVerificado(configuracion);
  }

  if (urlBaseDatos === undefined || urlBaseDatos.length === 0) {
    throw new Error('DATABASE_URL es obligatorio para la persistencia de autenticación.');
  }

  const url = validarUrlBaseDatos(urlBaseDatos, modo, configuracion);
  const enPruebas = modo === 'test';
  const tls = resolverConfiguracionTlsBaseDatos(
    modo,
    url.hostname,
    configuracion['DATABASE_SSL_CA'],
  );
  const cliente = postgres(url.href, {
    max: enPruebas ? 3 : 10,
    idle_timeout: enPruebas ? 5 : 20,
    connect_timeout: 5,
    queue_timeout: enPruebas ? 5 : 0,
    query_timeout: enPruebas ? 20 : 0,
    max_lifetime: enPruebas ? 300 : 1_800,
    connection: {
      search_path: 'portal',
      ...(enPruebas
        ? {
            statement_timeout: 15_000,
            lock_timeout: 5_000,
            idle_in_transaction_session_timeout: 10_000,
          }
        : {}),
    },
    ssl: tls,
  });

  return drizzle(cliente, { schema: esquema });
}

/**
 * Resuelve TLS verificable para bases remotas y confía en el aislamiento del loopback local.
 *
 * @param modo - Entorno que determina si la conexión local puede evitar TLS.
 * @param hostname - Host ya validado que aparece en la URL de PostgreSQL.
 * @param certificadoCa - Certificado CA PEM opcional para una autoridad privada confiable.
 * @returns Opciones TLS con validación de certificado/hostname o `false` en loopback.
 * @throws Error si la CA configurada no tiene delimitadores PEM.
 */
export function resolverConfiguracionTlsBaseDatos(
  modo: string,
  hostname: string,
  certificadoCa?: string,
): false | OpcionesTls {
  const requiereTls = !esLoopback(hostname);
  if (!requiereTls) {
    return false;
  }

  if (
    certificadoCa !== undefined &&
    !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/u.test(certificadoCa)
  ) {
    throw new Error('DATABASE_SSL_CA debe contener un certificado CA PEM válido.');
  }

  return {
    rejectUnauthorized: true,
    ...(certificadoCa === undefined ? {} : { ca: certificadoCa }),
  };
}

/** Valida el protocolo y, durante pruebas, rechaza destinos fuera de la base local efímera. */
function validarUrlBaseDatos(valor: string, modo: string, entorno: NodeJS.ProcessEnv): URL {
  let url: URL;

  try {
    url = new URL(valor);
  } catch {
    throw new Error('DATABASE_URL debe ser una URL PostgreSQL válida.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL debe usar el protocolo PostgreSQL.');
  }

  if (
    [...url.searchParams.keys()].some((parametro) =>
      ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey'].includes(parametro.toLowerCase()),
    )
  ) {
    throw new Error(
      'DATABASE_URL no puede definir opciones TLS; use la configuración TLS del servidor.',
    );
  }

  if (modo === 'test') {
    if (entorno['TEST_DATABASE_MODE'] === 'ssh-tunnel') {
      const rolEsperado = entorno['TEST_DATABASE_ROLE'] ?? 'portal_test_app';
      if (rolEsperado !== 'portal_test_app' && rolEsperado !== 'portal_test_migrator') {
        throw new Error('TEST_DATABASE_ROLE debe ser un rol de prueba permitido.');
      }

      const destinoPrueba = cargarConfiguracionConexionPrueba(entorno, rolEsperado);
      if (url.href !== destinoPrueba.DATABASE_URL) {
        throw new Error('DATABASE_URL no coincide con el rol permitido de la base de pruebas.');
      }

      return url;
    }

    if (
      entorno['TEST_DATABASE_MODE'] !== undefined &&
      entorno['TEST_DATABASE_MODE'] !== 'local-ephemeral'
    ) {
      throw new Error('NODE_ENV=test requiere un modo de base de pruebas reconocido.');
    }

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
