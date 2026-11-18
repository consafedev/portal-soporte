import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarConfiguracionEscuchaApi } from './runtime-config.js';
import { crearRuntimeAuth, type RuntimeAuth } from './runtime.js';

/**
 * Inicia el listener privado del API y cierra recursos ante señales del sistema.
 *
 * @returns Promesa que se resuelve cuando Fastify comienza a escuchar.
 * @throws Error si falla la configuración, la composición del runtime o el socket.
 */
export async function iniciarServidorAuth(): Promise<void> {
  const escucha = cargarConfiguracionEscuchaApi();
  const runtime = await crearRuntimeAuth();

  try {
    await runtime.servidor.listen({ host: escucha.host, port: escucha.port });
  } catch {
    await runtime.cerrar().catch(() => undefined);
    throw new Error('API_LISTEN_FAILED');
  }

  runtime.servidor.log.info(
    { host: escucha.host, port: escucha.port },
    'API de autenticación escuchando en una interfaz privada.',
  );
  registrarCierrePorSenal(runtime);
}

/**
 * Evita sockets o conexiones durante imports de pruebas y arranca solo desde CLI.
 *
 * @returns `true` cuando Node ejecuta este archivo como punto de entrada.
 */
function esEjecucionDirecta(): boolean {
  const archivoEntrada = process.argv[1];
  return (
    archivoEntrada !== undefined && import.meta.url === pathToFileURL(resolve(archivoEntrada)).href
  );
}

/**
 * Registra un cierre único del servidor/pool y no propaga errores de shutdown.
 *
 * @param runtime - Recursos que el proceso debe cerrar tras SIGINT o SIGTERM.
 * @returns Nada; los listeners quedan instalados en el proceso actual.
 */
function registrarCierrePorSenal(runtime: RuntimeAuth): void {
  let cierre: Promise<void> | null = null;

  /**
   * Programa una sola finalización y reporta únicamente un código estable.
   *
   * @param senal - Señal de cierre recibida por el proceso.
   * @returns Nada; inicia el cierre asíncrono una vez.
   */
  function manejarSenal(senal: NodeJS.Signals): void {
    cierre ??= runtime.cerrar().catch(() => {
      process.stderr.write(`API_SHUTDOWN_FAILED (${senal})\n`);
      process.exitCode = 1;
    });
  }

  process.once('SIGINT', () => manejarSenal('SIGINT'));
  process.once('SIGTERM', () => manejarSenal('SIGTERM'));
}

if (esEjecucionDirecta()) {
  void iniciarServidorAuth().catch(() => {
    process.stderr.write('No fue posible iniciar el API de autenticación.\n');
    process.exitCode = 1;
  });
}
