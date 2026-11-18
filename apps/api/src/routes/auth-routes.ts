import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
  csrfResponseSchema,
  loginRequestSchema,
  publicErrorResponseSchema,
  publicUserResponseSchema,
  type RespuestaErrorPublico,
  type RespuestaUsuarioPublico,
  type SolicitudLogin,
} from '../../../../packages/contracts/src/auth.js';
import type {
  EscritorAuditoriaAuth,
  RelojAuth,
  ServicioAutenticacion,
} from '../../../../packages/core/src/auth/ports.js';
import type { ConfiguracionAuth } from '../config.js';
import { crearTokenOpaco } from '../auth/token-service.js';
import { ServicioSesion } from '../auth/session-service.js';

const respuestaLoginSchema = Type.Object(
  { user: publicUserResponseSchema },
  { additionalProperties: false },
);
const respuestaMeSchema = Type.Object(
  { user: publicUserResponseSchema },
  { additionalProperties: false },
);

/** Unión de la identidad autenticada y del error genérico de credenciales. */
type RespuestaLogin = { readonly user: RespuestaUsuarioPublico } | RespuestaErrorPublico;

/**
 * Registra endpoints de CSRF, login, logout y consulta de identidad.
 *
 * @param aplicacion - Instancia Fastify con parser de cookies y CSRF global activos.
 * @param dependencias - Configuración de cookies y servicios de auth/sesión.
 * @returns No devuelve valor; añade las cuatro rutas públicas del núcleo.
 */
export function registrarRutasAuth(
  aplicacion: FastifyInstance,
  dependencias: {
    readonly configuracion: ConfiguracionAuth;
    readonly autenticacion: ServicioAutenticacion;
    readonly sesiones: ServicioSesion;
    readonly auditoria: EscritorAuditoriaAuth;
    readonly reloj: RelojAuth;
  },
): void {
  const { configuracion, autenticacion, sesiones, auditoria, reloj } = dependencias;

  /** Emite token CSRF en cookie HttpOnly y lo devuelve sin cachear la respuesta. */
  aplicacion.get(
    '/api/v1/auth/csrf',
    { schema: { response: { 200: csrfResponseSchema } } },
    async (_solicitud, respuesta) => {
      const token = crearTokenOpaco().valor;
      respuesta.setCookie(configuracion.cookieCsrfNombre, token, {
        httpOnly: true,
        secure: configuracion.cookiesSecure,
        sameSite: 'strict',
        path: '/',
        maxAge: 30 * 60,
      });

      return respuesta.send({ token });
    },
  );

  /** Autentica por usuario, revoca el token anterior y entrega el nuevo solo en cookie. */
  aplicacion.post<{ Body: SolicitudLogin; Reply: RespuestaLogin }>(
    '/api/v1/auth/login',
    {
      schema: {
        body: loginRequestSchema,
        response: {
          200: respuestaLoginSchema,
          401: publicErrorResponseSchema,
        },
      },
    },
    async (solicitud, respuesta) => {
      const sesionAnterior = solicitud.cookies[configuracion.cookieSesionNombre];
      if (sesionAnterior !== undefined) {
        await sesiones.revocar(sesionAnterior);
      }

      const resultado = await autenticacion.iniciarSesion(
        solicitud.body.username,
        solicitud.body.password,
      );
      if (!resultado.autenticado) {
        respuesta.clearCookie(configuracion.cookieSesionNombre, opcionesCookie(configuracion));

        return respuesta.code(401).send({
          code: 'INVALID_CREDENTIALS',
          message: 'El usuario o la contraseña no son válidos.',
        });
      }

      respuesta.setCookie(configuracion.cookieSesionNombre, resultado.tokenSesion, {
        httpOnly: true,
        secure: configuracion.cookiesSecure,
        sameSite: 'strict',
        path: '/',
        expires: resultado.idleExpiresAt,
      });

      return respuesta.code(200).send({ user: resultado.usuario });
    },
  );

  /** Cierra sesión idempotentemente, revoca el digest y limpia cookies locales. */
  aplicacion.post(
    '/api/v1/auth/logout',
    { schema: { response: { 204: Type.Null() } } },
    async (solicitud, respuesta) => {
      const token = solicitud.cookies[configuracion.cookieSesionNombre];
      const sesionVigente = token === undefined ? null : await sesiones.resolverVigente(token);
      if (token !== undefined) {
        await sesiones.revocar(token);
      }

      await auditoria.registrar({
        actorUserId: sesionVigente?.usuario.id ?? null,
        action: 'AUTH_LOGOUT',
        targetUserId: sesionVigente?.usuario.id ?? null,
        outcome: 'SUCCESS',
        metadata: {},
        createdAt: reloj.ahora(),
      });

      respuesta.clearCookie(configuracion.cookieSesionNombre, opcionesCookie(configuracion));
      respuesta.clearCookie(configuracion.cookieCsrfNombre, opcionesCookie(configuracion));

      return respuesta.code(204).send();
    },
  );

  /** Devuelve identidad y rol actuales; una sesión inválida se limpia y recibe 401. */
  aplicacion.get(
    '/api/v1/auth/me',
    {
      schema: {
        response: {
          200: respuestaMeSchema,
          401: publicErrorResponseSchema,
        },
      },
    },
    async (solicitud, respuesta) => {
      const token = solicitud.cookies[configuracion.cookieSesionNombre];
      if (token === undefined) {
        respuesta.clearCookie(configuracion.cookieSesionNombre, opcionesCookie(configuracion));

        return respuesta.code(401).send({
          code: 'AUTH_REQUIRED',
          message: 'Se requiere una sesión vigente.',
        });
      }

      const sesion = await sesiones.resolverVigente(token);
      if (sesion === null) {
        respuesta.clearCookie(configuracion.cookieSesionNombre, opcionesCookie(configuracion));

        return respuesta.code(401).send({
          code: 'AUTH_REQUIRED',
          message: 'Se requiere una sesión vigente.',
        });
      }

      respuesta.setCookie(configuracion.cookieSesionNombre, token, {
        httpOnly: true,
        secure: configuracion.cookiesSecure,
        sameSite: 'strict',
        path: '/',
        expires: sesion.idleExpiresAt,
      });

      return respuesta.code(200).send({
        user: {
          id: sesion.usuario.id,
          username: sesion.usuario.username,
          displayName: sesion.usuario.displayName,
          role: sesion.usuario.role,
        },
      });
    },
  );
}

/**
 * Devuelve atributos homogéneos al eliminar cookies de cualquiera de los ambientes.
 *
 * @param configuracion - Nombres y política Secure elegidos al iniciar el servidor.
 * @returns Atributos de cookie que mantienen el mismo path y política del origen.
 */
function opcionesCookie(configuracion: ConfiguracionAuth) {
  return {
    httpOnly: true,
    secure: configuracion.cookiesSecure,
    sameSite: 'strict' as const,
    path: '/',
  };
}
