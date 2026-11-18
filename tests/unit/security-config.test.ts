import { describe, expect, it } from 'vitest';
import {
  cargarClaveHmacIntentos,
  cargarConfiguracionAuth,
  cargarConfiguracionSmtpAuth,
} from '../../apps/api/src/config.js';

const entornoBase = {
  PUBLIC_APP_ORIGIN: 'http://127.0.0.1:3000',
  API_INTERNAL_ORIGIN: 'http://127.0.0.1:4000',
};

/** Agrupa verificaciones de origen, cookies y confianza de proxy por ambiente. */
function definirPruebasDeConfiguracionAuth(): void {
  it('configura cookies distintas y no Secure en desarrollo loopback', pruebaCookiesDesarrollo);
  it('exige HTTPS y cookies seguras en producción', pruebaCookiesProduccion);
  it('mantiene cerrada una allowlist vacía de proxy en producción', pruebaProxyProduccionVacio);
  it('usa el nombre de cookie de pruebas solo en loopback', pruebaCookiesPrueba);
  it('valida y conserva proxies CIDR explícitos', pruebaListaProxies);
  it('limita CIDR de desarrollo a rangos enteros de loopback', pruebaRangosLoopbackProxy);
  it('rechaza orígenes públicos/inseguros o cabeceras proxy ambiguas', pruebaRechazaConfigInsegura);
  it('exige configuración SMTP segura en producción y permite ausencia local', pruebaSmtp);
  it('decodifica solo una clave HMAC canónica de 32 bytes', pruebaClaveHmac);
}

/** Comprueba transporte SMTP TLS y que una configuración parcial no pase inadvertida. */
function pruebaSmtp(): void {
  expect(cargarConfiguracionSmtpAuth({ NODE_ENV: 'development' })).toBeNull();
  expect(() => cargarConfiguracionSmtpAuth({ NODE_ENV: 'production' })).toThrow();
  expect(() =>
    cargarConfiguracionSmtpAuth({
      NODE_ENV: 'development',
      SMTP_HOST: 'relay.example.test',
      SMTP_PORT: '587',
      SMTP_FROM: 'portal@example.test',
      SMTP_SECURE: 'false',
      SMTP_USER: 'cuenta-sintetica',
    }),
  ).toThrow();
  expect(
    cargarConfiguracionSmtpAuth({
      NODE_ENV: 'development',
      SMTP_HOST: 'relay.example.test',
      SMTP_PORT: '587',
      SMTP_FROM: 'portal@example.test',
      SMTP_SECURE: 'false',
      SMTP_USER: 'cuenta-sintetica',
      SMTP_PASSWORD: 'valor-sintetico-de-prueba',
    }),
  ).toMatchObject({ host: 'relay.example.test', port: 587, secure: false });
}

/** Comprueba que la clave de límite de intentos represente exactamente 256 bits. */
function pruebaClaveHmac(): void {
  const claveSintetica = Buffer.alloc(32, 37).toString('base64url');

  expect(cargarClaveHmacIntentos({ AUTH_THROTTLE_HMAC_KEY: claveSintetica })).toHaveLength(32);
  expect(() =>
    cargarClaveHmacIntentos({ AUTH_THROTTLE_HMAC_KEY: 'clave-corta-sintetica' }),
  ).toThrow();
}

/** Comprueba el par de cookies de desarrollo y los atributos seguros comunes. */
function pruebaCookiesDesarrollo(): void {
  const configuracion = cargarConfiguracionAuth({ NODE_ENV: 'development', ...entornoBase });

  expect(configuracion.cookieSesionNombre).toBe('portal_dev_session');
  expect(configuracion.cookieCsrfNombre).toBe('portal_dev_csrf');
  expect(configuracion.cookiesSecure).toBe(false);
  expect(configuracion.publicAppOrigin).toBe('http://127.0.0.1:3000');
  expect(configuracion.trustedProxyCidrs).toEqual([]);
}

/** Comprueba que producción fija HTTPS, prefijo Host y nombres seguros. */
function pruebaCookiesProduccion(): void {
  const configuracion = cargarConfiguracionAuth({
    NODE_ENV: 'production',
    PUBLIC_APP_ORIGIN: 'https://portal.example.test',
    API_INTERNAL_ORIGIN: 'http://auth-api.internal:4000',
    TRUSTED_PROXY_CIDRS: '10.20.30.40/32',
  });

  expect(configuracion.cookieSesionNombre).toBe('__Host-portal_session');
  expect(configuracion.cookieCsrfNombre).toBe('__Host-portal_csrf');
  expect(configuracion.cookiesSecure).toBe(true);
  expect(configuracion.publicAppOrigin).toBe('https://portal.example.test');
}

