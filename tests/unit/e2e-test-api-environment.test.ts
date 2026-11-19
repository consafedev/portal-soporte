import { describe, expect, it } from 'vitest';
import { crearEntornoApiPrueba } from '../e2e/auth-api-test-environment.js';

/** Construye DSN remoto sintético para un proceso API E2E sin secretos compartidos. */
function crearUrlRemotaPrueba(usuario: 'portal_test_app' | 'portal_test_migrator'): string {
  const url = new URL('postgres://127.0.0.1:15432/portal_soporte_test');
  url.username = usuario;
  url.password = 'secreto-sintetico-no-real';

  return url.href;
}

describe('entorno aislado del API E2E', () => {
  it('entrega al servidor solo el DSN del rol de pruebas y omite el migrador', () => {
    const urlAplicacion = crearUrlRemotaPrueba('portal_test_app');
    const claveHmacSintetica = Buffer.alloc(32, 7).toString('base64url');
    const entorno = crearEntornoApiPrueba({
      NODE_ENV: 'test',
      TEST_DATABASE_MODE: 'ssh-tunnel',
      PORTAL_TEST_HARNESS_VERIFIED: '1',
      TEST_DATABASE_ALLOW_MUTATIONS: 'portal_soporte_test',
      TEST_DATABASE_URL: urlAplicacion,
      TEST_MIGRATOR_DATABASE_URL: crearUrlRemotaPrueba('portal_test_migrator'),
      PORTAL_TEST_AUTH_HMAC_KEY: claveHmacSintetica,
      SMTP_PASSWORD: 'otro-valor-sintetico',
      DATABASE_URL: 'postgres://host-invalido/base-produccion',
    });

    expect(entorno['DATABASE_URL']).toBe(urlAplicacion);
    expect(entorno['TEST_DATABASE_URL']).toBe(urlAplicacion);
    expect(entorno['TEST_DATABASE_ROLE']).toBe('portal_test_app');
    expect(entorno['TEST_MIGRATOR_DATABASE_URL']).toBeUndefined();
    expect(entorno['AUTH_THROTTLE_HMAC_KEY']).toBe(claveHmacSintetica);
    expect(entorno['PORTAL_TEST_AUTH_HMAC_KEY']).toBeUndefined();
    expect(entorno['SMTP_PASSWORD']).toBeUndefined();
  });
});
