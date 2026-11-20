import fastify, { LogController, type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type {
  EscritorAuditoriaAuth,
  RelojAuth,
  ServicioAutenticacion,
} from '../../../packages/core/src/auth/ports.js';
import type { ConfiguracionAuth } from './config.js';
import { registrarProteccionCsrf } from './plugins/csrf.js';
import { registrarRutasAuth } from './routes/auth-routes.js';
import { registrarRutasUsuariosAdmin } from './routes/admin-user-routes.js';
import type { ServicioSesion } from './auth/session-service.js';
import { registrarDecoradorContextoAuth } from './auth/authorization.js';
import type { ServicioUsuariosAdmin } from './auth/admin-user-service.js';
import type { LimitadorIntentosAuth } from '../../../packages/core/src/auth/recovery-ports.js';
import type { ServicioRecuperacionAuth } from './auth/recovery-service.js';
import { registrarRutasRecuperacion } from './routes/recovery-routes.js';
import { extraerDiagnosticoBaseDatosSeguro } from './logging/safe-database-error.js';

const CAMPOS_SENSIBLES_LOG = [
  'req.headers.cookie',
  'req.headers.set-cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'req.body.password',
  'req.body.initialPassword',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.passwordHash',
  'req.body.token',
  'res.headers["set-cookie"]',
];

/** Dependencias requeridas para construir el servidor HTTP autenticado. */
export interface DependenciasServidorAuth {
  /** Valores validados desde variables de entorno. */
  readonly configuracion: ConfiguracionAuth;
  /** Servicio de login con precalentamiento del hash anti-enumeración. */
  readonly autenticacion: ServicioAutenticacion;
  /** Servicio PostgreSQL que valida y revoca sesiones opacas. */
  readonly sesiones: ServicioSesion;
  /** Puerto de auditoría para login y logout sin datos de credenciales. */
  readonly auditoria: EscritorAuditoriaAuth;
  /** Fuente UTC de tiempo inyectable para acciones sensibles. */
  readonly reloj: RelojAuth;
  /** Limitador HMAC persistente que controla login y recuperación por red/cuenta. */
  readonly limitador: LimitadorIntentosAuth;
  /** Flujos de activación, recuperación y cambios propios de credenciales/correo. */
  readonly recuperacion: ServicioRecuperacionAuth;
  /** Servicio opcional de administración registrado solo cuando el runtime lo configura. */
  readonly usuariosAdmin?: ServicioUsuariosAdmin;
  /** Generador opcional de IDs de solicitud para aislar trazas sintéticas de integración. */
  readonly generarIdSolicitud?: () => string;
}

/**
 * Construye Fastify con proxy deny-by-default, redacción y rutas de autenticación.
 *
 * @param dependencias - Configuración validada y servicios de autenticación/sesión.
 * @returns Aplicación Fastify preparada para inyección o para escuchar en una red privada.
 * @throws Error si falla el registro del parser o el precalentamiento criptográfico.
 */
export async function crearServidorAuth(
  dependencias: DependenciasServidorAuth,
): Promise<FastifyInstance> {
  const aplicacion = fastify({
    bodyLimit: 16 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    logController: new LogController({ disableRequestLogging: true }),
    routerOptions: { maxParamLength: 128 },
    trustProxy: [...dependencias.configuracion.trustedProxyCidrs],
    ...(dependencias.generarIdSolicitud === undefined
      ? {}
      : { genReqId: dependencias.generarIdSolicitud }),
    logger: {
      level: 'info',
      redact: { paths: CAMPOS_SENSIBLES_LOG, censor: '[REDACTADO]' },
    },
  });

  await aplicacion.register(fastifyCookie);
  registrarDecoradorContextoAuth(aplicacion);
  registrarProteccionCsrf(aplicacion, dependencias.configuracion);
  aplicacion.setErrorHandler((error, solicitud, respuesta) => {
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

    solicitud.log.error(
      {
        requestId: solicitud.id,
        code: 'UNHANDLED_AUTH_ERROR',
        ...extraerDiagnosticoBaseDatosSeguro(error),
      },
      'Fallo controlado de solicitud de autenticación.',
    );

    return respuesta.code(500).send({
      code: 'INTERNAL_ERROR',
      message: 'No fue posible procesar la solicitud.',
    });
  });
  aplicacion.setNotFoundHandler((_solicitud, respuesta) =>
    respuesta.code(404).send({ code: 'NOT_FOUND', message: 'La ruta solicitada no existe.' }),
  );
  registrarRutasAuth(aplicacion, dependencias);
  await registrarRutasRecuperacion(aplicacion, {
    configuracion: dependencias.configuracion,
    sesiones: dependencias.sesiones,
    recuperacion: dependencias.recuperacion,
  });
  if (dependencias.usuariosAdmin !== undefined) {
    await registrarRutasUsuariosAdmin(aplicacion, {
      configuracion: dependencias.configuracion,
      sesiones: dependencias.sesiones,
      usuarios: dependencias.usuariosAdmin,
      auditoria: dependencias.auditoria,
      reloj: dependencias.reloj,
      recuperacion: dependencias.recuperacion,
    });
  }
  await dependencias.autenticacion.preparar();

  return aplicacion;
}
