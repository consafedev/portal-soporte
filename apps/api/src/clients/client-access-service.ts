import type {
  ActorAccesoCliente,
  AsignacionClienteUsuario,
  CapacidadCliente,
  EstadoCapacidadCliente,
  ClienteAccesible,
  RepositorioAccesoCliente,
  ResultadoConcesionAccesoCliente,
} from '../../../../packages/core/src/clients/client-access-ports.js';
import type { EstadoUsuario } from '../../../../packages/core/src/auth/models.js';
import type { ActorAdministracionClientes } from '../../../../packages/core/src/clients/ports.js';

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Error de autorización del cliente con respuesta HTTP estable y sin datos internos. */
export class ErrorAccesoCliente extends Error {
  /** Construye un fallo controlado que no conserva valores de entrada ni detalles SQL. */
  public constructor(
    public readonly code:
      | 'INPUT_INVALID'
      | 'CAPABILITY_UNKNOWN'
      | 'CLIENT_ACCESS_DENIED'
      | 'CLIENT_NOT_FOUND'
      | 'USER_NOT_FOUND'
      | 'USER_NOT_SUPPORT'
      | 'USER_NOT_ACTIVE'
      | 'ASSIGNMENT_ALREADY_ACTIVE'
      | 'ASSIGNMENT_NOT_FOUND',
    public readonly statusCode: 400 | 403 | 404 | 409 | 422,
  ) {
    super(code);
    this.name = 'ErrorAccesoCliente';
  }
}

/** Aplica el acceso vigente por cliente antes de consultar módulos o conexiones. */
export class ServicioAccesoCliente {
  /** Crea el servicio con un puerto de persistencia que consulta el estado actual. */
  public constructor(private readonly repositorio: RepositorioAccesoCliente) {}

  /** Lista todos los clientes para ADMIN y solo los activos asignados para SUPPORT. */
  public async listarClientes(actor: ActorAccesoCliente): Promise<readonly ClienteAccesible[]> {
    validarUuid(actor.actorUserId);
    const usuario = await this.repositorio.buscarUsuarioActual(actor.actorUserId);
    if (usuario === null) {
      throw denegarAcceso();
    }
    this.exigirUsuarioActivo(usuario.status);

    return usuario.role === 'ADMIN'
      ? this.repositorio.listarClientesGlobales(actor.actorUserId)
      : this.repositorio.listarClientesAsignados(actor.actorUserId);
  }

  /** Devuelve el historial redactado de asignaciones para la ruta protegida de ADMIN. */
  public async listarAsignaciones(clientId: string): Promise<readonly AsignacionClienteUsuario[]> {
    validarUuid(clientId);
    return this.repositorio.listarAsignaciones(clientId);
  }

  /** Lista las capacidades efectivas para que ADMIN pueda revisar el estado por cliente. */
  public async listarCapacidades(clientId: string): Promise<readonly EstadoCapacidadCliente[]> {
    validarUuid(clientId);
    return this.repositorio.listarCapacidades(clientId);
  }

  /** Concede o reactiva una asignación vigente mediante una transacción auditada. */
  public async conceder(
    clientId: string,
    userId: string,
    actor: ActorAdministracionClientes,
  ): Promise<void> {
    validarUuid(clientId);
    validarUuid(userId);
    await this.exigirAdministrador(actor.actorUserId);

    const resultado = await this.repositorio.conceder(clientId, userId, actor);
    traducirResultadoConcesion(resultado);
  }

  /** Revoca una asignación vigente sin invalidar la sesión general del usuario. */
  public async revocar(
    clientId: string,
    userId: string,
    actor: ActorAdministracionClientes,
  ): Promise<void> {
    validarUuid(clientId);
    validarUuid(userId);
    await this.exigirAdministrador(actor.actorUserId);

    const resultado = await this.repositorio.revocar(clientId, userId, actor);
    if (resultado === 'ACTOR_FORBIDDEN') {
      throw denegarAcceso();
    }
    if (resultado === 'NOT_FOUND') {
      throw new ErrorAccesoCliente('ASSIGNMENT_NOT_FOUND', 404);
    }
  }

