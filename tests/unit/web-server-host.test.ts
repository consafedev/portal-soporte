import {
  createServer,
  request as solicitarHttp,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  coincideHostConOrigenCanonico,
  crearManejadorSolicitudWeb,
} from '../../apps/web/src/lib/web-request-handler.js';

/**
 * Define regresiones para el control de autoridad del servidor web privado.
 * @returns Nada; registra las comprobaciones unitarias y HTTP del handler.
 */
function definirPruebasDeHostCanonico(): void {
  it('acepta el host configurado sin distinguir mayúsculas DNS', pruebaAceptaHostCanonico);
  it('carga el handler con el runtime Node usado por el servidor', pruebaCargaHandlerConNode);
  it(
    'rechaza un host falsificado aunque X-Forwarded-Host anuncie el esperado',
    pruebaRechazaHostFalsificado,
  );
  it('acepta el puerto HTTPS predeterminado y rechaza otro puerto', pruebaValidaPuertoCanonico);
  it('rechaza autoridad ausente o malformada', pruebaRechazaAutoridadInvalida);
  it(
    'detiene Host falsificado antes de llamar a Next.js',
    pruebaRechazaSolicitudHttpHostFalsificado,
  );
  it('conserva el forwarding saneado para el Host canónico', pruebaConservaSolicitudHttpCanonica);
}

/**
 * Acepta el nombre DNS del origen público con comparación no sensible a mayúsculas.
 * @returns Nada; falla la prueba si el host canónico no se acepta.
 */
function pruebaAceptaHostCanonico(): void {
  expect(
    coincideHostConOrigenCanonico('Soporte.ConsafeDev.Qzz.io', 'https://soporte.consafedev.qzz.io'),
  ).toBe(true);
}

/**
 * Importa el handler con Node 24 sin el resolver de Vitest para reproducir el runtime del servidor.
 * @returns Nada; falla si alguna dependencia local conserva una extensión no ejecutable por Node.
 */
