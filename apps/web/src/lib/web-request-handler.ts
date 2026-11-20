import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { sanearCabecerasProxyBorde } from './proxy-address.ts';

/**
 * Sanea cabeceras del borde y valida el Host antes de pasar la petición al renderizador.
 * @param manejarSiguiente - Handler HTTP interno de Next.js.
 * @param proxiesBorde - Peers explícitos autorizados a aportar X-Forwarded-For.
 * @param origenPublico - Origen canónico que define la única autoridad web admitida.
 * @returns Listener HTTP que rechaza Hosts falsificados antes de ejecutar Next.js.
 * @effects Reemplaza o elimina cabeceras reenviadas según el peer del socket.
 */
export function crearManejadorSolicitudWeb(
  manejarSiguiente: (solicitud: IncomingMessage, respuesta: ServerResponse) => Promise<void>,
  proxiesBorde: readonly string[],
  origenPublico: string | undefined,
): RequestListener {
  return (solicitud, respuesta) => {
    if (!coincideHostConOrigenCanonico(solicitud.headers['host'], origenPublico)) {
      respuesta.writeHead(400, { 'Cache-Control': 'no-store' }).end();
      return;
    }

    const peerRemoto = solicitud.socket.remoteAddress;
    if (peerRemoto === undefined) {
      respuesta.writeHead(400, { 'Cache-Control': 'no-store' }).end();
      return;
    }

    solicitud.headers = sanearCabecerasProxyBorde(solicitud.headers, peerRemoto, proxiesBorde);
    void manejarSiguiente(solicitud, respuesta).catch(() => responderFalloSolicitudWeb(respuesta));
  };
}

/** Comprueba que la autoridad HTTP corresponda al origen público configurado. */
export function coincideHostConOrigenCanonico(
  hostSolicitado: string | undefined,
  origenPublico: string | undefined,
): boolean {
  if (
    hostSolicitado === undefined ||
    origenPublico === undefined ||
    hostSolicitado.length === 0 ||
    hostSolicitado.trim() !== hostSolicitado ||
    /[\s/@\\?#]/u.test(hostSolicitado)
  ) {
    return false;
  }

  try {
    const origen = new URL(origenPublico);
    if (
      !['http:', 'https:'].includes(origen.protocol) ||
      origen.username.length > 0 ||
      origen.password.length > 0 ||
      origen.pathname !== '/' ||
      origen.search.length > 0 ||
      origen.hash.length > 0
    ) {
      return false;
    }

    const autoridad = new URL(`${origen.protocol}//${hostSolicitado}/`);
    return (
      autoridad.username.length === 0 &&
      autoridad.password.length === 0 &&
      autoridad.pathname === '/' &&
      autoridad.search.length === 0 &&
      autoridad.hash.length === 0 &&
      autoridad.host.toLowerCase() === origen.host.toLowerCase()
    );
  } catch {
    return false;
  }
}

/** Responde con un fallo genérico sin sustituir una respuesta HTTP ya iniciada. */
function responderFalloSolicitudWeb(respuesta: ServerResponse): void {
  if (respuesta.writableEnded) return;
  if (!respuesta.headersSent) respuesta.writeHead(500, { 'Cache-Control': 'no-store' });
  respuesta.end('No fue posible procesar la solicitud.');
}