  /** Establece capacidades allowlisted por cliente después de verificar ADMIN vigente. */
  public async establecerCapacidad(
    clientId: string,
    capacidad: CapacidadCliente,
    habilitada: boolean,
    actor: ActorAdministracionClientes,
  ): Promise<void> {
    validarUuid(clientId);
    validarCapacidad(capacidad);
    if (typeof habilitada !== 'boolean') {
      throw new ErrorAccesoCliente('INPUT_INVALID', 400);
    }
    await this.exigirAdministrador(actor.actorUserId);

    const resultado = await this.repositorio.establecerCapacidad(
      clientId,
      capacidad,
      habilitada,
      actor,
    );
    if (resultado === 'ACTOR_FORBIDDEN') {
      throw denegarAcceso();
    }
    if (resultado === 'CLIENT_NOT_FOUND') {
      throw new ErrorAccesoCliente('CLIENT_NOT_FOUND', 404);
    }
  }

  /** Reconsulta usuario, cliente, asignación y capacidad para autorizar esta operación. */
  public async exigir(
    actor: ActorAccesoCliente,
    clientId: string,
    capacidad: CapacidadCliente,
  ): Promise<void> {
    validarUuid(actor.actorUserId);
    validarUuid(clientId);
    validarCapacidad(capacidad);
    const estado = await this.repositorio.consultarEstadoAutorizacion(
      actor.actorUserId,
      clientId,
      capacidad,
    );
    if (
      estado.usuario === null ||
      estado.usuario.status !== 'ACTIVE' ||
      estado.estadoCliente !== 'ACTIVE' ||
      !estado.capacidadHabilitada ||
      (estado.usuario.role === 'SUPPORT' && !estado.asignacionVigente)
    ) {
      throw denegarAcceso();
    }
  }

  /** Exige que la base confirme que el actor sigue siendo ADMIN activo. */
  private async exigirAdministrador(actorUserId: string): Promise<void> {
    validarUuid(actorUserId);
    const usuario = await this.repositorio.buscarUsuarioActual(actorUserId);
    if (usuario?.role !== 'ADMIN' || usuario.status !== 'ACTIVE') {
      throw denegarAcceso();
    }
  }

  /** Rechaza cuentas desactivadas o pendientes antes de listar recursos del catálogo. */
  private exigirUsuarioActivo(estado: EstadoUsuario | undefined): void {
    if (estado !== 'ACTIVE') {
      throw denegarAcceso();
    }
  }
}

/** Valida identificadores UUID de rutas antes de consultar el repositorio. */
function validarUuid(valor: string): void {
  if (!PATRON_UUID.test(valor)) {
    throw new ErrorAccesoCliente('INPUT_INVALID', 400);
  }
}

/** Valida en runtime los identificadores allowlisted de capacidad. */
function validarCapacidad(valor: string): asserts valor is CapacidadCliente {
  if (valor !== 'rf-1:read' && valor !== 'rf-1:execute') {
    throw new ErrorAccesoCliente('CAPABILITY_UNKNOWN', 400);
  }
}

/** Traduce resultados acotados del repositorio en errores de aplicación estables. */
function traducirResultadoConcesion(resultado: ResultadoConcesionAccesoCliente): void {
  switch (resultado) {
    case 'CREATED':
      return;
    case 'ALREADY_ACTIVE':
      throw new ErrorAccesoCliente('ASSIGNMENT_ALREADY_ACTIVE', 409);
    case 'CLIENT_NOT_FOUND':
      throw new ErrorAccesoCliente('CLIENT_NOT_FOUND', 404);
    case 'CLIENT_INACTIVE':
      throw new ErrorAccesoCliente('CLIENT_ACCESS_DENIED', 403);
    case 'USER_NOT_FOUND':
      throw new ErrorAccesoCliente('USER_NOT_FOUND', 404);
    case 'USER_NOT_SUPPORT':
      throw new ErrorAccesoCliente('USER_NOT_SUPPORT', 422);
    case 'USER_INACTIVE':
      throw new ErrorAccesoCliente('USER_NOT_ACTIVE', 422);
    case 'ACTOR_FORBIDDEN':
      throw denegarAcceso();
  }
}

/** Crea la respuesta común para accesos no autorizados sin revelar la causa. */
function denegarAcceso(): ErrorAccesoCliente {
  return new ErrorAccesoCliente('CLIENT_ACCESS_DENIED', 403);
}
