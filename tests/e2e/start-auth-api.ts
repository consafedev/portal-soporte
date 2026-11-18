import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const nombreBasePrueba = 'portal_ps003_test';
const usuarioBasePrueba = 'ps003_test';

/** Comprueba que el API solo reciba el destino local creado por el harness. */
function crearEntornoApiPrueba(): NodeJS.ProcessEnv {
  const valorUrl = process.env['TEST_DATABASE_URL'];
  if (valorUrl === undefined) {
    throw new Error('Falta el PostgreSQL efímero creado por el harness de E2E.');
  }

  let destino: URL;
  try {
    destino = new URL(valorUrl);
  } catch {
    throw new Error('El destino PostgreSQL de E2E no es válido.');
  }

  if (
    !['postgres:', 'postgresql:'].includes(destino.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(destino.hostname.toLowerCase()) ||
    destino.pathname !== `/${nombreBasePrueba}` ||
    destino.username !== usuarioBasePrueba ||
    destino.password.length > 0 ||
    destino.search.length > 0 ||
    destino.hash.length > 0
  ) {
    throw new Error('El API de E2E solo admite portal_ps003_test sin contraseña en loopback.');
  }

  const entorno: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: destino.href,
    API_LISTEN_HOST: '127.0.0.1',
    API_LISTEN_PORT: '4100',
    API_INTERNAL_ORIGIN: 'http://127.0.0.1:4100',
    PUBLIC_APP_ORIGIN: 'http://127.0.0.1:3000',
    TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
    AUTH_THROTTLE_HMAC_KEY: randomBytes(32).toString('base64url'),
  };

  for (const variable of [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_FROM',
    'SMTP_USER',
    'SMTP_PASSWORD',
  ]) {
    delete entorno[variable];
  }

  return entorno;
}

/** Ejecuta el API compilado y reenvía señales de Playwright para liberar Fastify y PostgreSQL. */
async function iniciarApiDePrueba(): Promise<void> {
  const entorno = crearEntornoApiPrueba();
  const ejecutableApi = resolve('apps/api/dist/apps/api/src/main.js');
  const procesoApi = spawn(process.execPath, [ejecutableApi], {
    env: entorno,
    stdio: 'inherit',
  });

  /** Finaliza el hijo de API sin escribir configuración o secretos en la salida. */
  function cerrarApi(senal: NodeJS.Signals): void {
    if (procesoApi.exitCode === null && procesoApi.signalCode === null) {
      procesoApi.kill(senal);
    }
  }

  process.once('SIGINT', () => cerrarApi('SIGINT'));
  process.once('SIGTERM', () => cerrarApi('SIGTERM'));

  await new Promise<void>((resolver, rechazar) => {
    /** Completa el wrapper con el código final del runtime Fastify. */
    function resolverCierre(codigo: number | null, senal: NodeJS.Signals | null): void {
      if (codigo === 0 || (codigo === null && senal !== null)) {
        resolver();
        return;
      }

      process.exitCode = codigo ?? 1;
      resolver();
    }

    procesoApi.once('error', rechazar);
    procesoApi.once('close', resolverCierre);
  });
}

/** Inicia el proceso auxiliar y limita los fallos a un mensaje sin datos de entorno. */
async function main(): Promise<void> {
  await iniciarApiDePrueba();
}

void main().catch(() => {
  process.stderr.write('No fue posible iniciar el API aislado para E2E.\n');
  process.exitCode = 1;
});
