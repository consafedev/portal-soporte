import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { publicErrorResponseSchema } from '../../../../packages/contracts/src/auth.js';
import {
  updateUserPreferencesSchema,
  userPreferencesResponseSchema,
  type RespuestaPreferenciasUsuario,
  type SolicitudActualizarPreferenciasUsuario,
} from '../../../../packages/contracts/src/user-preferences.js';
import type { ServicioPreferenciasUsuario } from '../../../../packages/core/src/preferences/service.js';
import type { ConfiguracionAuth } from '../config.js';
import { requireAuthenticatedSession } from '../auth/authorization.js';
import type { ServicioSesion } from '../auth/session-service.js';

/** Dependencias para exponer el perfil de apariencia a la cuenta autenticada. */
export interface DependenciasRutasPreferenciasUsuario {
  /** Configuración de cookie de sesión para limpiar sesiones inválidas. */
  readonly configuracion: ConfiguracionAuth;
  /** Servicio que vuelve a validar la sesión opaca antes de cada petición. */
  readonly sesiones: ServicioSesion;
  /** Caso de uso que limita lectura y escritura a la cuenta autenticada. */
  readonly preferencias: ServicioPreferenciasUsuario;
}

/**
 * Registra GET y PATCH de preferencias personales protegidos por sesión y CSRF global.
 *
 * @param aplicacion - Instancia Fastify de la API.
 * @param dependencias - Servicios y configuración del núcleo autenticado.
 * @returns Nada; agrega dos rutas limitadas al `AuthContext` de la petición.
 * @effects Las escrituras quedan sujetas al preHandler CSRF común y no son cacheables.
 * @throws Fastify puede rechazar el registro si la ruta ya existe o su esquema es inválido.
 */
export function registrarRutasPreferenciasUsuario(
  aplicacion: FastifyInstance,
  dependencias: DependenciasRutasPreferenciasUsuario,
): void {
  const preHandler = requireAuthenticatedSession(dependencias.sesiones, dependencias.configuracion);

  /**
   * Devuelve la preferencia asociada a la identidad cargada por el guard de sesión.
   *
   * @param solicitud - Petición cuyo guard validó una sesión opaca vigente.
   * @param respuesta - Respuesta Fastify para el estado y encabezados privados.
   * @returns DTO público o respuesta 401 si la cuenta dejó de estar disponible.
   * @throws Propaga fallos del servicio al manejador de errores redactado de Fastify.
   */
  async function obtenerPreferencias(
    solicitud: FastifyRequest,
    respuesta: FastifyReply,
  ): Promise<RespuestaPreferenciasUsuario | void> {
    const idUsuario = solicitud.authContext?.usuario.id;
    const preferencias =
      idUsuario === undefined ? null : await dependencias.preferencias.obtener(idUsuario);
    if (preferencias === null)
      return responderSesionNoDisponible(respuesta, dependencias.configuracion);

    respuesta.header('Cache-Control', 'private, no-store');
    return respuesta.code(200).send(preferencias);
  }

  /**
   * Actualiza únicamente el tema de la cuenta que validó el guard de sesión.
   *
   * @param solicitud - Cuerpo ya validado y sesión cargada en `AuthContext`.
   * @param respuesta - Respuesta Fastify para el DTO o el estado 401 controlado.
   * @returns DTO público o respuesta 401 si la cuenta dejó de estar disponible.
   * @throws Propaga fallos del servicio al manejador de errores redactado de Fastify.
   * @effects Solo cambia la cuenta autenticada; CSRF y schema se aplican en el preHandler.
   */
  async function actualizarPreferencias(
    solicitud: FastifyRequest<{ Body: SolicitudActualizarPreferenciasUsuario }>,
    respuesta: FastifyReply,
  ): Promise<RespuestaPreferenciasUsuario | void> {
    const idUsuario = solicitud.authContext?.usuario.id;
    const preferencias =
      idUsuario === undefined
        ? null
        : await dependencias.preferencias.actualizar(idUsuario, solicitud.body.theme);
    if (preferencias === null)
      return responderSesionNoDisponible(respuesta, dependencias.configuracion);

    respuesta.header('Cache-Control', 'private, no-store');
    return respuesta.code(200).send(preferencias);
  }

  aplicacion.get(
    '/api/v1/me/preferences',
    {
      preHandler,
      schema: {
        response: {
          200: userPreferencesResponseSchema,
          401: publicErrorResponseSchema,
        },
      },
    },
    obtenerPreferencias,
  );

  aplicacion.patch<{ Body: SolicitudActualizarPreferenciasUsuario }>(
    '/api/v1/me/preferences',
    {
      preHandler,
      schema: {
        body: updateUserPreferencesSchema,
        response: {
          200: userPreferencesResponseSchema,
          400: publicErrorResponseSchema,
          401: publicErrorResponseSchema,
          403: publicErrorResponseSchema,
        },
      },
    },
    actualizarPreferencias,
  );
}

/**
 * Limpia la cookie si la cuenta desapareció después de resolver la sesión.
 *
 * @param respuesta - Respuesta Fastify que eliminará la cookie de sesión.
 * @param configuracion - Nombre y atributos seguros de la cookie del entorno.
 * @returns Respuesta 401 uniforme sin revelar si la cuenta fue eliminada o desactivada.
 * @effects Expira la cookie del navegador con los mismos atributos de seguridad.
 */
function responderSesionNoDisponible(
  respuesta: FastifyReply,
  configuracion: ConfiguracionAuth,
): FastifyReply {
  respuesta.clearCookie(configuracion.cookieSesionNombre, {
    httpOnly: true,
    secure: configuracion.cookiesSecure,
    sameSite: 'strict',
    path: '/',
  });

  return respuesta.code(401).send({
    code: 'AUTH_REQUIRED',
    message: 'Se requiere una sesión vigente.',
  });
}
