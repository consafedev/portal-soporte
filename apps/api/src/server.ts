import fastify, { LogController, type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
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
import { registrarRutasPreferenciasUsuario } from './routes/user-preferences-routes.js';
import { extraerDiagnosticoBaseDatosSeguro } from './logging/safe-database-error.js';
import type { ServicioClientesPortal } from './clients/client-management-service.js';
import { registrarRutasAdminClientes } from './routes/admin-client-routes.js';
import type { ServicioPreferenciasUsuario } from '../../../packages/core/src/preferences/service.js';
import type { ServicioPerfilesConexion } from './clients/connection-profile-service.js';
import { registrarRutasAdminPerfilesConexion } from './routes/admin-connection-profile-routes.js';
import { registrarRutasAccesoClientes } from './routes/client-access-routes.js';
import type { ServicioAccesoCliente } from './clients/client-access-service.js';
import type { ServicioVistaPreviaRf1 } from './clients/rf1-preview-service.js';
import { registrarRutasVistaPreviaRf1 } from './routes/rf1-preview-routes.js';
import type { ServicioInsercionRf1 } from './clients/rf1-insertion-service.js';

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
  'req.body.confirmationToken',
  'req.body',
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
  /** Preferencias visuales que la identidad autenticada puede gestionar en su perfil. */
  readonly preferencias: ServicioPreferenciasUsuario;
  /** Servicio opcional de administración registrado solo cuando el runtime lo configura. */
  readonly usuariosAdmin?: ServicioUsuariosAdmin;
  /** Servicio opcional de clientes; si existe, sus rutas siguen siendo ADMIN-only en backend. */
  readonly clientes?: ServicioClientesPortal;
  /** Servicio opcional ADMIN para perfiles; recibe secretos solo en operaciones de escritura. */
  readonly perfilesConexion?: ServicioPerfilesConexion;
  /** Servicio opcional de asignaciones y capacidades por cliente. */
  readonly accesoClientes?: ServicioAccesoCliente;
  /** Servicio opcional de vista previa RF-1 de solo lectura y tamaño acotado. */
  readonly vistaPreviaRf1?: ServicioVistaPreviaRf1;
  /** Servicio opcional de inserción detrás del gate global operativo. */
  readonly insercionRf1?: ServicioInsercionRf1;
  /** Generador opcional de IDs de solicitud para aislar trazas sintéticas de integración. */
  readonly generarIdSolicitud?: () => string;
}

/**
 * Construye Fastify con proxy deny-by-default, respuestas privadas, redacción y rutas de autenticación.
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

  /** Evita que una respuesta de API protegida quede almacenada en navegador o proxy compartido. */
  aplicacion.addHook('onRequest', async (_solicitud, respuesta) => {
    respuesta.header('Cache-Control', 'private, no-store');
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
  registrarRutasPreferenciasUsuario(aplicacion, {
    configuracion: dependencias.configuracion,
    sesiones: dependencias.sesiones,
    preferencias: dependencias.preferencias,
  });
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
  if (dependencias.clientes !== undefined) {
    await registrarRutasAdminClientes(aplicacion, {
      configuracion: dependencias.configuracion,
      sesiones: dependencias.sesiones,
      clientes: dependencias.clientes,
      auditoria: dependencias.auditoria,
      reloj: dependencias.reloj,
    });
  }
  if (dependencias.perfilesConexion !== undefined) {
    await registrarRutasAdminPerfilesConexion(aplicacion, {
      configuracion: dependencias.configuracion,
      sesiones: dependencias.sesiones,
      perfiles: dependencias.perfilesConexion,
      auditoria: dependencias.auditoria,
      reloj: dependencias.reloj,
    });
  }
  if (
    dependencias.accesoClientes !== undefined &&
    dependencias.clientes !== undefined &&
    dependencias.perfilesConexion !== undefined
  ) {
    await registrarRutasAccesoClientes(aplicacion, {
      configuracion: dependencias.configuracion,
      sesiones: dependencias.sesiones,
      acceso: dependencias.accesoClientes,
      clientes: dependencias.clientes,
      perfiles: dependencias.perfilesConexion,
      auditoria: dependencias.auditoria,
      reloj: dependencias.reloj,
    });
  }
  if (dependencias.vistaPreviaRf1 !== undefined) {
    await aplicacion.register(fastifyMultipart, {
      throwFileSizeLimit: true,
      limits: {
        files: 100,
        fields: 0,
        parts: 100,
        fileSize: 5 * 1024 * 1024,
        fieldNameSize: 16,
        fieldSize: 0,
        headerPairs: 64,
      },
    });
    await registrarRutasVistaPreviaRf1(aplicacion, {
      configuracion: dependencias.configuracion,
      sesiones: dependencias.sesiones,
      vistaPrevia: dependencias.vistaPreviaRf1,
      insercion: dependencias.insercionRf1,
      auditoria: dependencias.auditoria,
      reloj: dependencias.reloj,
    });
  }
  await dependencias.autenticacion.preparar();

  return aplicacion;
}
