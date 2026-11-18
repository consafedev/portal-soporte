import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ConfiguracionAuth } from '../config.js';
import { esTokenOpacoValido } from '../auth/token-service.js';

const METODOS_ESCRITURA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Registra controles globales de origen y CSRF antes de ejecutar cualquier write.
 *
 * @param aplicacion - Instancia Fastify que ya registró el parser de cookies.
 * @param configuracion - Origen canónico y nombre de cookie CSRF aprobados.
 * @returns No devuelve valor; añade un hook `onRequest` global.
 */
export function registrarProteccionCsrf(
  aplicacion: FastifyInstance,
  configuracion: ConfiguracionAuth,
): void {
  aplicacion.addHook('onRequest', async (solicitud, respuesta) => {
    if (solicitud.url.startsWith('/api/v1/auth/')) {
      respuesta.header('Cache-Control', 'no-store, max-age=0');
      respuesta.header('Pragma', 'no-cache');
      respuesta.header('Referrer-Policy', 'no-referrer');
      respuesta.header('X-Content-Type-Options', 'nosniff');
    }

    if (!METODOS_ESCRITURA.has(solicitud.method)) {
      return;
    }

    if (!validarSolicitudEscritura(solicitud, configuracion)) {
      return respuesta.code(403).send({
        code: 'CSRF_REJECTED',
        message: 'La solicitud de escritura no superó la validación de origen.',
      });
    }
  });
}

/**
 * Valida Origin exacto, Fetch Metadata y el par CSRF sin usar headers forwarded.
 *
 * @param solicitud - Petición Fastify con cookies ya analizadas.
 * @param configuracion - Origen público canónico y nombre de cookie por ambiente.
 * @returns `true` si la solicitud supera las tres comprobaciones; `false` en otro caso.
 */
export function validarSolicitudEscritura(
  solicitud: FastifyRequest,
  configuracion: ConfiguracionAuth,
): boolean {
  const origen = solicitud.headers['origin'];
  if (typeof origen !== 'string' || origen !== configuracion.publicAppOrigin) {
    return false;
  }

  const sitioFetch = solicitud.headers['sec-fetch-site'];
  if (sitioFetch !== undefined && sitioFetch !== 'same-origin') {
    return false;
  }

  const cookie = solicitud.cookies[configuracion.cookieCsrfNombre];
  const encabezado = solicitud.headers['x-csrf-token'];
  if (
    typeof cookie !== 'string' ||
    typeof encabezado !== 'string' ||
    !esTokenOpacoValido(cookie) ||
    !esTokenOpacoValido(encabezado)
  ) {
    return false;
  }

  const bytesCookie = Buffer.from(cookie, 'base64url');
  const bytesEncabezado = Buffer.from(encabezado, 'base64url');

  return (
    bytesCookie.length === bytesEncabezado.length && timingSafeEqual(bytesCookie, bytesEncabezado)
  );
}
