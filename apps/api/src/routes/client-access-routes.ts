import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ambienteSapClienteAdminSchema,
  accesoClienteAdminSchema,
  capacidadClienteParamsSchema,
  clienteParamsSchema,
  clienteYAmbienteParamsSchema,
  clienteYPerfilParamsSchema,
  clienteYUsuarioParamsSchema,
  establecerCapacidadClienteSchema,
  listaAmbientesSapClienteAdminSchema,
  listaClientesAccesiblesSchema,
  listaPerfilesConexionAccesiblesSchema,
  perfilConexionAccesibleSchema,
  type ParametrosCapacidadCliente,
  type ParametrosCliente,
  type ParametrosClienteAmbiente,
  type ParametrosClientePerfil,
  type ParametrosClienteUsuario,
  type SolicitudEstablecerCapacidadCliente,
} from '../../../../packages/contracts/src/clients.js';
import type { EscritorAuditoriaAuth, RelojAuth } from '../../../../packages/core/src/auth/ports.js';
import type { ConfiguracionAuth } from '../config.js';
import { requireAuthenticatedSession, requireRole } from '../auth/authorization.js';
import type { ServicioSesion } from '../auth/session-service.js';
import { ErrorAccesoCliente, ServicioAccesoCliente } from '../clients/client-access-service.js';
import type { ServicioClientesPortal } from '../clients/client-management-service.js';
import { ServicioPerfilesConexion } from '../clients/connection-profile-service.js';

/** Dependencias de rutas del acceso por cliente y lectura de catálogos autorizados. */
export interface DependenciasRutasAccesoClientes {
  /** Política de origen, cookie y CSRF del entorno actual. */
  readonly configuracion: ConfiguracionAuth;
  /** Servicio que resuelve sesión, vencimiento y estado vigente de la cuenta. */
  readonly sesiones: ServicioSesion;
  /** Servicio de aplicación que evalúa asignaciones y capacidades actuales. */
  readonly acceso: ServicioAccesoCliente;
  /** Catálogo de clientes y ambientes SAP sin conectores externos. */
  readonly clientes: ServicioClientesPortal;
  /** Catálogo de perfiles que solo devuelve metadatos redactados. */
  readonly perfiles: ServicioPerfilesConexion;
  /** Auditoría de denegaciones de rol emitidas por el guard ADMIN. */
  readonly auditoria: EscritorAuditoriaAuth;
  /** Reloj UTC para auditoría de denegaciones. */
  readonly reloj: RelojAuth;
}

