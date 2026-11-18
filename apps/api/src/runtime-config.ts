import { isIP } from 'node:net';

/** Dirección de escucha privada del API autenticado. */
export interface ConfiguracionEscuchaApi {
  /** Dirección loopback o privada a la que Fastify puede enlazarse. */
  readonly host: string;
  /** Puerto TCP explícito validado en el rango soportado por Node.js. */
  readonly port: number;
}

/** Variables permitidas para aplicar migraciones contra el PostgreSQL efímero de pruebas. */
export interface ConfiguracionMigracionPrueba {
  /** Fija el cliente PostgreSQL al modo estricto de pruebas. */
  readonly NODE_ENV: 'test';
  /** URL sin contraseña de la base local desechable autorizada. */
  readonly DATABASE_URL: string;
}

/**
 * Valida la interfaz privada de escucha sin confiar en headers ni destinos públicos.
 *
 * @param variables - Entorno de proceso cuyo destino nunca se escribe en logs.
 * @returns Host y puerto loopback/privados listos para `Fastify.listen`.
 * @throws Error si host, entorno o puerto permiten una escucha no privada.
 */
export function cargarConfiguracionEscuchaApi(
  variables: NodeJS.ProcessEnv = process.env,
): ConfiguracionEscuchaApi {
  const entorno = variables['NODE_ENV'];
  const host = variables['API_LISTEN_HOST'] ?? '127.0.0.1';
  const portTexto = variables['API_LISTEN_PORT'] ?? '4100';
  if (entorno !== 'development' && entorno !== 'test' && entorno !== 'production') {
    throw new Error('NODE_ENV debe ser development, test o production.');
  }
  if (!esDestinoPrivado(host, entorno)) {
    throw new Error('API_LISTEN_HOST debe ser loopback o una IP privada explícita.');
  }
  if (!/^[1-9]\d{0,4}$/u.test(portTexto)) {
    throw new Error('API_LISTEN_PORT debe ser un entero entre 1 y 65535.');
  }
  const port = Number(portTexto);
  if (!Number.isInteger(port) || port > 65_535) {
    throw new Error('API_LISTEN_PORT debe ser un entero entre 1 y 65535.');
  }

  return { host, port };
}

/**
 * Cierra el destino de la CLI de migración a una base sintética y loopback.
 *
 * @param variables - Entorno que debe contener `NODE_ENV=test` y TEST_DATABASE_URL.
 * @returns Variables acotadas para crear un cliente PostgreSQL de pruebas.
 * @throws Error si el destino no es la base portal_ps003_test local sin contraseña.
 */
export function cargarConfiguracionMigracionPrueba(
  variables: NodeJS.ProcessEnv,
): ConfiguracionMigracionPrueba {
  if (variables['NODE_ENV'] !== 'test') {
    throw new Error('La CLI de migración solo admite NODE_ENV=test.');
  }
  const valor = variables['TEST_DATABASE_URL'];
  if (valor === undefined) {
    throw new Error('TEST_DATABASE_URL debe señalar únicamente a portal_ps003_test en loopback.');
  }

  let destino: URL;
  try {
    destino = new URL(valor);
  } catch {
    throw new Error('TEST_DATABASE_URL debe señalar únicamente a portal_ps003_test en loopback.');
  }
  if (
    (destino.protocol !== 'postgres:' && destino.protocol !== 'postgresql:') ||
    destino.pathname !== '/portal_ps003_test' ||
    !esLoopback(destino.hostname) ||
    destino.username !== 'ps003_test' ||
    destino.password.length > 0 ||
    destino.search.length > 0 ||
    destino.hash.length > 0 ||
    destino.href.endsWith('?') ||
    destino.href.endsWith('#')
  ) {
    throw new Error('TEST_DATABASE_URL debe señalar únicamente a portal_ps003_test en loopback.');
  }

  return { NODE_ENV: 'test', DATABASE_URL: destino.href };
}

/**
 * Rechaza destinos públicos, comodines y nombres no verificables para el socket.
 *
 * @param host - Dirección configurada para enlazar el listener.
 * @param entorno - Entorno que habilita `localhost` solo fuera de producción.
 * @returns `true` cuando el host es loopback o una IP privada admitida.
 */
function esDestinoPrivado(host: string, entorno: string): boolean {
  if (host === 'localhost') {
    return entorno !== 'production';
  }

  const versionIp = isIP(host);
  if (versionIp === 4) {
    return esLoopback(host) || esIpv4Privada(host);
  }
  if (versionIp === 6) {
    return esLoopback(host) || /^(?:fc|fd)[0-9a-f]{2}:/iu.test(host);
  }

  return false;
}

/**
 * Reconoce loopback IPv4/IPv6 sin permitir una interfaz comodín.
 *
 * @param host - Host literal o hostname localhost ya validado.
 * @returns `true` únicamente para loopback.
 */
function esLoopback(host: string): boolean {
  const normalizado = host.toLowerCase().replace(/^\[|\]$/gu, '');
  if (normalizado === '::1' || normalizado === 'localhost') {
    return true;
  }

  if (isIP(normalizado) !== 4) {
    return false;
  }

  return Number(normalizado.split('.')[0]) === 127;
}

/**
 * Acepta RFC1918 y excluye rangos públicos y link-local.
 *
 * @param host - Dirección IPv4 validada previamente por `isIP`.
 * @returns `true` si pertenece a 10/8, 172.16/12 o 192.168/16.
 */
function esIpv4Privada(host: string): boolean {
  const octetos = host.split('.').map(Number);
  const primero = octetos[0] ?? -1;
  const segundo = octetos[1] ?? -1;

  return (
    primero === 10 ||
    (primero === 172 && segundo >= 16 && segundo <= 31) ||
    (primero === 192 && segundo === 168)
  );
}
