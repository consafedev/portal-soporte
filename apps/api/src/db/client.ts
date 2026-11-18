import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ConnectionOptions as OpcionesTls } from 'node:tls';
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
  const tls = resolverConfiguracionTlsBaseDatos(modo, url.hostname, entorno['DATABASE_SSL_CA']);
  const cliente = postgres(url.href, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 5,
    max_lifetime: 1_800,
    ssl: tls,
  });

  return drizzle(cliente, { schema: esquema });
}

/**
 * Resuelve TLS verificable para bases remotas y lo desactiva solo en loopback local.
 *
 * @param modo - Entorno que determina si la conexión local puede evitar TLS.
 * @param hostname - Host ya validado que aparece en la URL de PostgreSQL.
 * @param certificadoCa - Certificado CA PEM opcional para una autoridad privada confiable.
 * @returns Opciones TLS con validación de certificado/hostname o `false` en loopback local.
 * @throws Error si la CA configurada no tiene delimitadores PEM.
 */
export function resolverConfiguracionTlsBaseDatos(
  modo: string,
  hostname: string,
  certificadoCa?: string,
): false | OpcionesTls {
  const requiereTls = modo === 'production' || !esLoopback(hostname);
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
