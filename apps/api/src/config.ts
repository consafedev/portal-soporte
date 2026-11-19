import { isIP } from 'node:net';

/** Entornos de ejecución que pueden seleccionar políticas de cookies del portal. */
export type EntornoAuth = 'development' | 'test' | 'production';

/** Configuración validada de origen, proxy confiable y nombres de cookie. */
export interface ConfiguracionAuth {
  /** Entorno de ejecución explícito de Node.js. */
  readonly entorno: EntornoAuth;
  /** Único origen público canónico usado para validar Origin y crear enlaces. */
  readonly publicAppOrigin: string;
  /** Origen privado del API, accesible únicamente desde Next.js o red interna. */
  readonly apiInternalOrigin: string;
  /** Nombre de cookie de sesión seleccionado por entorno. */
  readonly cookieSesionNombre: string;
  /** Nombre de cookie doble envío de CSRF seleccionado por entorno. */
  readonly cookieCsrfNombre: string;
  /** Indica si ambas cookies deben llevar el atributo Secure. */
  readonly cookiesSecure: boolean;
  /** Lista explícita de IP o CIDR que Fastify puede tratar como proxies confiables. */
  readonly trustedProxyCidrs: readonly string[];
}

/** Configuración de envío SMTP con credenciales opcionales de un relé autorizado. */
export interface ConfiguracionSmtpAuth {
  /** Host del servidor SMTP configurado fuera del código. */
  readonly host: string;
  /** Puerto TCP SMTP validado. */
  readonly port: number;
  /** Selecciona TLS implícito; STARTTLS se exige cuando es false. */
  readonly secure: boolean;
  /** Nombre remitente del correo transaccional. */
  readonly remitente: string;
  /** Usuario SMTP opcional, siempre emparejado con password. */
  readonly user?: string;
  /** Secreto SMTP opcional, nunca incluido en logs o respuestas. */
  readonly password?: string;
}

const NOMBRES_COOKIE = {
  production: { sesion: '__Host-portal_session', csrf: '__Host-portal_csrf' },
  development: { sesion: 'portal_dev_session', csrf: 'portal_dev_csrf' },
  test: { sesion: 'portal_test_session', csrf: 'portal_test_csrf' },
} as const;

/**
 * Lee y valida toda la configuración de seguridad sin registrar valores recibidos.
 *
 * @param variables - Entorno de Node a validar; por defecto usa `process.env`.
 * @returns Configuración inmutable lista para construir Fastify y sus cookies.
 * @throws Error si faltan variables, el origen no es canónico o el proxy es inválido.
 */
export function cargarConfiguracionAuth(
  variables: NodeJS.ProcessEnv = process.env,
): ConfiguracionAuth {
  const entorno = resolverEntorno(variables['NODE_ENV']);
  const publicAppOrigin = validarOrigenPublico(
    exigirVariable(variables, 'PUBLIC_APP_ORIGIN'),
    entorno,
  );
  const apiInternalOrigin = validarOrigenApiInterno(
    exigirVariable(variables, 'API_INTERNAL_ORIGIN'),
    entorno,
  );
  const trustedProxyCidrs = validarListaProxies(variables['TRUSTED_PROXY_CIDRS'], entorno);
  const nombres = NOMBRES_COOKIE[entorno];

  return {
    entorno,
    publicAppOrigin,
    apiInternalOrigin,
    cookieSesionNombre: nombres.sesion,
    cookieCsrfNombre: nombres.csrf,
    cookiesSecure: entorno === 'production',
    trustedProxyCidrs: Object.freeze(trustedProxyCidrs),
  };
}