function pruebaCargaHandlerConNode(): void {
  const modulo = new URL('../../apps/web/src/lib/web-request-handler.ts', import.meta.url).href;
  const resultado = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(modulo)})`],
    { encoding: 'utf8' },
  );

  expect(resultado.status, resultado.stderr).toBe(0);
}

/**
 * Ignora una cabecera reenviada falsificada y solo evalúa el Host recibido por el socket.
 * @returns Nada; falla la prueba si X-Forwarded-Host altera la decisión.
 */
function pruebaRechazaHostFalsificado(): void {
  const cabeceras = {
    host: 'attacker.example.test',
    'x-forwarded-host': 'soporte.consafedev.qzz.io',
  };

  expect(coincideHostConOrigenCanonico(cabeceras.host, 'https://soporte.consafedev.qzz.io')).toBe(
    false,
  );
}

/**
 * Normaliza el puerto predeterminado del esquema y rechaza autoridades con puertos ajenos.
 * @returns Nada; falla la prueba si un puerto distinto se acepta.
 */
function pruebaValidaPuertoCanonico(): void {
  expect(
    coincideHostConOrigenCanonico('portal.example.test:443', 'https://portal.example.test'),
  ).toBe(true);
  expect(
    coincideHostConOrigenCanonico('portal.example.test:8443', 'https://portal.example.test'),
  ).toBe(false);
}

/**
 * Rechaza Host ausente, con credenciales, ruta o sintaxis inválida.
 * @returns Nada; falla la prueba ante cualquier autoridad incompleta o malformada aceptada.
 */
function pruebaRechazaAutoridadInvalida(): void {
  for (const host of [
    undefined,
    '',
    ' portal.example.test',
    'user@portal.example.test',
    'portal.example.test/path',
  ]) {
    expect(coincideHostConOrigenCanonico(host, 'https://portal.example.test')).toBe(false);
  }
}

/**
 * Verifica por HTTP que un Host ajeno no llegue al handler interno de Next.js.
 * @returns Promesa que termina después de cerrar el servidor de prueba efímero.
 */
async function pruebaRechazaSolicitudHttpHostFalsificado(): Promise<void> {
  let invocacionesNext = 0;
  const servidor = crearServidorPrueba(async (_solicitud, respuesta) => {
    invocacionesNext += 1;
    respuesta.writeHead(204).end();
  });

  try {
    const respuesta = await enviarSolicitud(servidor, {
      host: 'attacker.example.test',
      'x-forwarded-host': 'portal.example.test',
    });

    expect(respuesta.status).toBe(400);
    expect(respuesta.headers.get('cache-control')).toBe('no-store');
    expect(invocacionesNext).toBe(0);
  } finally {
    await cerrarServidor(servidor);
  }
}

/**
 * Comprueba que solo el Host validado alcanza Next.js y las cabeceras proxy siguen saneadas.
 * @returns Promesa que termina después de cerrar el servidor de prueba efímero.
 */
async function pruebaConservaSolicitudHttpCanonica(): Promise<void> {
  let cabecerasRecibidas: IncomingMessage['headers'] | undefined;
  const servidor = crearServidorPrueba(async (solicitud, respuesta) => {
    cabecerasRecibidas = solicitud.headers;
    respuesta.writeHead(204).end();
  });

  try {
    const respuesta = await enviarSolicitud(servidor, {
      host: 'portal.example.test',
      'x-forwarded-host': 'attacker.example.test',
      'x-forwarded-proto': 'http',
      'x-forwarded-for': '198.51.100.20',
    });

    expect(respuesta.status).toBe(204);
    expect(cabecerasRecibidas).toMatchObject({
      host: 'portal.example.test',
      'x-forwarded-for': '127.0.0.1',
    });
    expect(cabecerasRecibidas?.['x-forwarded-host']).toBeUndefined();
    expect(cabecerasRecibidas?.['x-forwarded-proto']).toBeUndefined();
  } finally {
    await cerrarServidor(servidor);
  }
}

/**
 * Inicia un servidor HTTP efímero usando el mismo handler que envuelve Next.js.
 * @param manejarNext - Sustituto de Next.js que registra la petición para las aserciones.
 * @returns Servidor escuchando en loopback y en un puerto asignado por el sistema.
 * @effects Abre un listener solo en `127.0.0.1` durante la prueba.
 */
function crearServidorPrueba(
  manejarNext: (solicitud: IncomingMessage, respuesta: ServerResponse) => Promise<void>,
) {
  const servidor = createServer(
    crearManejadorSolicitudWeb(manejarNext, [], 'https://portal.example.test'),
  );

  servidor.listen(0, '127.0.0.1');
  return servidor;
}

/**
 * Envía una petición local con el encabezado Host explícito al servidor efímero.
 * @param servidor - Listener HTTP local usado en esta prueba.
 * @param headers - Cabeceras sintéticas que recibirá el handler personalizado.
 * @returns Estado y cabeceras de respuesta sin conservar contenido de solicitudes.
 * @throws Error si el listener no tiene una dirección local válida o la solicitud falla.
 */
async function enviarSolicitud(
  servidor: ReturnType<typeof crearServidorPrueba>,
  headers: Record<string, string>,
): Promise<{ status: number; headers: Headers }> {
  await new Promise<void>((resolver, rechazar) => {
    if (servidor.listening) {
      resolver();
      return;
    }
    servidor.once('listening', resolver);
    servidor.once('error', rechazar);
  });

  const direccion = servidor.address();
  if (direccion === null || typeof direccion === 'string') {
    throw new Error('La prueba no obtuvo el puerto del servidor HTTP efímero.');
  }

  return new Promise((resolver, rechazar) => {
    const solicitud = solicitarHttp(
      {
        hostname: '127.0.0.1',
        port: direccion.port,
        path: '/login',
        method: 'GET',
        headers,
      },
      (respuesta) => {
        const encabezados = new Headers();
        for (const [nombre, valor] of Object.entries(respuesta.headers)) {
          if (valor === undefined) {
            continue;
          }
          for (const valorIndividual of Array.isArray(valor) ? valor : [valor]) {
            encabezados.append(nombre, valorIndividual);
          }
        }
        respuesta.resume();
        respuesta.once('end', () =>
          resolver({ status: respuesta.statusCode ?? 0, headers: encabezados }),
        );
      },
    );
    solicitud.once('error', rechazar);
    solicitud.end();
  });
}

/**
 * Cierra el listener efímero antes de terminar una prueba para no dejar sockets abiertos.
 * @param servidor - Listener local creado exclusivamente por la prueba.
 * @returns Promesa que termina al cerrar el puerto.
 * @throws Error si Node no puede cerrar el listener.
 */
async function cerrarServidor(servidor: ReturnType<typeof crearServidorPrueba>): Promise<void> {
  if (!servidor.listening) {
    return;
  }

  await new Promise<void>((resolver, rechazar) => {
    servidor.close((error) => (error === undefined ? resolver() : rechazar(error)));
  });
}

describe('host canónico en el servidor web', definirPruebasDeHostCanonico);
