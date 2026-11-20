import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  actualizarAmbienteSapClienteAdminSchema,
  actualizarClienteAdminSchema,
  ambienteSapClienteAdminSchema,
  clienteAdminSchema,
  clienteParamsSchema,
  clienteYAmbienteParamsSchema,
  crearAmbienteSapClienteAdminSchema,
  crearClienteAdminSchema,
  errorClienteAdminSchema,
  listaAmbientesSapClienteAdminSchema,
  listaClientesAdminSchema,
  type ParametrosCliente,
  type ParametrosClienteAmbiente,
  type SolicitudActualizarAmbienteSapClienteAdmin,
  type SolicitudActualizarClienteAdmin,
  type SolicitudCrearAmbienteSapClienteAdmin,
  type SolicitudCrearClienteAdmin,
} from '../../../../packages/contracts/src/clients.js';
import type { EscritorAuditoriaAuth, RelojAuth } from '../../../../packages/core/src/auth/ports.js';
import type {
  AmbienteSapCliente,
  ClientePortal,
} from '../../../../packages/core/src/clients/ports.js';
import type { ConfiguracionAuth } from '../config.js';
import {
  ErrorClientesPortal,
  ServicioClientesPortal,
  type ActorAdministracionClientes,
} from '../clients/client-management-service.js';
import { requireAuthenticatedSession, requireRole } from '../auth/authorization.js';
import type { ServicioSesion } from '../auth/session-service.js';

/** Dependencias del grupo de operaciones administrativas de clientes. */
export interface DependenciasRutasAdminClientes {
  /** Origen canónico y nombres de cookies de la sesión vigente. */
  readonly configuracion: ConfiguracionAuth;
  /** Servicio que valida expiración, revocación y estado de la cuenta. */
  readonly sesiones: ServicioSesion;
  /** Servicio de dominio sin acceso a conectores externos. */
  readonly clientes: ServicioClientesPortal;
  /** Auditoría usada por el guard de autorización para registrar denegaciones. */
  readonly auditoria: EscritorAuditoriaAuth;
  /** Reloj UTC inyectado para el registro de denegaciones. */
  readonly reloj: RelojAuth;
}

/** Registra CRUD lógico de clientes y ambientes con sesión y rol ADMIN en servidor.
 * @param aplicacion Instancia Fastify en la que se publican las rutas versionadas.
 * @param dependencias Servicios de sesión, auditoría y dominio configurados para el Portal.
 * @returns Promesa resuelta tras registrar los endpoints administrativos.
 */
