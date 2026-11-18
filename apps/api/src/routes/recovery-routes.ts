import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  changePasswordRequestSchema,
  completeTokenRequestSchema,
  emailChangeRequestSchema,
  emailTokenRequestSchema,
  publicErrorResponseSchema,
  recoveryAcceptedResponseSchema,
  recoveryRequestSchema,
  type SolicitudCambioContrasena,
  type SolicitudCambioCorreo,
  type SolicitudRecuperacion,
  type SolicitudFinalizacionToken,
  type SolicitudTokenCorreo,
} from '../../../../packages/contracts/src/auth.js';
import type { ConfiguracionAuth } from '../config.js';
import {
  requireAuthenticatedSession,
  registrarDecoradorContextoAuth,
} from '../auth/authorization.js';
import { ErrorCredencialesAuth, ServicioRecuperacionAuth } from '../auth/recovery-service.js';
import type { ServicioSesion } from '../auth/session-service.js';

const respuestaSinContenido = Type.Null();

/** Dependencias para exponer los flujos HTTP sin confiar en datos del navegador. */
export interface DependenciasRutasRecuperacion {
  /** Configuración canónica de origen y cookie segura. */
  readonly configuracion: ConfiguracionAuth;
  /** Servicio que valida sesiones opacas y la cuenta vigente. */
  readonly sesiones: ServicioSesion;
  /** Casos de uso transaccionales de contraseña, correo y tokens. */
  readonly recuperacion: ServicioRecuperacionAuth;
}