/** Carga SMTP opcional en local y obligatorio en producción, sin exponer valores sensibles. */
export function cargarConfiguracionSmtpAuth(
  variables: NodeJS.ProcessEnv = process.env,
): ConfiguracionSmtpAuth | null {
  const entorno = resolverEntorno(variables['NODE_ENV']);
  const host = variables['SMTP_HOST'];
  if (host === undefined || host.length === 0) {
    if (entorno === 'production' || hayConfiguracionSmtpParcial(variables)) {
      throw new Error(
        'SMTP_HOST y la configuración de transporte SMTP requerida no están completas.',
      );
    }

    return null;
  }

  const port = Number(variables['SMTP_PORT']);
  const secure = leerBooleanoEstricto(variables['SMTP_SECURE'], 'SMTP_SECURE');
  const remitente = variables['SMTP_FROM'] ?? '';
  const user = variables['SMTP_USER'];
  const password = variables['SMTP_PASSWORD'];
  if (
    !esHostSmtpValido(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    !esCorreoSmtpValido(remitente) ||
    (user === undefined || user.length === 0) !== (password === undefined || password.length === 0)
  ) {
    throw new Error('La configuración SMTP no tiene un formato seguro y completo.');
  }

  return {
    host,
    port,
    secure,
    remitente,
    ...(user === undefined || user.length === 0 ? {} : { user, password }),
  };
}

/** Decodifica la clave HMAC de intentos y exige al menos 256 bits de entropía configurada. */
export function cargarClaveHmacIntentos(variables: NodeJS.ProcessEnv = process.env): Buffer {
  const valor = variables['AUTH_THROTTLE_HMAC_KEY'];
  if (valor === undefined || !/^[A-Za-z0-9_-]{43}$/u.test(valor)) {
    throw new Error('AUTH_THROTTLE_HMAC_KEY debe ser una clave base64url de 32 bytes.');
  }

  const clave = Buffer.from(valor, 'base64url');
  if (clave.length !== 32 || clave.toString('base64url') !== valor) {
    throw new Error('AUTH_THROTTLE_HMAC_KEY debe codificar exactamente 32 bytes.');
  }

  return clave;
}

/**
 * Valida un destino privado del proxy web y devuelve solo su origen canónico.
 *
 * @param valor - Valor configurado en `API_INTERNAL_ORIGIN`.
 * @param entorno - Entorno que impone loopback en desarrollo y pruebas.
 * @returns Origen absoluto sin ruta, usuario, consulta o fragmento.
 * @throws Error si el destino no pertenece a una red interna admitida.
 */
export function validarOrigenApiInterno(valor: string, entorno: EntornoAuth): string {
  const url = parsearOrigen(valor, 'API_INTERNAL_ORIGIN');
  if (!esOrigenInterno(url.hostname)) {
    throw new Error('API_INTERNAL_ORIGIN debe apuntar a un destino privado del portal.');
  }

  if (entorno !== 'production' && !esLoopback(url.hostname)) {
    throw new Error('API_INTERNAL_ORIGIN debe usar loopback fuera de producción.');
  }

  return url.origin;
}

/** Valida el origen único del navegador y fuerza HTTPS en producción. */
function validarOrigenPublico(valor: string, entorno: EntornoAuth): string {
  const url = parsearOrigen(valor, 'PUBLIC_APP_ORIGIN');
  if (entorno === 'production' && url.protocol !== 'https:') {
    throw new Error('PUBLIC_APP_ORIGIN debe usar HTTPS en producción.');
  }

  if (entorno !== 'production' && !esLoopback(url.hostname)) {
    throw new Error('PUBLIC_APP_ORIGIN debe usar loopback fuera de producción.');
  }

  return url.origin;
}

/** Interpreta una URL base sin aceptar rutas, credenciales ni componentes variables. */
function parsearOrigen(valor: string, nombre: string): URL {
  if (valor.length === 0 || valor.trim() !== valor) {
    throw new Error(`${nombre} debe ser un origen absoluto canónico.`);
  }

  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error(`${nombre} debe ser un origen absoluto válido.`);
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== '/' ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(`${nombre} no puede incluir ruta, credenciales, consulta o fragmento.`);
  }

  return url;
}

/** Valida la lista CIDR; una lista ausente confía en el peer del socket y no en proxies. */
function validarListaProxies(valor: string | undefined, entorno: EntornoAuth): string[] {
  if (valor === undefined || valor.trim().length === 0) {
    return [];
  }

  const proxies = valor.split(',').map((entrada) => entrada.trim());
  if (proxies.some((entrada) => entrada.length === 0)) {
    throw new Error('TRUSTED_PROXY_CIDRS contiene una entrada vacía.');
  }

  return proxies.map((entrada) => validarCidrProxy(entrada, entorno));
}

/** Detecta variables SMTP sueltas para que un error de configuración falle temprano. */
function hayConfiguracionSmtpParcial(variables: NodeJS.ProcessEnv): boolean {
  return [
    variables['SMTP_PORT'],
    variables['SMTP_SECURE'],
    variables['SMTP_FROM'],
    variables['SMTP_USER'],
    variables['SMTP_PASSWORD'],
  ].some((valor) => valor !== undefined);
}

