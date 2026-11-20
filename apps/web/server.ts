import { once } from 'node:events';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import next from 'next';
import { cargarProxiesBordeConfiables } from './src/lib/proxy-address.ts';
import { crearManejadorSolicitudWeb } from './src/lib/web-request-handler.ts';

const modoDesarrollo = process.argv.includes('--dev');
if (process.env['NODE_ENV'] === undefined) {
  Object.assign(process.env, { NODE_ENV: modoDesarrollo ? 'development' : 'production' });
}
const host = process.env['WEB_LISTEN_HOST'] ?? '127.0.0.1';
const port = resolverPuerto(process.env['PORT']);
const proxiesBorde = cargarProxiesBordeConfiables(process.env);
validarHostPrivado(host);

const aplicacion = next({ dev: modoDesarrollo, hostname: host, port });
/** Handler de Next.js que conserva las rutas same-origin y sus respuestas HTTP. */
const manejarSolicitudNext = aplicacion.getRequestHandler();
/** Servidor que valida el peer TCP antes de entregar cabeceras reenviadas a Next.js. */
const servidor = createServer(
  crearManejadorSolicitudWeb(manejarSolicitudNext, proxiesBorde, process.env['PUBLIC_APP_ORIGIN']),
);

/**
 * Prepara Next.js y espera el evento de escucha del host privado validado.
 * @returns Promesa que termina después de enlazar el puerto configurado.
 * @throws Error si Next.js no prepara o el socket no puede abrirse.
 */
async function iniciarServidorWeb(): Promise<void> {
  await aplicacion.prepare();
  const escucha = once(servidor, 'listening');
  servidor.listen(port, host);
  await escucha;
}

/** Registra el cierre idempotente de Next.js y el listener ante señales del sistema. */
function registrarCierre(): void {
  let cierre: Promise<void> | null = null;

  /** Detiene primero el listener y después libera el runtime de Next.js. */
  async function cerrarAplicacionWeb(): Promise<void> {
    const eventoCierre = once(servidor, 'close');
    servidor.close();
    await eventoCierre;
    await aplicacion.close();
  }

  /** Programa una sola rutina de apagado y comunica fallo mediante el código de salida. */
  function manejarSenal(): void {
    cierre ??= cerrarAplicacionWeb();
    void cierre.catch(() => {
      process.exitCode = 1;
    });
  }

  process.once('SIGINT', manejarSenal);
  process.once('SIGTERM', manejarSenal);
}

/**
 * Lee un puerto TCP de aplicación sin aceptar valores fuera del rango válido.
 * @param valor - Valor `PORT` opcional del proceso.
 * @returns Puerto TCP validado o 3000 para el desarrollo local.
 * @throws Error si el valor no es decimal o excede el rango TCP.
 */
function resolverPuerto(valor: string | undefined): number {
  if (valor === undefined) {
    return 3000;
  }
  if (!/^[1-9]\d{0,4}$/u.test(valor)) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }

  const port = Number(valor);
  if (port > 65_535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }

  return port;
}

/**
 * Rechaza listeners web públicos o comodín para que solo el proxy de borde sea público.
 * @param valor - IP literal que recibirá conexiones internas del proxy de borde.
 * @throws Error si la dirección no es loopback o privada.
 */
function validarHostPrivado(valor: string): void {
  if (valor === 'localhost') {
    if (process.env['NODE_ENV'] !== 'production') {
      return;
    }
    throw new Error('WEB_LISTEN_HOST debe ser una IP loopback o privada en producción.');
  }

  const versionIp = isIP(valor);
  if (versionIp === 4) {
    const [primero, segundo] = valor.split('.').map(Number);
    const privado =
      primero === 127 ||
      primero === 10 ||
      (primero === 172 && segundo !== undefined && segundo >= 16 && segundo <= 31) ||
      (primero === 192 && segundo === 168);
    if (privado) {
      return;
    }
  } else if (versionIp === 6 && /^(?:::1|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/iu.test(valor)) {
    return;
  }

  throw new Error('WEB_LISTEN_HOST debe ser una IP loopback o privada explícita.');
}

/** Informa el fallo de inicio sin imprimir configuración, origen o credenciales. */
function manejarFalloInicio(): void {
  process.stderr.write('No fue posible iniciar el proxy web privado.\n');
  process.exitCode = 1;
}

if (esModuloEjecutadoDirectamente()) {
  void iniciarServidorWeb().then(registrarCierre, manejarFalloInicio);
}

/**
 * Determina si Node ejecuta este archivo como entrada, en vez de importarlo en pruebas.
 * @returns `true` cuando la ruta de entrada de Node coincide con este módulo.
 */
function esModuloEjecutadoDirectamente(): boolean {
  const rutaEntrada = process.argv[1];
  return rutaEntrada !== undefined && fileURLToPath(import.meta.url) === resolve(rutaEntrada);
}
