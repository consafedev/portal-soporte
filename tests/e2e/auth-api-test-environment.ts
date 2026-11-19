import { randomBytes } from 'node:crypto';
import {
  cargarConfiguracionConexionPrueba,
  exigirArnesPostgresVerificado,
} from '../../apps/api/src/runtime-config.ts';

/**
 * Construye un entorno mínimo del API E2E con el DSN del rol de aplicación.
 * @param variables Entorno heredado del arnés remoto o PostgreSQL local efímero.
 * @returns Variables permitidas para arrancar el API con identidad sintética de pruebas.
 * @throws Error si el arnés, la conexión, HMAC o prefijo de auditoría no son válidos.
 * @effects No abre conexiones ni registra valores del entorno; el proceso API recibe solo el rol app.
 */
export function crearEntornoApiPrueba(variables: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  exigirArnesPostgresVerificado(variables);
  const configuracion = cargarConfiguracionConexionPrueba(
    { ...variables, NODE_ENV: 'test' },
    'portal_test_app',
  );
  const claveHmac = variables['PORTAL_TEST_AUTH_HMAC_KEY'] ?? randomBytes(32).toString('base64url');
  if (Buffer.from(claveHmac, 'base64url').length < 32) {
    throw new Error('La clave efímera del limitador E2E no cumple la longitud mínima.');
  }
  const prefijoSolicitud = variables['PORTAL_TEST_REQUEST_ID_PREFIX'];
  if (prefijoSolicitud !== undefined && !/^ps003-test-[0-9a-f]{32}-$/u.test(prefijoSolicitud)) {
    throw new Error('El prefijo de solicitud E2E no cumple el formato aislado esperado.');
  }

  return {
    NODE_ENV: 'test',
    TEST_DATABASE_MODE: configuracion.modo,
    PORTAL_TEST_HARNESS_VERIFIED: '1',
    TEST_DATABASE_ROLE: 'portal_test_app',
    TEST_DATABASE_URL: configuracion.DATABASE_URL,
    DATABASE_URL: configuracion.DATABASE_URL,
    ...(configuracion.modo === 'ssh-tunnel'
      ? { TEST_DATABASE_ALLOW_MUTATIONS: variables['TEST_DATABASE_ALLOW_MUTATIONS'] }
      : {}),
    API_LISTEN_HOST: '127.0.0.1',
    API_LISTEN_PORT: '4100',
    API_INTERNAL_ORIGIN: 'http://127.0.0.1:4100',
    PUBLIC_APP_ORIGIN: 'http://127.0.0.1:3000',
    TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
    AUTH_THROTTLE_HMAC_KEY: claveHmac,
    ...(prefijoSolicitud === undefined ? {} : { PORTAL_TEST_REQUEST_ID_PREFIX: prefijoSolicitud }),
  };
}