/** Registra recuperación, activación y cambios propios con CSRF global y límites de abuso. */
export async function registrarRutasRecuperacion(
  aplicacion: FastifyInstance,
  dependencias: DependenciasRutasRecuperacion,
): Promise<void> {
  registrarDecoradorContextoAuth(aplicacion);
  await aplicacion.register(async (rutas) => {
    rutas.setErrorHandler((error, solicitud, respuesta) =>
      manejarErrorAuth(error, solicitud, respuesta),
    );
    const preHandler = requireAuthenticatedSession(
      dependencias.sesiones,
      dependencias.configuracion,
    );

    /** Atiende recovery sin filtrar si el email pertenece a una cuenta verificable. */
    async function solicitarRecuperacion(
      solicitud: FastifyRequest<{ Body: SolicitudRecuperacion }>,
      respuesta: FastifyReply,
    ) {
      respuesta.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      const resultado = await dependencias.recuperacion.solicitarRecuperacion(
        solicitud.body.email,
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

    /** Consume recuperación y elimina del resultado toda referencia al token. */
    async function completarRecuperacion(
      solicitud: FastifyRequest<{ Body: SolicitudFinalizacionToken }>,
      respuesta: FastifyReply,
    ) {
      respuesta.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      await dependencias.recuperacion.completarRecuperacion(
        solicitud.body.token,
        solicitud.body.newPassword,
        solicitud.ip,
        solicitud.id,
      );

      return respuesta.code(204).send();
    }

    /** Activa una invitación fijando la primera contraseña sin abrir registro público. */
    async function completarActivacion(
      solicitud: FastifyRequest<{ Body: SolicitudFinalizacionToken }>,
      respuesta: FastifyReply,
    ) {
      respuesta.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      await dependencias.recuperacion.completarActivacion(
        solicitud.body.token,
        solicitud.body.newPassword,
        solicitud.ip,
        solicitud.id,
      );

      return respuesta.code(204).send();
    }

    /** Verifica la contraseña actual, revoca sesiones y coloca una nueva cookie opaca. */
    async function cambiarContrasena(
      solicitud: FastifyRequest<{ Body: SolicitudCambioContrasena }>,
      respuesta: FastifyReply,
    ) {
      const contexto = solicitud.authContext;
      if (contexto === null) {
        throw new ErrorCredencialesAuth('AUTH_REQUIRED', 401);
      }
      const sesion = await dependencias.recuperacion.cambiarContrasena(
        contexto.usuario.id,
        solicitud.body.currentPassword,
        solicitud.body.newPassword,
        solicitud.ip,
        solicitud.id,
      );
      respuesta
        .header('Cache-Control', 'no-store')
        .setCookie(dependencias.configuracion.cookieSesionNombre, sesion.token, {
          httpOnly: true,
          secure: dependencias.configuracion.cookiesSecure,
          sameSite: 'strict',
          path: '/',
          expires: sesion.idleExpiresAt,
        });

      return respuesta.code(204).send();
    }

    /** Solicita cambio de correo autenticado y no sustituye el correo vigente. */
    async function solicitarCambioCorreo(
      solicitud: FastifyRequest<{ Body: SolicitudCambioCorreo }>,
      respuesta: FastifyReply,
    ) {
      const contexto = solicitud.authContext;
      if (contexto === null) {
        throw new ErrorCredencialesAuth('AUTH_REQUIRED', 401);
      }
      respuesta.header('Cache-Control', 'no-store');
      const resultado = await dependencias.recuperacion.solicitarCambioCorreo(
        contexto.usuario.id,
        solicitud.body.currentPassword,
        solicitud.body.newEmail,
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

    /** Consume verificación o cambio de correo de un propósito admitido. */
    async function completarCambioCorreo(
      solicitud: FastifyRequest<{ Body: SolicitudTokenCorreo }>,
      respuesta: FastifyReply,
    ) {
      respuesta.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      await dependencias.recuperacion.completarCambioCorreo(
        solicitud.body.token,
        solicitud.ip,
        solicitud.id,
      );

      return respuesta.code(204).send();
    }

    rutas.post<{ Body: SolicitudRecuperacion }>(
      '/api/v1/auth/recovery/request',
      {
        schema: {
          body: recoveryRequestSchema,
          response: {
            202: recoveryAcceptedResponseSchema,
            400: publicErrorResponseSchema,
            429: publicErrorResponseSchema,
          },
        },
      },
      solicitarRecuperacion,
    );
    rutas.post<{ Body: SolicitudFinalizacionToken }>(
      '/api/v1/auth/recovery/complete',
      {
        schema: {
          body: completeTokenRequestSchema,
          response: {
            204: respuestaSinContenido,
            400: publicErrorResponseSchema,
            429: publicErrorResponseSchema,
          },
        },
      },
      completarRecuperacion,
    );
    rutas.post<{ Body: SolicitudFinalizacionToken }>(
      '/api/v1/auth/activation/complete',
      {
        schema: {
          body: completeTokenRequestSchema,
          response: {
            204: respuestaSinContenido,
            400: publicErrorResponseSchema,
            429: publicErrorResponseSchema,
          },
        },
      },
      completarActivacion,
    );
    rutas.post<{ Body: SolicitudCambioContrasena }>(
      '/api/v1/auth/password',
      {
        preHandler,
        schema: {
          body: changePasswordRequestSchema,
          response: {
            204: respuestaSinContenido,
            400: publicErrorResponseSchema,
            401: publicErrorResponseSchema,
            429: publicErrorResponseSchema,
          },
        },
      },
      cambiarContrasena,
    );
    rutas.post<{ Body: SolicitudCambioCorreo }>(
      '/api/v1/auth/email-change/request',
      {
        preHandler,
        schema: {
          body: emailChangeRequestSchema,
          response: {
            202: recoveryAcceptedResponseSchema,
            400: publicErrorResponseSchema,
            401: publicErrorResponseSchema,
            409: publicErrorResponseSchema,
            429: publicErrorResponseSchema,
          },
        },
      },
      solicitarCambioCorreo,
    );
    rutas.post<{ Body: SolicitudTokenCorreo }>(
      '/api/v1/auth/email-change/complete',
      {
        schema: {
          body: emailTokenRequestSchema,
          response: {
            204: respuestaSinContenido,
            400: publicErrorResponseSchema,
            409: publicErrorResponseSchema,
            429: publicErrorResponseSchema,
          },
        },
      },
      completarCambioCorreo,
    );
  });
}

/** Convierte errores de validación/caso de uso a respuestas fijas y no sensibles. */
function manejarErrorAuth(error: unknown, solicitud: FastifyRequest, respuesta: FastifyReply) {
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
  if (error instanceof ErrorCredencialesAuth) {
    return respuesta.code(error.statusCode).send({
      code: error.code,
      message: mensajePublicoAuth(error.code),
    });
  }

  solicitud.log.error(
    { requestId: solicitud.id, code: 'AUTH_CREDENTIAL_OPERATION_FAILED' },
    'Fallo controlado de una operación de credenciales.',
  );

  return respuesta.code(500).send({
    code: 'INTERNAL_ERROR',
    message: 'No fue posible procesar la solicitud.',
  });
}

/** Devuelve mensajes cerrados que no interpolan campos de identidad o credenciales. */
function mensajePublicoAuth(codigo: string): string {
  const mensajes: Record<string, string> = {
    ACCOUNT_NOT_AVAILABLE: 'La cuenta no puede completar esta operación.',
    ACTIVATION_NOT_AVAILABLE: 'La invitación no está disponible para reenvío.',
    AUTH_REQUIRED: 'Se requiere una sesión vigente.',
    CURRENT_PASSWORD_INVALID: 'La contraseña actual no es válida.',
    EMAIL_ALREADY_VERIFIED: 'El correo ya está verificado.',
    EMAIL_TAKEN: 'El correo no está disponible para esta cuenta.',
    EMAIL_UNCHANGED: 'El correo nuevo debe ser distinto al actual.',
    INVALID_EMAIL: 'El correo no tiene un formato válido.',
    PASSWORD_TOO_LONG: 'La contraseña no puede superar 128 puntos de código.',
    PASSWORD_TOO_SHORT: 'La contraseña debe tener al menos 15 puntos de código.',
    COMMON_PASSWORD: 'La contraseña es demasiado común o predecible.',
    RATE_LIMITED: 'Espera antes de volver a solicitar este proceso.',
    TOKEN_INVALID_OR_EXPIRED: 'El enlace no es válido o venció.',
    USER_NOT_FOUND: 'No se encontró la cuenta solicitada.',
  };

  return mensajes[codigo] ?? 'No fue posible procesar la solicitud.';
}