/** Comprueba que una allowlist vacía en producción no confíe en peers reenviados. */
function pruebaProxyProduccionVacio(): void {
  const configuracion = cargarConfiguracionAuth({
    NODE_ENV: 'production',
    PUBLIC_APP_ORIGIN: 'https://portal.example.test',
    API_INTERNAL_ORIGIN: 'http://auth-api.internal:4000',
  });

  expect(configuracion.trustedProxyCidrs).toEqual([]);
}

/** Comprueba que NODE_ENV=test no reutilice nombres de desarrollo o producción. */
function pruebaCookiesPrueba(): void {
  const configuracion = cargarConfiguracionAuth({ NODE_ENV: 'test', ...entornoBase });

  expect(configuracion.cookieSesionNombre).toBe('portal_test_session');
  expect(configuracion.cookieCsrfNombre).toBe('portal_test_csrf');
  expect(configuracion.cookiesSecure).toBe(false);
}

/** Comprueba validación explícita de IPv4, IPv6 y prefijos CIDR. */
function pruebaListaProxies(): void {
  const configuracion = cargarConfiguracionAuth({
    NODE_ENV: 'production',
    PUBLIC_APP_ORIGIN: 'https://portal.example.test',
    API_INTERNAL_ORIGIN: 'http://10.20.30.40:4000',
    TRUSTED_PROXY_CIDRS: '10.20.0.0/16, 2001:db8::/48',
  });

  expect(configuracion.trustedProxyCidrs).toEqual(['10.20.0.0/16', '2001:db8::/48']);
}

/** Comprueba que los rangos confiables completos sean loopback y nunca universales. */
function pruebaRangosLoopbackProxy(): void {
  expect(
    cargarConfiguracionAuth({
      NODE_ENV: 'development',
      ...entornoBase,
      TRUSTED_PROXY_CIDRS: '127.0.0.0/8, ::1/128',
    }).trustedProxyCidrs,
  ).toEqual(['127.0.0.0/8', '::1/128']);

  for (const proxies of ['0.0.0.0/0', '::/0', '127.0.0.1/7', '::1/0', '0.0.0.0', '::']) {
    const entorno = proxies === '127.0.0.1/7' || proxies === '::1/0' ? 'development' : 'production';
    expect(() =>
      cargarConfiguracionAuth({
        NODE_ENV: entorno,
        PUBLIC_APP_ORIGIN:
          entorno === 'development' ? entornoBase.PUBLIC_APP_ORIGIN : 'https://portal.example.test',
        API_INTERNAL_ORIGIN: entornoBase.API_INTERNAL_ORIGIN,
        TRUSTED_PROXY_CIDRS: proxies,
      }),
    ).toThrow();
  }
}

/** Comprueba rechazo de esquemas, hosts internos y valores proxy no admitidos. */
function pruebaRechazaConfigInsegura(): void {
  expect(() =>
    cargarConfiguracionAuth({
      NODE_ENV: 'production',
      PUBLIC_APP_ORIGIN: 'http://portal.example.test',
      API_INTERNAL_ORIGIN: 'http://auth-api.internal:4000',
    }),
  ).toThrow();
  expect(() =>
    cargarConfiguracionAuth({
      NODE_ENV: 'development',
      ...entornoBase,
      PUBLIC_APP_ORIGIN: 'https://portal.example.test',
    }),
  ).toThrow();
  expect(() =>
    cargarConfiguracionAuth({
      NODE_ENV: 'production',
      PUBLIC_APP_ORIGIN: 'https://portal.example.test/path',
      API_INTERNAL_ORIGIN: 'http://auth-api.internal:4000',
    }),
  ).toThrow();
  expect(() =>
    cargarConfiguracionAuth({
      NODE_ENV: 'production',
      PUBLIC_APP_ORIGIN: 'https://portal.example.test',
      API_INTERNAL_ORIGIN: 'https://api.public.example.test',
    }),
  ).toThrow();

  for (const proxies of ['true', '*', '1', '10.0.0.0/33', 'not-an-ip']) {
    expect(() =>
      cargarConfiguracionAuth({
        NODE_ENV: 'production',
        PUBLIC_APP_ORIGIN: 'https://portal.example.test',
        API_INTERNAL_ORIGIN: 'http://auth-api.internal:4000',
        TRUSTED_PROXY_CIDRS: proxies,
      }),
    ).toThrow();
  }
}

describe('configuración de seguridad de autenticación', definirPruebasDeConfiguracionAuth);
