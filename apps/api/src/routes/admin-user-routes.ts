import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  adminCreateUserSchema,
  adminCreateUserResponseSchema,
  adminEmailChangeRequestSchema,
  adminRevokedSessionsResponseSchema,
  adminUpdateUserSchema,
  adminUserListResponseSchema,
  adminUserResponseSchema,
  publicErrorResponseSchema,
  recoveryAcceptedResponseSchema,
  userIdParamsSchema,
  type RespuestaAltaUsuarioAdmin,
  type SolicitudAltaUsuarioAdmin,
  type SolicitudModificacionUsuarioAdmin,
  type SolicitudCambioCorreoAdmin,
} from '../../../../packages/contracts/src/auth.js';
import type { EscritorAuditoriaAuth, RelojAuth } from '../../../../packages/core/src/auth/ports.js';
import type { ConfiguracionAuth } from '../config.js';
import {
  ErrorUsuarioAdmin,
  ServicioUsuariosAdmin,
  type ActorUsuarioAdmin,
} from '../auth/admin-user-service.js';
import {
  registrarDecoradorContextoAuth,
  requireAuthenticatedSession,
  requireRole,
} from '../auth/authorization.js';
import type { ServicioSesion } from '../auth/session-service.js';
import { ErrorCredencialesAuth, ServicioRecuperacionAuth } from '../auth/recovery-service.js';

/** Dependencias para registrar rutas protegidas de administración de identidades. */
export interface DependenciasRutasUsuariosAdmin {
  /** Configuración de origen y cookie de sesión por entorno. */
  readonly configuracion: ConfiguracionAuth;
  /** Servicio que comprueba cookie, expiración, revocación y cuenta actual. */
  readonly sesiones: ServicioSesion;
  /** Servicio administrativo con persistencia transaccional. */
  readonly usuarios: ServicioUsuariosAdmin;
  /** Auditoría que registra las denegaciones de autorización. */
  readonly auditoria: EscritorAuditoriaAuth;
  /** Reloj UTC usado por los eventos de auditoría. */
  readonly reloj: RelojAuth;
  /** Servicio que emite invitaciones, restablecimientos y cambios de correo verificados. */
  readonly recuperacion: ServicioRecuperacionAuth;
}