/** Registra administración de acceso y consultas de catálogo de clientes autorizados. */
export async function registrarRutasAccesoClientes(
  aplicacion: FastifyInstance,
  dependencias: DependenciasRutasAccesoClientes,
): Promise<void> {
  await aplicacion.register(async (rutas) => {
    rutas.setErrorHandler(manejarErrorAcceso);
    const autenticado = requireAuthenticatedSession(
      dependencias.sesiones,
      dependencias.configuracion,
    );
    const soloAdministrador = [
      autenticado,
      requireRole(['ADMIN'], dependencias.auditoria, dependencias.reloj),
    ];

    /** Devuelve asignaciones y capacidades actuales sin secretos ni datos de correo. */
    async function obtenerAcceso(solicitud: FastifyRequest<{ Params: ParametrosCliente }>) {
      const [asignaciones, capacidades] = await Promise.all([
        dependencias.acceso.listarAsignaciones(solicitud.params.clientId),
        dependencias.acceso.listarCapacidades(solicitud.params.clientId),
      ]);
      return {
        asignaciones: asignaciones.map((asignacion) => ({
          userId: asignacion.userId,
          displayName: asignacion.displayName,
          userActive: asignacion.userStatus === 'ACTIVE',
          grantedAt: asignacion.grantedAt.toISOString(),
          revokedAt: asignacion.revokedAt?.toISOString() ?? null,
        })),
        capacidades: capacidades.map((capacidad) => ({
          clientId: capacidad.clientId,
          capabilityId: capacidad.capabilityId,
          enabled: capacidad.enabled,
          changedAt: capacidad.changedAt?.toISOString() ?? null,
        })),
      };
    }

    /** Concede acceso al SUPPORT activo indicado y deja auditoría en PostgreSQL. */
    async function concederAcceso(
      solicitud: FastifyRequest<{ Params: ParametrosClienteUsuario }>,
      respuesta: FastifyReply,
    ): Promise<FastifyReply> {
      await dependencias.acceso.conceder(
        solicitud.params.clientId,
        solicitud.params.userId,
        exigirActor(solicitud),
      );
      return respuesta.code(204).send();
    }

    /** Revoca la asignación sin invalidar otras sesiones ni revelar credenciales. */
    async function revocarAcceso(
      solicitud: FastifyRequest<{ Params: ParametrosClienteUsuario }>,
      respuesta: FastifyReply,
    ): Promise<FastifyReply> {
      await dependencias.acceso.revocar(
        solicitud.params.clientId,
        solicitud.params.userId,
        exigirActor(solicitud),
      );
      return respuesta.code(204).send();
    }

    /** Guarda exclusivamente el estado de una capacidad allowlisted del cliente. */
    async function actualizarCapacidad(
      solicitud: FastifyRequest<{
        Params: ParametrosCapacidadCliente;
        Body: SolicitudEstablecerCapacidadCliente;
      }>,
      respuesta: FastifyReply,
    ): Promise<FastifyReply> {
      await dependencias.acceso.establecerCapacidad(
        solicitud.params.clientId,
        solicitud.params.capabilityId,
        solicitud.body.enabled,
        exigirActor(solicitud),
      );
      return respuesta.code(204).send();
    }

    /** Lista únicamente clientes activos autorizados por asignación y rf-1:read. */
    async function listarClientes(solicitud: FastifyRequest) {
      return dependencias.acceso.listarClientes(exigirActorAcceso(solicitud));
    }

    /** Comprueba permiso de lectura antes de consultar ambientes SAP del cliente. */
    async function listarAmbientes(solicitud: FastifyRequest<{ Params: ParametrosCliente }>) {
      await dependencias.acceso.exigir(
        exigirActorAcceso(solicitud),
        solicitud.params.clientId,
        'rf-1:read',
      );
      const ambientes = await dependencias.clientes.listarAmbientesSap(solicitud.params.clientId);
      return ambientes.filter((ambiente) => ambiente.estado === 'ACTIVE');
    }

    /** Comprueba permiso y pertenencia antes de responder el ambiente solicitado. */
    async function obtenerAmbiente(
      solicitud: FastifyRequest<{ Params: ParametrosClienteAmbiente }>,
    ) {
      await dependencias.acceso.exigir(
        exigirActorAcceso(solicitud),
        solicitud.params.clientId,
        'rf-1:read',
      );
      const ambientes = await dependencias.clientes.listarAmbientesSap(solicitud.params.clientId);
      const ambiente = ambientes.find(
        (fila) => fila.id === solicitud.params.environmentId && fila.estado === 'ACTIVE',
      );
      if (ambiente === undefined) {
        throw new ErrorAccesoCliente('CLIENT_ACCESS_DENIED', 403);
      }
      return ambiente;
    }

    /** Comprueba permiso antes de consultar perfiles, cuyo repositorio no carga sobres cifrados. */
    async function listarPerfiles(solicitud: FastifyRequest<{ Params: ParametrosCliente }>) {
      await dependencias.acceso.exigir(
        exigirActorAcceso(solicitud),
        solicitud.params.clientId,
        'rf-1:read',
      );
      const perfiles = await dependencias.perfiles.listar(solicitud.params.clientId);
      return perfiles
        .filter((perfil) => perfil.estado === 'ACTIVE')
        .map((perfil) => ({
          id: perfil.id,
          clientId: perfil.clientId,
          nombre: perfil.nombre,
          tipo: perfil.tipo,
          entorno: perfil.entorno,
          estado: perfil.estado,
        }));
    }

    /** Comprueba permiso y pertenencia antes de responder un único perfil redactado. */
    async function obtenerPerfil(solicitud: FastifyRequest<{ Params: ParametrosClientePerfil }>) {
      await dependencias.acceso.exigir(
        exigirActorAcceso(solicitud),
        solicitud.params.clientId,
        'rf-1:read',
      );
      const perfiles = await dependencias.perfiles.listar(solicitud.params.clientId);
      const perfil = perfiles.find(
        (fila) => fila.id === solicitud.params.profileId && fila.estado === 'ACTIVE',
      );
      if (perfil === undefined) {
        throw new ErrorAccesoCliente('CLIENT_ACCESS_DENIED', 403);
      }
      return {
        id: perfil.id,
        clientId: perfil.clientId,
        nombre: perfil.nombre,
        tipo: perfil.tipo,
        entorno: perfil.entorno,
        estado: perfil.estado,
      };
    }

    rutas.get<{ Params: ParametrosCliente }>(
      '/api/v1/admin/clients/:clientId/access',
      {
        preHandler: soloAdministrador,
        schema: {
          params: clienteParamsSchema,
          response: { 200: accesoClienteAdminSchema },
        },
      },
      obtenerAcceso,
    );
    rutas.put<{ Params: ParametrosClienteUsuario }>(
      '/api/v1/admin/clients/:clientId/access/users/:userId',
      {
        preHandler: soloAdministrador,
        schema: { params: clienteYUsuarioParamsSchema },
      },
      concederAcceso,
    );
    rutas.delete<{ Params: ParametrosClienteUsuario }>(
      '/api/v1/admin/clients/:clientId/access/users/:userId',
      {
        preHandler: soloAdministrador,
        schema: { params: clienteYUsuarioParamsSchema },
      },
      revocarAcceso,
    );
    rutas.put<{
      Params: ParametrosCapacidadCliente;
      Body: SolicitudEstablecerCapacidadCliente;
    }>(
      '/api/v1/admin/clients/:clientId/capabilities/:capabilityId',
      {
        preHandler: soloAdministrador,
        schema: {
          params: capacidadClienteParamsSchema,
          body: establecerCapacidadClienteSchema,
        },
      },
      actualizarCapacidad,
    );
    rutas.get(
      '/api/v1/clients',
      {
        preHandler: autenticado,
        schema: { response: { 200: listaClientesAccesiblesSchema } },
      },
      listarClientes,
    );
    rutas.get<{ Params: ParametrosCliente }>(
      '/api/v1/clients/:clientId/sap-environments',
      {
        preHandler: autenticado,
        schema: {
          params: clienteParamsSchema,
          response: { 200: listaAmbientesSapClienteAdminSchema },
        },
      },
      listarAmbientes,
    );
    rutas.get<{ Params: ParametrosClienteAmbiente }>(
      '/api/v1/clients/:clientId/sap-environments/:environmentId',
      {
        preHandler: autenticado,
        schema: {
          params: clienteYAmbienteParamsSchema,
          response: { 200: ambienteSapClienteAdminSchema },
        },
      },
      obtenerAmbiente,
    );
    rutas.get<{ Params: ParametrosCliente }>(
      '/api/v1/clients/:clientId/connection-profiles',
      {
        preHandler: autenticado,
        schema: {
          params: clienteParamsSchema,
          response: { 200: listaPerfilesConexionAccesiblesSchema },
        },
      },
      listarPerfiles,
    );
    rutas.get<{ Params: ParametrosClientePerfil }>(
      '/api/v1/clients/:clientId/connection-profiles/:profileId',
      {
        preHandler: autenticado,
        schema: {
          params: clienteYPerfilParamsSchema,
          response: { 200: perfilConexionAccesibleSchema },
        },
      },
      obtenerPerfil,
    );
  });
}