/** Acepta nombres DNS o direcciones IP sin credenciales, puerto, ruta ni espacios. */
function esHostSmtpValido(host: string): boolean {
  return (
    host.length <= 253 &&
    host.trim() === host &&
    !/[\s/@\\]/u.test(host) &&
    (isIP(host) !== 0 || /^[A-Za-z0-9.-]+$/u.test(host))
  );
}

/** Rechaza remitentes con sintaxis incompleta o caracteres de inyección de cabeceras. */
function esCorreoSmtpValido(correo: string): boolean {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/u.test(correo);
}

/** Interpreta booleanos de configuración sin truthiness implícita ni variantes ambiguas. */
function leerBooleanoEstricto(valor: string | undefined, nombre: string): boolean {
  if (valor === 'true') {
    return true;
  }
  if (valor === 'false') {
    return false;
  }

  throw new Error(`${nombre} debe configurarse explícitamente como true o false.`);
}

/** Acepta solo IP/CIDR válido y, fuera de producción, limita la confianza a loopback. */
function validarCidrProxy(valor: string, entorno: EntornoAuth): string {
  const [direccion, prefijo, ...sobrantes] = valor.split('/');
  const versionIp = direccion === undefined ? 0 : isIP(direccion);
  const bitsMaximos = versionIp === 4 ? 32 : versionIp === 6 ? 128 : 0;
  const prefijoValido =
    prefijo === undefined ||
    (/^(0|[1-9]\d{0,2})$/u.test(prefijo) && Number(prefijo) <= bitsMaximos);

  if (direccion === undefined || versionIp === 0 || sobrantes.length > 0 || !prefijoValido) {
    throw new Error('TRUSTED_PROXY_CIDRS solo admite direcciones IP o CIDR válidos.');
  }

  const longitudPrefijo = prefijo === undefined ? bitsMaximos : Number(prefijo);
  const direccionSinCorchetes = direccion.toLowerCase().replace(/^\[|\]$/gu, '');
  if (
    longitudPrefijo === 0 ||
    direccionSinCorchetes === '0.0.0.0' ||
    direccionSinCorchetes === '::'
  ) {
    throw new Error('TRUSTED_PROXY_CIDRS no admite direcciones universales o no especificadas.');
  }

  const esRangoLoopbackCompleto =
    (versionIp === 4 && esLoopback(direccion) && longitudPrefijo >= 8) ||
    (versionIp === 6 && direccionSinCorchetes === '::1' && longitudPrefijo === 128);
  if (entorno !== 'production' && !esRangoLoopbackCompleto) {
    throw new Error('TRUSTED_PROXY_CIDRS solo puede confiar en loopback fuera de producción.');
  }

  return valor;
}

/** Obtiene una variable requerida y evita mostrarla en mensajes de error. */
function exigirVariable(variables: NodeJS.ProcessEnv, nombre: string): string {
  const valor = variables[nombre];
  if (valor === undefined || valor.length === 0) {
    throw new Error(`${nombre} es obligatoria para iniciar el núcleo de autenticación.`);
  }

  return valor;
}

/** Rechaza valores NODE_ENV que no tengan una política de cookies aprobada. */
function resolverEntorno(valor: string | undefined): EntornoAuth {
  if (valor === 'development' || valor === 'test' || valor === 'production') {
    return valor;
  }

  throw new Error('NODE_ENV debe ser development, test o production.');
}

/** Comprueba si una dirección representa loopback reconocido por la plataforma. */
function esLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (host === 'localhost' || host === '::1') {
    return true;
  }

  if (isIP(host) !== 4) {
    return false;
  }

  return Number(host.split('.')[0]) === 127;
}

/** Comprueba que el host sea loopback, IP privada o nombre DNS local explícito. */
function esOrigenInterno(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  const versionIp = isIP(host);
  if (versionIp === 4) {
    const octetos = host.split('.').map(Number);
    const primero = octetos[0] ?? -1;
    const segundo = octetos[1] ?? -1;

    return (
      esLoopback(hostname) ||
      primero === 10 ||
      (primero === 172 && segundo >= 16 && segundo <= 31) ||
      (primero === 192 && segundo === 168) ||
      (primero === 169 && segundo === 254)
    );
  }

  if (versionIp === 6) {
    return host === '::1' || /^(?:fc|fd|fe8|fe9|fea|feb)/u.test(host);
  }

  return (
    host === 'localhost' ||
    !host.includes('.') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  );
}