export async function registrarRutasAdminClientes(
  aplicacion: FastifyInstance,
  dependencias: DependenciasRutasAdminClientes,
): Promise<void> {
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
      if (error instanceof ErrorClientesPortal) {
        return respuesta.code(error.statusCode).send({
          code: error.code,
          message: traducirErrorClientes(error.code),
        });
      }

      solicitud.log.error(
        { requestId: solicitud.id, code: 'CLIENT_ADMIN_ROUTE_FAILURE' },
        'Fallo controlado de administración de clientes.',
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

    /** Devuelve la lista redactada de clientes al ADMIN autenticado. */
    async function listarClientes(): Promise<readonly ClientePortal[]> {
      return dependencias.clientes.listar();
    }

    /** Crea un cliente y responde únicamente con sus metadatos permitidos. */
    async function crearCliente(
      solicitud: FastifyRequest<{ Body: SolicitudCrearClienteAdmin }>,
      respuesta: FastifyReply,
    ) {
      const cliente = await dependencias.clientes.crear(
        solicitud.body,
        exigirActorClientes(solicitud),
      );
      return respuesta.code(201).send(cliente);
    }

    /** Cambia nombre o estado lógico del cliente indicado. */
    async function actualizarCliente(
      solicitud: FastifyRequest<{
        Params: ParametrosCliente;
        Body: SolicitudActualizarClienteAdmin;
      }>,
    ) {
      return dependencias.clientes.actualizar(
        solicitud.params.clientId,
        solicitud.body,
        exigirActorClientes(solicitud),
      );
    }

    /** Lista los ambientes SAP asociados al UUID de cliente de la ruta. */
    async function listarAmbientesSap(
      solicitud: FastifyRequest<{ Params: ParametrosCliente }>,
    ): Promise<readonly AmbienteSapCliente[]> {
      return dependencias.clientes.listarAmbientesSap(solicitud.params.clientId);
    }

    /** Registra un ambiente SAP sin confundirlo con el entorno del perfil de conexión. */
    async function crearAmbienteSap(
      solicitud: FastifyRequest<{
        Params: ParametrosCliente;
        Body: SolicitudCrearAmbienteSapClienteAdmin;
      }>,
      respuesta: FastifyReply,
    ) {
      const ambiente = await dependencias.clientes.crearAmbienteSap(
        solicitud.params.clientId,
        solicitud.body,
        exigirActorClientes(solicitud),
      );
      return respuesta.code(201).send(ambiente);
    }

    /** Modifica exclusivamente el ambiente SAP que pertenece al cliente de la ruta. */
    async function actualizarAmbienteSap(
      solicitud: FastifyRequest<{
        Params: ParametrosClienteAmbiente;
        Body: SolicitudActualizarAmbienteSapClienteAdmin;
      }>,
    ) {
      return dependencias.clientes.actualizarAmbienteSap(
        solicitud.params.clientId,
        solicitud.params.environmentId,
        solicitud.body,
        exigirActorClientes(solicitud),
      );
    }

    rutas.get(
      '/api/v1/admin/clients',
      { preHandler, schema: { response: { 200: listaClientesAdminSchema } } },
      listarClientes,
    );
    rutas.post<{ Body: SolicitudCrearClienteAdmin }>(
      '/api/v1/admin/clients',
      {
        preHandler,
        schema: {
          body: crearClienteAdminSchema,
          response: { 201: clienteAdminSchema, 400: errorClienteAdminSchema },
        },
      },
      crearCliente,
    );
    rutas.patch<{
      Params: ParametrosCliente;
      Body: SolicitudActualizarClienteAdmin;
    }>(
      '/api/v1/admin/clients/:clientId',
      {
        preHandler,
        schema: {
          params: clienteParamsSchema,
          body: actualizarClienteAdminSchema,
          response: { 200: clienteAdminSchema, 400: errorClienteAdminSchema },
        },
      },
      actualizarCliente,
    );
    rutas.get<{ Params: ParametrosCliente }>(
      '/api/v1/admin/clients/:clientId/sap-environments',
      {
        preHandler,
        schema: {
          params: clienteParamsSchema,
          response: { 200: listaAmbientesSapClienteAdminSchema },
        },
      },
      listarAmbientesSap,
    );
    rutas.post<{
      Params: ParametrosCliente;
      Body: SolicitudCrearAmbienteSapClienteAdmin;
    }>(
      '/api/v1/admin/clients/:clientId/sap-environments',
      {
        preHandler,
        schema: {
          params: clienteParamsSchema,
          body: crearAmbienteSapClienteAdminSchema,
          response: {
            201: ambienteSapClienteAdminSchema,
            400: errorClienteAdminSchema,
            409: errorClienteAdminSchema,
          },
        },
      },
      crearAmbienteSap,
    );
    rutas.patch<{
      Params: ParametrosClienteAmbiente;
      Body: SolicitudActualizarAmbienteSapClienteAdmin;
    }>(
      '/api/v1/admin/clients/:clientId/sap-environments/:environmentId',
      {
        preHandler,
        schema: {
          params: clienteYAmbienteParamsSchema,
          body: actualizarAmbienteSapClienteAdminSchema,
          response: {
            200: ambienteSapClienteAdminSchema,
            400: errorClienteAdminSchema,
            404: errorClienteAdminSchema,
            409: errorClienteAdminSchema,
          },
        },
      },
      actualizarAmbienteSap,
    );
  });
}

/** Recupera identidad y request ID validados por los prehandlers del servidor.
 * @param solicitud Solicitud Fastify que debe tener AuthContext adjunto.
 * @returns Actor con UUID autenticado y correlación de la petición.
 * @throws Error si los prehandlers no adjuntaron identidad autorizada.
 */
function exigirActorClientes(solicitud: FastifyRequest): ActorAdministracionClientes {
  if (solicitud.authContext === null) {
    throw new Error('AUTH_CONTEXT_MISSING');
  }

  return { actorUserId: solicitud.authContext.usuario.id, requestId: solicitud.id };
}

/** Localiza errores de dominio con mensajes útiles y sin datos internos.
 * @param codigo Código estable emitido por el dominio.
 * @returns Mensaje en español seguro para respuestas API.
 */
function traducirErrorClientes(codigo: ErrorClientesPortal['code']): string {
  switch (codigo) {
    case 'CLIENT_NAME_INVALID':
      return 'El nombre del cliente debe tener entre 2 y 120 caracteres.';
    case 'SAP_ENVIRONMENT_CODE_INVALID':
      return 'El código del ambiente usa caracteres no permitidos.';
    case 'SAP_ENVIRONMENT_NAME_INVALID':
      return 'El nombre del ambiente debe tener entre 2 y 120 caracteres.';
    case 'SAP_ENVIRONMENT_DUPLICATE':
      return 'Ese código ya existe en el cliente.';
    case 'CLIENT_NOT_FOUND':
      return 'No se encontró el cliente solicitado.';
    case 'SAP_ENVIRONMENT_NOT_FOUND':
      return 'No se encontró el ambiente SAP solicitado para ese cliente.';
  }
}
