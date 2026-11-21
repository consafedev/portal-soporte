import { randomUUID } from 'node:crypto';
import type { RelojAuth } from '../../../../packages/core/src/auth/ports.js';
import type {
  ActorAdministracionClientes,
  AmbienteSapCliente,
  ClientePortal,
  EstadoRegistroCliente,
  RepositorioClientes,
} from '../../../../packages/core/src/clients/ports.js';

export type { ActorAdministracionClientes } from '../../../../packages/core/src/clients/ports.js';

/** Error de dominio con código estable y sin detalles de persistencia. */
export class ErrorClientesPortal extends Error {
  /** Construye el error público con estado HTTP controlado por el adaptador. */
  public constructor(
    public readonly code:
      | 'CLIENT_NAME_INVALID'
      | 'SAP_ENVIRONMENT_CODE_INVALID'
      | 'SAP_ENVIRONMENT_NAME_INVALID'
      | 'SAP_ENVIRONMENT_DUPLICATE'
      | 'CLIENT_NOT_FOUND'
      | 'SAP_ENVIRONMENT_NOT_FOUND',
    public readonly statusCode: 400 | 404 | 409,
  ) {
    super(code);
    this.name = 'ErrorClientesPortal';
  }
}

/** Nombre de cliente recibido por la operación de alta. */
export interface SolicitudCrearCliente {
  /** Nombre visible, que se recorta antes de persistir. */
  readonly nombre: string;
}

/** Campos editables de un cliente, con estado lógico opcional. */
export interface SolicitudActualizarCliente {
  /** Nombre visible alternativo. */
  readonly nombre?: string;
  /** Estado lógico actual o desactivado. */
  readonly estado?: EstadoRegistroCliente;
}

/** Datos de alta de un ambiente SAP asociado a un cliente. */
export interface SolicitudCrearAmbienteSap {
  /** Código técnico, normalizado a mayúsculas y acotado a ASCII seguro. */
  readonly codigo: string;
  /** Nombre legible del ambiente. */
  readonly nombre: string;
}

/** Campos editables de un ambiente SAP. */
export interface SolicitudActualizarAmbienteSap {
  /** Código técnico alternativo. */
  readonly codigo?: string;
  /** Nombre legible alternativo. */
  readonly nombre?: string;
  /** Estado lógico del ambiente. */
  readonly estado?: EstadoRegistroCliente;
}

/** Gestiona clientes y ambientes SAP sin acceder a secretos ni destinos externos. */
export class ServicioClientesPortal {
  /** Crea el servicio con persistencia, reloj e identificador inyectables. */
  public constructor(
    private readonly repositorio: RepositorioClientes,
    private readonly reloj: RelojAuth,
    private readonly generarId: () => string = randomUUID,
  ) {}

  /** Devuelve todos los clientes visibles a la administración. */
  public listar(): Promise<readonly ClientePortal[]> {
    return this.repositorio.listar();
  }

  /** Crea un cliente con nombre validado y auditoría atómica en el adaptador. */
  public crear(
    entrada: SolicitudCrearCliente,
    actor: ActorAdministracionClientes,
  ): Promise<ClientePortal> {
    const nombre = normalizarNombreCliente(entrada.nombre);
    const instante = this.reloj.ahora();

    return this.repositorio.crear({ id: this.generarId(), nombre, createdAt: instante }, actor);
  }

  /** Actualiza nombre o estado sin eliminar referencias históricas. */
  public async actualizar(
    id: string,
    entrada: SolicitudActualizarCliente,
    actor: ActorAdministracionClientes,
  ): Promise<ClientePortal> {
    const cambios = {
      ...(entrada.nombre === undefined ? {} : { nombre: normalizarNombreCliente(entrada.nombre) }),
      ...(entrada.estado === undefined ? {} : { estado: entrada.estado }),
      updatedAt: this.reloj.ahora(),
    };
    const cliente = await this.repositorio.actualizar(id, cambios, actor);
    if (cliente === null) {
      throw new ErrorClientesPortal('CLIENT_NOT_FOUND', 404);
    }

    return cliente;
  }

  /** Lista ambientes SAP de un cliente sin mezclarlos con perfiles de conexión. */
  public listarAmbientesSap(clientId: string): Promise<readonly AmbienteSapCliente[]> {
    return this.repositorio.listarAmbientesSap(clientId);
  }

  /** Crea un ambiente SAP usando un código canónico único dentro del cliente. */
  public async crearAmbienteSap(
    clientId: string,
    entrada: SolicitudCrearAmbienteSap,
    actor: ActorAdministracionClientes,
  ): Promise<AmbienteSapCliente> {
    const codigo = normalizarCodigoAmbienteSap(entrada.codigo);
    const nombre = normalizarNombreAmbienteSap(entrada.nombre);
    const resultado = await this.repositorio.crearAmbienteSap(
      clientId,
      { id: this.generarId(), codigo, nombre, createdAt: this.reloj.ahora() },
      actor,
    );

    if (resultado.kind === 'CLIENT_NOT_FOUND') {
      throw new ErrorClientesPortal('CLIENT_NOT_FOUND', 404);
    }
    if (resultado.kind === 'DUPLICATE') {
      throw new ErrorClientesPortal('SAP_ENVIRONMENT_DUPLICATE', 409);
    }

    return resultado.ambiente;
  }

  /** Actualiza solo el ambiente que pertenece al cliente de la ruta. */
  public async actualizarAmbienteSap(
    clientId: string,
    ambienteId: string,
    entrada: SolicitudActualizarAmbienteSap,
    actor: ActorAdministracionClientes,
  ): Promise<AmbienteSapCliente> {
    const cambios = {
      ...(entrada.codigo === undefined
        ? {}
        : { codigo: normalizarCodigoAmbienteSap(entrada.codigo) }),
      ...(entrada.nombre === undefined
        ? {}
        : { nombre: normalizarNombreAmbienteSap(entrada.nombre) }),
      ...(entrada.estado === undefined ? {} : { estado: entrada.estado }),
      updatedAt: this.reloj.ahora(),
    };
    const resultado = await this.repositorio.actualizarAmbienteSap(
      clientId,
      ambienteId,
      cambios,
      actor,
    );

    if (resultado.kind === 'NOT_FOUND') {
      throw new ErrorClientesPortal('SAP_ENVIRONMENT_NOT_FOUND', 404);
    }
    if (resultado.kind === 'DUPLICATE') {
      throw new ErrorClientesPortal('SAP_ENVIRONMENT_DUPLICATE', 409);
    }

    return resultado.ambiente;
  }
}

/** Recorta y valida el nombre visible de un cliente. */
function normalizarNombreCliente(valor: string): string {
  const nombre = valor.trim();
  if (nombre.length < 2 || nombre.length > 120) {
    throw new ErrorClientesPortal('CLIENT_NAME_INVALID', 400);
  }

  return nombre;
}

/** Normaliza el código SAP y rechaza valores fuera de la notación pactada. */
function normalizarCodigoAmbienteSap(valor: string): string {
  const codigo = valor.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/u.test(codigo)) {
    throw new ErrorClientesPortal('SAP_ENVIRONMENT_CODE_INVALID', 400);
  }

  return codigo;
}

/** Recorta y valida el nombre legible de un ambiente SAP. */
function normalizarNombreAmbienteSap(valor: string): string {
  const nombre = valor.trim();
  if (nombre.length < 2 || nombre.length > 120) {
    throw new ErrorClientesPortal('SAP_ENVIRONMENT_NAME_INVALID', 400);
  }

  return nombre;
}
