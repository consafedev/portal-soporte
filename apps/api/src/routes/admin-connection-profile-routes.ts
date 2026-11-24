import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  actualizarPerfilConexionAdminSchema,
  clienteParamsSchema,
  clienteYPerfilParamsSchema,
  crearPerfilConexionAdminSchema,
  errorClienteAdminSchema,
  listaPerfilesConexionAdminSchema,
  perfilConexionAdminSchema,
  reemplazarCredencialesPerfilAdminSchema,
  resultadoPruebaPerfilAdminSchema,
  type ParametrosCliente,
  type ParametrosClientePerfil,
  type PerfilConexionAdminContrato,
  type SolicitudActualizarPerfilConexionAdmin,
  type SolicitudCrearPerfilConexionAdmin,
  type SolicitudReemplazarCredencialesPerfilAdmin,
} from '../../../../packages/contracts/src/clients.js';
import type { EscritorAuditoriaAuth, RelojAuth } from '../../../../packages/core/src/auth/ports.js';
import type { ConfiguracionAuth } from '../config.js';
import { requireAuthenticatedSession, requireRole } from '../auth/authorization.js';
import type { ServicioSesion } from '../auth/session-service.js';
import {
  ErrorPerfilesConexion,
  ServicioPerfilesConexion,
} from '../clients/connection-profile-service.js';

/** Dependencias de rutas de perfiles; no contiene material sensible en parámetros públicos. */
export interface DependenciasRutasAdminPerfilesConexion {
  /** Cookies y origen usados para validar la sesión vigente. */
  readonly configuracion: ConfiguracionAuth;
  /** Servicio de sesión que comprueba expiración y revocación en cada petición. */
  readonly sesiones: ServicioSesion;
  /** Servicio server-side de perfiles cifrados y broker acotado. */
  readonly perfiles: ServicioPerfilesConexion;
  /** Auditoría usada por el guard para denegaciones de autorización. */
  readonly auditoria: EscritorAuditoriaAuth;
  /** Reloj usado para auditoría de denegaciones. */
  readonly reloj: RelojAuth;
}

/** Registra listados, mutaciones de perfiles y pruebas MySQL exclusivamente para ADMIN.
 * @param aplicacion Instancia Fastify para publicar rutas administrativas versionadas.
 * @param dependencias Sesión, autorización, servicio de perfil y auditoría.
 * @returns Promesa resuelta después de registrar rutas con contratos estrictos.
 */
