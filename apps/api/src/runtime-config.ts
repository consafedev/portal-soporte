import { isIP } from 'node:net';

/** Dirección de escucha privada del API autenticado. */
export interface ConfiguracionEscuchaApi {
  /** Dirección loopback o privada a la que Fastify puede enlazarse. */
  readonly host: string;
  /** Puerto TCP explícito validado en el rango soportado por Node.js. */
  readonly port: number;
}

/** Modo explícito permitido para la base de datos de pruebas. */
export type ModoBasePrueba = 'local-ephemeral' | 'ssh-tunnel';

/** Roles explícitos para la base de pruebas aislada. */
export type RolConexionBasePrueba = 'portal_test_app' | 'portal_test_migrator';

/** DSN de aplicación y migración validados para una base PostgreSQL de pruebas. */
export interface ConfiguracionBasePrueba {
  /** Modo de ejecución que limita los destinos autorizados. */
  readonly modo: ModoBasePrueba;
  /** DSN del rol de prueba usado por integración y E2E. */
  readonly TEST_DATABASE_URL: string;
  /** DSN del rol limitado que aplica migraciones y prueba DDL. */
  readonly TEST_MIGRATOR_DATABASE_URL: string;
}

/** Una sola conexión validada para evitar exponer el DSN de otro rol. */
export interface ConfiguracionConexionBasePrueba {
  /** Modo de ejecución que limita los destinos autorizados. */
  readonly modo: ModoBasePrueba;
  /** DSN del único rol que debe recibir el proceso actual. */
  readonly DATABASE_URL: string;
}

/** Variables permitidas para migrar únicamente la base aislada de pruebas. */
export interface ConfiguracionMigracionPrueba {
  /** Fija el cliente PostgreSQL al entorno estricto de pruebas. */
  readonly NODE_ENV: 'test';
  /** DSN del rol migrador en la base de pruebas aislada. */
  readonly DATABASE_URL: string;
}

/** Bloquea conexiones a PostgreSQL de pruebas fuera del runner que valida su aislamiento. */
export function exigirArnesPostgresVerificado(variables: NodeJS.ProcessEnv): void {
  const modo = variables['TEST_DATABASE_MODE'];
  if (
    variables['PORTAL_TEST_HARNESS_VERIFIED'] !== '1' ||
    (modo !== 'local-ephemeral' && modo !== 'ssh-tunnel')
  ) {
    throw new Error('La conexión PostgreSQL de pruebas requiere el harness aislado verificado.');
  }
}