/** Obtiene el actor ADMIN autenticado y el request ID para auditoría transaccional. */
function exigirActor(solicitud: FastifyRequest): { actorUserId: string; requestId: string } {
  if (solicitud.authContext === null) {
    throw new Error('AUTH_CONTEXT_MISSING');
  }
  return { actorUserId: solicitud.authContext.usuario.id, requestId: solicitud.id };
}

/** Obtiene identidad y correlación actuales para validar permisos por cliente. */
function exigirActorAcceso(solicitud: FastifyRequest): { actorUserId: string; requestId: string } {
  if (solicitud.authContext === null) {
    throw new Error('AUTH_CONTEXT_MISSING');
  }
  return { actorUserId: solicitud.authContext.usuario.id, requestId: solicitud.id };
}

/** Traduce autorización y validación a errores HTTP estables sin detalles de recursos. */
function manejarErrorAcceso(
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
  if (error instanceof ErrorAccesoCliente) {
    return respuesta.code(error.statusCode).send({
      code: error.code,
      message:
        error.statusCode === 403
          ? 'No tienes acceso a este cliente o a la operación solicitada.'
          : traducirErrorAcceso(error.code),
    });
  }

  solicitud.log.error(
    { requestId: solicitud.id, code: 'CLIENT_ACCESS_ROUTE_FAILURE' },
    'Fallo controlado de rutas de acceso por cliente.',
  );
  return respuesta.code(500).send({
    code: 'INTERNAL_ERROR',
    message: 'No fue posible procesar la solicitud.',
  });
}

/** Devuelve mensajes públicos en español para errores funcionales no sensibles. */
function traducirErrorAcceso(codigo: ErrorAccesoCliente['code']): string {
  switch (codigo) {
    case 'INPUT_INVALID':
      return 'La solicitud contiene identificadores o valores no válidos.';
    case 'CAPABILITY_UNKNOWN':
      return 'La capacidad solicitada no está disponible.';
    case 'CLIENT_NOT_FOUND':
      return 'No se encontró el cliente indicado.';
    case 'USER_NOT_FOUND':
      return 'No se encontró el usuario indicado.';
    case 'USER_NOT_SUPPORT':
      return 'Solo se puede asignar acceso a usuarios SUPPORT.';
    case 'USER_NOT_ACTIVE':
      return 'El usuario debe estar activo para recibir acceso.';
    case 'ASSIGNMENT_ALREADY_ACTIVE':
      return 'El usuario ya tiene acceso vigente a este cliente.';
    case 'ASSIGNMENT_NOT_FOUND':
      return 'No se encontró una asignación vigente para revocar.';
    case 'CLIENT_ACCESS_DENIED':
      return 'No tienes acceso a este cliente o a la operación solicitada.';
  }
}