/** Registra listar/crear/editar/revocar con autenticación y rol comprobados en backend. */
export async function registrarRutasUsuariosAdmin(
  aplicacion: FastifyInstance,
  dependencias: DependenciasRutasUsuariosAdmin,
): Promise<void> {
  registrarDecoradorContextoAuth(aplicacion);

  await aplicacion.register(async (rutas) => {
    rutas.setErrorHandler(async (error, solicitud, respuesta) => {
      if (
        typeof error === 'object' &&
        error !== null &&
        'validation' in error &&
        error.validation !== undefined
      ) {
        return respuesta.code(400).send({
          code: 'INVALID_REQUEST',
          message: 'La solicitud no tiene un formato válido.',
        });
      }
      if (
        (error instanceof ErrorUsuarioAdmin || error instanceof ErrorCredencialesAuth) &&
        (error.code === 'AUTH_REQUIRED' || error.code === 'FORBIDDEN')
      ) {
        const sesionCaduca = error.code === 'AUTH_REQUIRED';
        if (sesionCaduca) {
          respuesta.clearCookie(dependencias.configuracion.cookieSesionNombre, {
            httpOnly: true,
            path: '/',
            sameSite: 'strict',
            secure: dependencias.configuracion.cookiesSecure,
          });
        }
        await dependencias.auditoria.registrar({
          actorUserId: sesionCaduca ? null : (solicitud.authContext?.usuario.id ?? null),
          action: 'AUTHORIZATION_DENIED',
          targetUserId: null,
          outcome: 'DENIED',
          metadata: { requestId: solicitud.id },
          createdAt: dependencias.reloj.ahora(),
        });
      }
      if (error instanceof ErrorUsuarioAdmin) {
        return respuesta.code(error.statusCode).send({
          code: error.code,
          message: obtenerMensajeErrorAdmin(error.code),
        });
      }
      if (error instanceof ErrorCredencialesAuth) {
        return respuesta.code(error.statusCode).send({
          code: error.code,
          message: 'No fue posible procesar la operación de credenciales.',
        });
      }

      solicitud.log.error(
        { requestId: solicitud.id, code: 'ADMIN_ROUTE_FAILURE' },
        'Fallo controlado de una operación administrativa.',
      );

      return respuesta.code(500).send({
        code: 'INTERNAL_ERROR',
        message: 'No fue posible procesar la solicitud.',
      });
    });

    const preHandler = [
      requireAuthenticatedSession(dependencias.sesiones, dependencias.configuracion),
      requireRole(['ADMIN'], dependencias.auditoria, dependencias.reloj),
    ];

    /** Lista las cuentas con los campos administrativos explícitamente permitidos. */
    async function listarUsuarios(_solicitud: FastifyRequest, respuesta: FastifyReply) {
      return respuesta.code(200).send(await dependencias.usuarios.listar());
    }

    /** Crea una cuenta pendiente y responde sin credenciales ni tokens. */
    async function crearUsuario(
      solicitud: FastifyRequest<{ Body: SolicitudAltaUsuarioAdmin }>,
      respuesta: FastifyReply,
    ) {
      const actor = exigirActorAdmin(solicitud);
      const usuario = await dependencias.usuarios.crear(solicitud.body, actor);
      const resultado = await dependencias.recuperacion.solicitarInvitacion(
        usuario.id,
        actor,
        solicitud.ip,
        solicitud.id,
      );
      const invitationStatus: RespuestaAltaUsuarioAdmin['invitationStatus'] =
        resultado === 'ACEPTADA'
          ? 'ACCEPTED'
          : resultado === 'LIMITADA'
            ? 'RATE_LIMITED'
            : 'DELIVERY_FAILED';
      return respuesta.code(201).send({ user: usuario, invitationStatus });
    }

    /** Actualiza campos permitidos y conserva el correo hasta verificar el cambio. */
    async function actualizarUsuario(
      solicitud: FastifyRequest<{
        Params: { id: string };
        Body: SolicitudModificacionUsuarioAdmin;
      }>,
      respuesta: FastifyReply,
    ) {
      return respuesta
        .code(200)
        .send(
          await dependencias.usuarios.actualizar(
            solicitud.params.id,
            solicitud.body,
            exigirActorAdmin(solicitud),
          ),
        );
    }

    /** Revoca sesiones activas del usuario y devuelve solo el conteo final. */
    async function revocarSesiones(
      solicitud: FastifyRequest<{ Params: { id: string } }>,
      respuesta: FastifyReply,
    ) {
      return respuesta.code(200).send({
        revokedSessions: await dependencias.usuarios.revocarSesiones(
          solicitud.params.id,
          exigirActorAdmin(solicitud),
        ),
      });
    }

    /** Emite un enlace de activación o restablecimiento sin asignar la credencial manualmente. */
    async function restablecerAcceso(
      solicitud: FastifyRequest<{ Params: { id: string } }>,
      respuesta: FastifyReply,
    ) {
      const resultado = await dependencias.recuperacion.solicitarRestablecimientoAdmin(
        solicitud.params.id,
        exigirActorAdmin(solicitud),
        solicitud.ip,
        solicitud.id,
      );
      if (resultado === 'LIMITADA') {
        return respuesta.code(429).send({
          code: 'RATE_LIMITED',
          message: 'Espera antes de volver a solicitar este proceso.',
        });
      }
      if (resultado === 'DELIVERY_FAILED') {
        return respuesta.code(503).send({
          code: 'SMTP_DELIVERY_FAILED',
          message: 'No fue posible entregar el enlace. Vuelve a intentarlo más tarde.',
        });
      }

      return respuesta.code(202).send({ accepted: true });
    }

    /** Envía un enlace al correo nuevo sin sustituirlo hasta verificar el destino. */
    async function cambiarCorreoAdmin(
      solicitud: FastifyRequest<{
        Params: { id: string };
        Body: SolicitudCambioCorreoAdmin;
      }>,
      respuesta: FastifyReply,
    ) {
      const resultado = await dependencias.recuperacion.solicitarCambioCorreoAdmin(
        solicitud.params.id,
        solicitud.body.newEmail,
        exigirActorAdmin(solicitud),
        solicitud.ip,
        solicitud.id,
      );
      if (resultado === 'LIMITADA') {
        return respuesta.code(429).send({
          code: 'RATE_LIMITED',
          message: 'Espera antes de volver a solicitar este proceso.',
        });
      }

      return respuesta.code(202).send({ accepted: true });
    }

    rutas.get(
      '/api/v1/admin/users',
      {
        preHandler,
        schema: {
          response: {
            200: adminUserListResponseSchema,
            401: publicErrorResponseSchema,
            403: publicErrorResponseSchema,
          },
        },
      },
      listarUsuarios,
    );
    rutas.post<{ Body: SolicitudAltaUsuarioAdmin }>(
      '/api/v1/admin/users',
      {
        preHandler,
        schema: {
          body: adminCreateUserSchema,
          response: {
            201: adminCreateUserResponseSchema,
            400: publicErrorResponseSchema,
            401: publicErrorResponseSchema,
            403: publicErrorResponseSchema,
            409: publicErrorResponseSchema,
          },
        },
      },
      crearUsuario,
    );
    rutas.patch<{
      Params: { id: string };
      Body: SolicitudModificacionUsuarioAdmin;
    }>(
      '/api/v1/admin/users/:id',
      {
        preHandler,
        schema: {
          params: userIdParamsSchema,
          body: adminUpdateUserSchema,
          response: {
            200: adminUserResponseSchema,
            400: publicErrorResponseSchema,
            401: publicErrorResponseSchema,
            403: publicErrorResponseSchema,
            404: publicErrorResponseSchema,
            409: publicErrorResponseSchema,
            503: publicErrorResponseSchema,
          },
        },
      },
      actualizarUsuario,
    );
    rutas.post<{ Params: { id: string } }>(
      '/api/v1/admin/users/:id/sessions/revoke',
      {
        preHandler,
        schema: {
          params: userIdParamsSchema,
          response: {
            200: adminRevokedSessionsResponseSchema,
            401: publicErrorResponseSchema,
            403: publicErrorResponseSchema,
            404: publicErrorResponseSchema,
          },
        },
      },
      revocarSesiones,
    );
    rutas.post<{ Params: { id: string } }>(
      '/api/v1/admin/users/:id/reset',
      {
        preHandler,
        schema: {
          params: userIdParamsSchema,
          response: {
            202: recoveryAcceptedResponseSchema,
            401: publicErrorResponseSchema,
            403: publicErrorResponseSchema,
            404: publicErrorResponseSchema,
            429: publicErrorResponseSchema,
            503: publicErrorResponseSchema,
          },
        },
      },
      restablecerAcceso,
    );
    rutas.post<{
      Params: { id: string };
      Body: SolicitudCambioCorreoAdmin;
    }>(
      '/api/v1/admin/users/:id/email-change',
      {
        preHandler,
        schema: {
          params: userIdParamsSchema,
          body: adminEmailChangeRequestSchema,
          response: {
            202: recoveryAcceptedResponseSchema,
            400: publicErrorResponseSchema,
            401: publicErrorResponseSchema,
            403: publicErrorResponseSchema,
            404: publicErrorResponseSchema,
            409: publicErrorResponseSchema,
            429: publicErrorResponseSchema,
          },
        },
      },
      cambiarCorreoAdmin,
    );
  });
}