export async function registrarRutasAdminPerfilesConexion(
  aplicacion: FastifyInstance,
  dependencias: DependenciasRutasAdminPerfilesConexion,
): Promise<void> {
  await aplicacion.register(async (rutas) => {
    rutas.setErrorHandler((error, solicitud, respuesta) =>
      manejarErrorPerfil(error, solicitud, respuesta),
    );
    const preHandler = [
      requireAuthenticatedSession(dependencias.sesiones, dependencias.configuracion),
      requireRole(['ADMIN'], dependencias.auditoria, dependencias.reloj),
    ];

    /** Devuelve solo metadatos de perfiles vinculados al cliente autenticado por ruta. */
    async function listar(
      solicitud: FastifyRequest<{ Params: ParametrosCliente }>,
    ): Promise<readonly PerfilConexionAdminContrato[]> {
      const perfiles = await dependencias.perfiles.listar(solicitud.params.clientId);
      return perfiles.map((perfil) => dependencias.perfiles.presentarPerfilAdmin(perfil));
    }

    /** Cifra las credenciales de alta antes de almacenarlas y omite campos sensibles al responder. */
    async function crear(
      solicitud: FastifyRequest<{
        Params: ParametrosCliente;
        Body: SolicitudCrearPerfilConexionAdmin;
      }>,
      respuesta: FastifyReply,
    ) {
      const perfil = await dependencias.perfiles.crear(
        solicitud.params.clientId,
        solicitud.body,
        exigirActorPerfil(solicitud),
      );
      return respuesta.code(201).send(dependencias.perfiles.presentarPerfilAdmin(perfil));
    }

    /** Modifica etiqueta, ambiente, endpoint del perfil o estado sin aceptar secretos. */
    async function actualizar(
      solicitud: FastifyRequest<{
        Params: ParametrosClientePerfil;
        Body: SolicitudActualizarPerfilConexionAdmin;
      }>,
    ) {
      const perfil = await dependencias.perfiles.actualizar(
        solicitud.params.clientId,
        solicitud.params.profileId,
        solicitud.body,
        exigirActorPerfil(solicitud),
      );
      return dependencias.perfiles.presentarPerfilAdmin(perfil);
    }

    /** Reemplaza credenciales cifradas sin devolver el sobre ni el texto recibido. */
    async function reemplazarCredenciales(
      solicitud: FastifyRequest<{
        Params: ParametrosClientePerfil;
        Body: SolicitudReemplazarCredencialesPerfilAdmin;
      }>,
    ) {
      const perfil = await dependencias.perfiles.reemplazarCredenciales(
        solicitud.params.clientId,
        solicitud.params.profileId,
        solicitud.body,
        exigirActorPerfil(solicitud),
      );
      return dependencias.perfiles.presentarPerfilAdmin(perfil);
    }

    /** Ejecuta solo la prueba de perfil guardado y rechaza destinos enviados en el body. */
    async function probar(
      solicitud: FastifyRequest<{ Params: ParametrosClientePerfil }>,
      respuesta: FastifyReply,
    ) {
      if (tieneCuerpoNoVacio(solicitud.body)) {
        return respuesta.code(400).send({
          code: 'INVALID_REQUEST',
          message: 'La prueba usa el destino guardado en el perfil.',
        });
      }
      const resultado = await dependencias.perfiles.probar(
        solicitud.params.clientId,
        solicitud.params.profileId,
        exigirActorPerfil(solicitud),
      );
      return { code: resultado.code, completedAt: resultado.completedAt.toISOString() };
    }

    rutas.get<{ Params: ParametrosCliente }>(
      '/api/v1/admin/clients/:clientId/connection-profiles',
      {
        preHandler,
        schema: {
          params: clienteParamsSchema,
          response: { 200: listaPerfilesConexionAdminSchema },
        },
      },
      listar,
    );
    rutas.post<{
      Params: ParametrosCliente;
      Body: SolicitudCrearPerfilConexionAdmin;
    }>(
      '/api/v1/admin/clients/:clientId/connection-profiles',
      {
        preHandler,
        schema: {
          params: clienteParamsSchema,
          body: crearPerfilConexionAdminSchema,
          response: {
            201: perfilConexionAdminSchema,
            400: errorClienteAdminSchema,
            404: errorClienteAdminSchema,
            409: errorClienteAdminSchema,
            413: errorClienteAdminSchema,
            422: errorClienteAdminSchema,
            503: errorClienteAdminSchema,
          },
        },
        bodyLimit: 65_536,
      },
      crear,
    );
    rutas.patch<{
      Params: ParametrosClientePerfil;
      Body: SolicitudActualizarPerfilConexionAdmin;
    }>(
      '/api/v1/admin/clients/:clientId/connection-profiles/:profileId',
      {
        preHandler,
        schema: {
          params: clienteYPerfilParamsSchema,
          body: actualizarPerfilConexionAdminSchema,
          response: {
            200: perfilConexionAdminSchema,
            400: errorClienteAdminSchema,
            404: errorClienteAdminSchema,
            409: errorClienteAdminSchema,
            422: errorClienteAdminSchema,
          },
        },
      },
      actualizar,
    );
    rutas.put<{
      Params: ParametrosClientePerfil;
      Body: SolicitudReemplazarCredencialesPerfilAdmin;
    }>(
      '/api/v1/admin/clients/:clientId/connection-profiles/:profileId/credentials',
      {
        preHandler,
        schema: {
          params: clienteYPerfilParamsSchema,
          body: reemplazarCredencialesPerfilAdminSchema,
          response: {
            200: perfilConexionAdminSchema,
            400: errorClienteAdminSchema,
            404: errorClienteAdminSchema,
            413: errorClienteAdminSchema,
            422: errorClienteAdminSchema,
            503: errorClienteAdminSchema,
          },
        },
        bodyLimit: 65_536,
      },
      reemplazarCredenciales,
    );
    rutas.post<{ Params: ParametrosClientePerfil }>(
      '/api/v1/admin/clients/:clientId/connection-profiles/:profileId/test',
      {
        preHandler,
        schema: {
          params: clienteYPerfilParamsSchema,
          response: {
            200: resultadoPruebaPerfilAdminSchema,
            400: errorClienteAdminSchema,
            404: errorClienteAdminSchema,
          },
        },
      },
      probar,
    );
  });
}