/** Impide que una URL manual se confunda con el clúster local creado por el runner. */
export function validarModoEntradaHarnessPrueba(variables: NodeJS.ProcessEnv): void {
  const modo = variables['TEST_DATABASE_MODE'];
  const url = variables['TEST_DATABASE_URL'];

  if (modo !== undefined && modo !== 'local-ephemeral' && modo !== 'ssh-tunnel') {
    throw new Error('TEST_DATABASE_MODE debe ser local-ephemeral o ssh-tunnel.');
  }
  if (url !== undefined && modo !== 'ssh-tunnel') {
    throw new Error('Una URL externa de pruebas requiere el modo SSH remoto explícito.');
  }
  if (modo === 'ssh-tunnel' && (url === undefined || url.length === 0)) {
    throw new Error('El modo remoto requiere TEST_DATABASE_URL antes de iniciar cualquier prueba.');
  }
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
 * Valida la base de pruebas local efímera o remota por túnel SSH.
 *
 * @param variables - Entorno de pruebas con DSN de aplicación y, en modo remoto, migrador.
 * @returns Modo y DSN ya validados para acceso de aplicación y migración.
 * @throws Error si el entorno o cualquiera de los destinos no coincide con el allowlist.
 */
export function cargarConfiguracionBasePrueba(
  variables: NodeJS.ProcessEnv,
): ConfiguracionBasePrueba {
  const conexionAplicacion = cargarConfiguracionConexionPrueba(variables, 'portal_test_app');
  const conexionMigrador = cargarConfiguracionConexionPrueba(variables, 'portal_test_migrator');

  if (conexionAplicacion.modo !== conexionMigrador.modo) {
    throw new Error('La configuración remota de pruebas no cumple el contrato aislado.');
  }

  return {
    modo: conexionAplicacion.modo,
    TEST_DATABASE_URL: conexionAplicacion.DATABASE_URL,
    TEST_MIGRATOR_DATABASE_URL: conexionMigrador.DATABASE_URL,
  };
}

/** Valida y devuelve solo el DSN del rol requerido por el proceso actual. */
export function cargarConfiguracionConexionPrueba(
  variables: NodeJS.ProcessEnv,
  rolEsperado: RolConexionBasePrueba,
): ConfiguracionConexionBasePrueba {
  if (variables['NODE_ENV'] !== 'test') {
    throw new Error('La base de pruebas solo admite NODE_ENV=test.');
  }

  const modo = variables['TEST_DATABASE_MODE'] ?? 'local-ephemeral';
  if (modo === 'local-ephemeral') {
    const valor =
      rolEsperado === 'portal_test_app'
        ? variables['TEST_DATABASE_URL']
        : (variables['TEST_MIGRATOR_DATABASE_URL'] ?? variables['TEST_DATABASE_URL']);
    const destino = validarUrlBaseLocalPrueba(valor);
    const urlApp = variables['TEST_DATABASE_URL'];
    const urlMigrador = variables['TEST_MIGRATOR_DATABASE_URL'];
    if (
      urlApp !== undefined &&
      urlMigrador !== undefined &&
      validarUrlBaseLocalPrueba(urlApp).href !== validarUrlBaseLocalPrueba(urlMigrador).href
    ) {
      throw new Error('TEST_MIGRATOR_DATABASE_URL debe coincidir con la base local efímera.');
    }

    return { modo, DATABASE_URL: destino.href };
  }

  if (
    modo !== 'ssh-tunnel' ||
    variables['TEST_DATABASE_ALLOW_MUTATIONS'] !== 'portal_soporte_test'
  ) {
    throw new Error('La configuración remota de pruebas no cumple el contrato aislado.');
  }

  const variableDsn =
    rolEsperado === 'portal_test_app' ? 'TEST_DATABASE_URL' : 'TEST_MIGRATOR_DATABASE_URL';
  const destino = validarUrlRemotaPrueba(variables[variableDsn], rolEsperado);
  return { modo, DATABASE_URL: destino.href };
}

/** Limita la CLI de migración al DSN migrador validado en el entorno de pruebas. */
export function cargarConfiguracionMigracionPrueba(
  variables: NodeJS.ProcessEnv,
): ConfiguracionMigracionPrueba {
  if (variables['NODE_ENV'] !== 'test') {
    throw new Error('La CLI de migración solo admite NODE_ENV=test.');
  }

  exigirArnesPostgresVerificado(variables);

  const configuracion = cargarConfiguracionConexionPrueba(variables, 'portal_test_migrator');
  return { NODE_ENV: 'test', DATABASE_URL: configuracion.DATABASE_URL };
}

/** Valida la URL local sintética conservada para clústeres efímeros. */
function validarUrlBaseLocalPrueba(valor: string | undefined): URL {
  const mensaje = 'TEST_DATABASE_URL debe señalar únicamente a portal_ps003_test en loopback.';
  if (valor === undefined) {
    throw new Error(mensaje);
  }

  let destino: URL;
  try {
    destino = new URL(valor);
  } catch {
    throw new Error(mensaje);
  }

  if (
    !['postgres:', 'postgresql:'].includes(destino.protocol) ||
    destino.pathname !== '/portal_ps003_test' ||
    !esLoopback(destino.hostname) ||
    destino.username !== 'ps003_test' ||
    destino.password.length > 0 ||
    destino.search.length > 0 ||
    destino.hash.length > 0 ||
    destino.href.endsWith('?') ||
    destino.href.endsWith('#')
  ) {
    throw new Error(mensaje);
  }

  return destino;
}

/** Valida un DSN remoto únicamente dentro del forward de prueba aprobado. */
function validarUrlRemotaPrueba(
  valor: string | undefined,
  rolEsperado: 'portal_test_app' | 'portal_test_migrator',
): URL {
  if (valor === undefined) {
    throw new Error('La configuración remota de pruebas no cumple el contrato aislado.');
  }

  let destino: URL;
  try {
    destino = new URL(valor);
  } catch {
    throw new Error('La configuración remota de pruebas no cumple el contrato aislado.');
  }

  if (
    !['postgres:', 'postgresql:'].includes(destino.protocol) ||
    destino.hostname !== '127.0.0.1' ||
    destino.port !== '15432' ||
    destino.pathname !== '/portal_soporte_test' ||
    destino.username !== rolEsperado ||
    destino.password.length === 0 ||
    destino.search.length > 0 ||
    destino.hash.length > 0 ||
    destino.href.endsWith('?') ||
    destino.href.endsWith('#')
  ) {
    throw new Error('La configuración remota de pruebas no cumple el contrato aislado.');
  }

  return destino;
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
