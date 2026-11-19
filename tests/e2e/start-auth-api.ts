import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { crearEntornoApiPrueba } from './auth-api-test-environment.ts';

/** Ejecuta el API compilado y reenvía señales de Playwright para liberar Fastify y PostgreSQL. */
async function iniciarApiDePrueba(): Promise<void> {
  const entorno = crearEntornoApiPrueba(process.env);
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