/** Extrae el actor autenticado y evita continuar si se omitió el prehandler de rol. */
function exigirActorAdmin(solicitud: FastifyRequest): ActorUsuarioAdmin {
  const contexto = solicitud.authContext;
  if (contexto === null || contexto.usuario.role !== 'ADMIN') {
    throw new ErrorUsuarioAdmin('FORBIDDEN', 403);
  }

  return {
    userId: contexto.usuario.id,
    sessionId: contexto.sessionId,
    role: contexto.usuario.role,
    requestId: solicitud.id,
  };
}

/** Mapea códigos administrativos a mensajes fijos que no incluyen valores suministrados. */
function obtenerMensajeErrorAdmin(codigo: string): string {
  const mensajes: Record<string, string> = {
    AUTH_REQUIRED: 'Se requiere una sesión vigente.',
    ACTIVATION_REQUIRED: 'La cuenta debe completar su activación antes de cambiar su estado.',
    ADMIN_ALREADY_EXISTS: 'Ya existe un administrador inicial activo.',
    AUTH_INVARIANT_UNAVAILABLE: 'La operación administrativa no está disponible.',
    BOOTSTRAP_CANCELLED: 'La operación de configuración inicial fue cancelada.',
    BOOTSTRAP_PASSWORD_MISMATCH: 'Las contraseñas ingresadas no coinciden.',
    BOOTSTRAP_REQUIRES_TTY: 'La configuración inicial requiere un terminal interactivo seguro.',
    EMAIL_TAKEN: 'El correo ya está asociado con otra cuenta.',
    EMAIL_VERIFICATION_REQUIRED: 'El nuevo correo requiere el flujo de verificación.',
    FORBIDDEN: 'No tienes permisos para esta operación.',
    INVALID_DISPLAY_NAME: 'El nombre visible no tiene un formato válido.',
    INVALID_EMAIL: 'El correo no tiene un formato válido.',
    INVALID_USERNAME: 'El nombre de usuario no tiene un formato válido.',
    LAST_ADMIN_REQUIRED: 'Debe permanecer al menos un administrador activo.',
    USERNAME_TAKEN: 'El nombre de usuario ya está asociado con otra cuenta.',
    USER_NOT_FOUND: 'No se encontró la cuenta solicitada.',
  };

  return mensajes[codigo] ?? 'No fue posible procesar la solicitud.';
}
