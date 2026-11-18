import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  adminCreateUserSchema,
  adminUpdateUserSchema,
  adminUserResponseSchema,
  publicErrorResponseSchema,
  userIdParamsSchema,
  type SolicitudAltaUsuarioAdmin,
  type SolicitudModificacionUsuarioAdmin,
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

const respuestaListaUsuariosSchema = Type.Array(adminUserResponseSchema);
const respuestaRevocacionSchema = Type.Object(
  { revokedSessions: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);

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
}

/** Registra listar/crear/editar/revocar con autenticación y rol comprobados en backend. */
export async function registrarRutasUsuariosAdmin(
  aplicacion: FastifyInstance,
  dependencias: DependenciasRutasUsuariosAdmin,
): Promise<void> {
  registrarDecoradorContextoAuth(aplicacion);

  await aplicacion.register(async (rutas) => {
    rutas.setErrorHandler((error, solicitud, respuesta) => {
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
      if (error instanceof ErrorUsuarioAdmin) {
        return respuesta.code(error.statusCode).send({
          code: error.code,
          message: obtenerMensajeErrorAdmin(error.code),
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
      return respuesta
        .code(201)
        .send(await dependencias.usuarios.crear(solicitud.body, exigirActorAdmin(solicitud)));
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

    rutas.get(
      '/api/v1/admin/users',
      {
        preHandler,
        schema: {
          response: {
            200: respuestaListaUsuariosSchema,
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
            201: adminUserResponseSchema,
            400: publicErrorResponseSchema,
            401: publicErrorResponseSchema,
            403: publicErrorResponseSchema,
            409: publicErrorResponseSchema,
            503: publicErrorResponseSchema,
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
            200: respuestaRevocacionSchema,
            401: publicErrorResponseSchema,
            403: publicErrorResponseSchema,
            404: publicErrorResponseSchema,
          },
        },
      },
      revocarSesiones,
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
    role: contexto.usuario.role,
    requestId: solicitud.id,
  };
}

/** Mapea códigos administrativos a mensajes fijos que no incluyen valores suministrados. */
function obtenerMensajeErrorAdmin(codigo: string): string {
  const mensajes: Record<string, string> = {
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
