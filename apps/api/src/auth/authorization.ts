import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type {
  CuentaSesion,
  EscritorAuditoriaAuth,
  RelojAuth,
} from '../../../../packages/core/src/auth/ports.js';
import type { RolUsuario } from '../../../../packages/core/src/auth/models.js';
import type { ConfiguracionAuth } from '../config.js';
import type { ServicioSesion } from './session-service.js';

/** Contexto de cuenta y sesión vigente resuelto solo por el servidor. */
export interface ContextoAuthSolicitud {
  /** UUID de la sesión opaca vigente que autorizó la petición. */
  readonly sessionId: string;
  /** Datos actuales de la cuenta leídos desde PostgreSQL. */
  readonly usuario: CuentaSesion;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Identidad asignada por el prehandler de sesión; null antes de autenticar. */
    authContext: ContextoAuthSolicitud | null;
  }
}

/** Instala el campo de contexto en solicitudes Fastify antes de registrar rutas. */
export function registrarDecoradorContextoAuth(aplicacion: FastifyInstance): void {
  if (!aplicacion.hasRequestDecorator('authContext')) {
    aplicacion.decorateRequest('authContext', null);
  }
}

/**
 * Resuelve la cookie opaca, renueva su vencimiento inactivo y carga el rol actual.
 * @param sesiones Servicio PostgreSQL que valida y renueva el límite de inactividad.
 * @param configuracion Nombres de cookies y política `Secure` del entorno activo.
 * @returns Prehandler que asigna identidad vigente o responde `401` y limpia credenciales inválidas.
 */
export function requireAuthenticatedSession(
  sesiones: ServicioSesion,
  configuracion: ConfiguracionAuth,
): preHandlerAsyncHookHandler {
  return async (solicitud, respuesta) => {
    const token = solicitud.cookies[configuracion.cookieSesionNombre];
    if (token === undefined) {
      return respuesta.code(401).send({
        code: 'AUTH_REQUIRED',
        message: 'Se requiere una sesión vigente.',
      });
    }

    const sesion = await sesiones.resolverVigente(token);

    if (sesion === null) {
      respuesta.clearCookie(configuracion.cookieSesionNombre, {
        path: '/',
        sameSite: 'strict',
        secure: configuracion.cookiesSecure,
        httpOnly: true,
      });

      return respuesta.code(401).send({
        code: 'AUTH_REQUIRED',
        message: 'Se requiere una sesión vigente.',
      });
    }

    solicitud.authContext = { sessionId: sesion.sessionId, usuario: sesion.usuario };
    respuesta.setCookie(configuracion.cookieSesionNombre, token, {
      httpOnly: true,
      secure: configuracion.cookiesSecure,
      sameSite: 'strict',
      path: '/',
      expires: sesion.idleExpiresAt,
    });
  };
}

/** Construye un prehandler que permite únicamente los roles indicados y deniega por defecto. */
export function requireRole(
  roles: readonly RolUsuario[],
  auditoria: EscritorAuditoriaAuth,
  reloj: RelojAuth,
): preHandlerAsyncHookHandler {
  return async (solicitud, respuesta) => {
    const contexto = solicitud.authContext;
    if (contexto === null) {
      return respuesta.code(401).send({
        code: 'AUTH_REQUIRED',
        message: 'Se requiere una sesión vigente.',
      });
    }

    if (roles.includes(contexto.usuario.role)) {
      return;
    }

    await auditoria.registrar({
      actorUserId: contexto.usuario.id,
      action: 'AUTHORIZATION_DENIED',
      targetUserId: null,
      outcome: 'DENIED',
      metadata: {
        actorRole: contexto.usuario.role,
        requestId: solicitud.id,
      },
      createdAt: reloj.ahora(),
    });

    return respuesta.code(403).send({
      code: 'FORBIDDEN',
      message: 'No tienes permisos para esta operación.',
    });
  };
}