/** Detecta cuerpos operativos que intenten introducir un destino distinto al del perfil. */
function tieneCuerpoNoVacio(cuerpo: unknown): boolean {
  return (
    cuerpo !== undefined &&
    (typeof cuerpo !== 'object' ||
      cuerpo === null ||
      Array.isArray(cuerpo) ||
      Object.keys(cuerpo).length > 0)
  );
}

/** Traduce fallos de validación/dominio sin imprimir body, host, usuario o secreto. */
function manejarErrorPerfil(
  error: unknown,
  solicitud: FastifyRequest,
  respuesta: FastifyReply,
): FastifyReply {
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
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    error.statusCode === 413
  ) {
    return respuesta.code(413).send({
      code: 'SECRET_PACKAGE_TOO_LARGE',
      message: 'El material de conexión excede el tamaño permitido.',
    });
  }
  if (error instanceof ErrorPerfilesConexion) {
    return respuesta.code(error.statusCode).send({
      code: error.code,
      message: traducirErrorPerfil(error.code),
    });
  }
  solicitud.log.error(
    { requestId: solicitud.id, code: 'CLIENT_CONNECTION_PROFILE_ROUTE_FAILURE' },
    'Fallo controlado de administración de perfiles de conexión.',
  );
  return respuesta.code(500).send({
    code: 'INTERNAL_ERROR',
    message: 'No fue posible procesar la solicitud.',
  });
}

/** Resuelve actor autenticado desde el contexto establecido por los prehandlers. */
function exigirActorPerfil(solicitud: FastifyRequest): { actorUserId: string; requestId: string } {
  if (solicitud.authContext === null) {
    throw new Error('AUTH_CONTEXT_MISSING');
  }
  return { actorUserId: solicitud.authContext.usuario.id, requestId: solicitud.id };
}

/** Traduce códigos estables a mensajes españoles sin incluir detalles de conexión. */
function traducirErrorPerfil(codigo: ErrorPerfilesConexion['code']): string {
  switch (codigo) {
    case 'PROFILE_NAME_INVALID':
      return 'El nombre debe tener entre 2 y 120 caracteres.';
    case 'PROFILE_CONFIGURATION_INVALID':
      return 'La ruta de conexión, el gateway o los certificados no son coherentes.';
    case 'DESTINATION_NOT_ALLOWED':
      return 'El destino configurado no está disponible para esta operación.';
    case 'DESTINATION_INVALID':
      return 'Revisa el hostname, puerto y fingerprint del destino.';
    case 'PROFILE_NOT_FOUND':
      return 'No se encontró el perfil activo indicado.';
    case 'PROFILE_CHANGED':
      return 'El perfil cambió después de la vista previa; vuelve a revisar la factura.';
    case 'PROFILE_DUPLICATE':
      return 'Ya existe un perfil con ese nombre para el cliente.';
    case 'CLIENT_NOT_FOUND':
      return 'No se encontró el cliente indicado.';
    case 'SECRET_CUSTODY_DISABLED':
      return 'La custodia de credenciales no está configurada.';
    case 'SECRET_CUSTODY_UNAVAILABLE':
      return 'La custodia segura no está disponible.';
    case 'SECRET_PACKAGE_TOO_LARGE':
      return 'El material de conexión excede el tamaño permitido.';
    case 'SECRET_PACKAGE_INVALID':
      return 'El paquete de credenciales no es válido.';
    case 'CONNECTOR_BUSY':
      return 'El conector está atendiendo otra operación.';
    case 'CONNECTION_FAILED':
      return 'No fue posible establecer la conexión configurada.';
    case 'CONNECTION_TIMEOUT':
      return 'La conexión superó el tiempo permitido.';
    case 'REQUEST_ABORTED':
      return 'La solicitud de conexión fue cancelada.';
  }
}
