import type { NextConfig } from 'next';
import { isIP } from 'node:net';

const modoProxy = process.env['NODE_ENV'] === 'development' ? 'development' : 'production';
const apiInternalOrigin = process.env['API_INTERNAL_ORIGIN'];
if (apiInternalOrigin === undefined) {
  throw new Error('API_INTERNAL_ORIGIN es obligatoria para compilar el proxy same-origin.');
}
const destinoApi = validarDestinoApiInterno(apiInternalOrigin, modoProxy);

const configuracion: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${destinoApi}/api/v1/:path*`,
      },
    ];
  },
};

export default configuracion;

/**
 * Valida el destino privado configurado para el rewrite same-origin de Next.js.
 *
 * @param valor - Valor de `API_INTERNAL_ORIGIN`, mantenido solo en el servidor.
 * @param entorno - Fase local o producción desde la que Next.js compila.
 * @returns Origen canónico que no puede apuntar a una red pública.
 * @throws Error si la URL o su destino no son internos y válidos.
 */
function validarDestinoApiInterno(valor: string, entorno: 'development' | 'production'): string {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error('API_INTERNAL_ORIGIN debe ser un origen absoluto válido.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== '/' ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    !esHostInterno(url.hostname) ||
    (entorno === 'development' && !esLoopback(url.hostname))
  ) {
    throw new Error('API_INTERNAL_ORIGIN debe apuntar al origen privado del API.');
  }

  return url.origin;
}

/** Reconoce hosts de loopback o redes reservadas para uso privado. */
function esHostInterno(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  const versionIp = isIP(host);
  if (versionIp === 4) {
    const octetos = host.split('.').map(Number);
    const primero = octetos[0] ?? -1;
    const segundo = octetos[1] ?? -1;

    return (
      primero === 10 ||
      (primero === 172 && segundo >= 16 && segundo <= 31) ||
      (primero === 192 && segundo === 168) ||
      (primero === 169 && segundo === 254) ||
      primero === 127
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

/** Reconoce loopback IPv4, IPv6 o localhost para proxy local de desarrollo. */
function esLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return (
    host === 'localhost' ||
    host === '::1' ||
    (isIP(host) === 4 && Number(host.split('.')[0]) === 127)
  );
}
