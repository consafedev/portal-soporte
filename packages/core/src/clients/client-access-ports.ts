import type { EstadoUsuario, RolUsuario } from '../auth/models.js';
import type { ActorAdministracionClientes, EstadoRegistroCliente } from './ports.js';

/** Capacidades allowlisted por cliente para operaciones del Portal. */
export type CapacidadCliente = 'rf-1:read' | 'rf-1:execute';

/** Identidad mínima de una solicitud autenticada para consultar acceso vigente. */
export interface ActorAccesoCliente {
  /** UUID de la cuenta autenticada, revalidada desde PostgreSQL en cada solicitud. */
  readonly actorUserId: string;
  /** Identificador generado por Fastify para correlación y auditoría. */
  readonly requestId: string;
}

/** Cliente permitido en la selección operativa, sin configuración de conexión. */
export interface ClienteAccesible {
  /** UUID del cliente. */
  readonly id: string;
  /** Nombre que puede mostrarse en el Portal. */
  readonly nombre: string;
  /** Estado lógico que determina si admite operaciones. */
  readonly estado: EstadoRegistroCliente;
}

/** Estado de identidad consultado en PostgreSQL, no tomado de la cookie de sesión. */
export interface UsuarioAccesoCliente {
  /** Rol vigente del usuario. */
  readonly role: RolUsuario;
  /** Estado vigente del usuario. */
  readonly status: EstadoUsuario;
}

/** Autorización que el repositorio obtiene en una sola lectura del estado actual. */
export interface EstadoAutorizacionCliente {
  /** Usuario actual, o null si fue eliminado o ya no existe. */
  readonly usuario: UsuarioAccesoCliente | null;
  /** Estado vigente del cliente, o null si no existe. */
  readonly estadoCliente: EstadoRegistroCliente | null;
  /** Valor actual de la capacidad solicitada; ausente equivale a false. */
  readonly capacidadHabilitada: boolean;
  /** Indica que existe una asignación vigente usuario-cliente. */
  readonly asignacionVigente: boolean;
}

/** Fila de asignación redactada para presentar su vigencia a ADMIN. */
export interface AsignacionClienteUsuario {
  /** UUID interno de la cuenta SUPPORT. */
  readonly userId: string;
  /** Nombre visible de la cuenta SUPPORT. */
  readonly displayName: string;
  /** Estado vigente de la cuenta SUPPORT. */
  readonly userStatus: EstadoUsuario;
  /** Fecha de la concesión original. */
  readonly grantedAt: Date;
  /** Fecha de revocación vigente o null si el permiso sigue activo. */
  readonly revokedAt: Date | null;
}

/** Estado persistido de una capacidad; la ausencia de fila se presenta como deshabilitada. */
export interface EstadoCapacidadCliente {
  /** Identificador del cliente propietario. */
  readonly clientId: string;
  /** Capacidad allowlisted que se consulta. */
  readonly capabilityId: CapacidadCliente;
  /** Estado explícito; las capacidades ausentes se exponen con valor `false`. */
  readonly enabled: boolean;
  /** Fecha del último cambio o `null` si aún no existe una decisión persistida. */
  readonly changedAt: Date | null;
}

/** Resultados controlados al conceder o reactivar una asignación. */
export type ResultadoConcesionAccesoCliente =
  | 'CREATED'
  | 'ALREADY_ACTIVE'
  | 'CLIENT_NOT_FOUND'
  | 'CLIENT_INACTIVE'
  | 'USER_NOT_FOUND'
  | 'USER_NOT_SUPPORT'
  | 'USER_INACTIVE'
  | 'ACTOR_FORBIDDEN';

/** Resuelve el acceso persistente por cliente y registra las mutaciones administradas. */
export interface RepositorioAccesoCliente {
  /** Devuelve rol y estado actuales de una cuenta, sin datos de autenticación. */
  buscarUsuarioActual(userId: string): Promise<UsuarioAccesoCliente | null>;
  /** Lista el catálogo global y vuelve a verificar ADMIN activo para el usuario indicado. */
  listarClientesGlobales(actorUserId: string): Promise<readonly ClienteAccesible[]>;
  /** Lista clientes activos asignados y vuelve a verificar SUPPORT activo. */
  listarClientesAsignados(userId: string): Promise<readonly ClienteAccesible[]>;
  /** Lista el historial de asignaciones con campos aptos para ADMIN. */
  listarAsignaciones(clientId: string): Promise<readonly AsignacionClienteUsuario[]>;
  /** Lista las capacidades conocidas y representa como apagadas las que no tienen fila. */
  listarCapacidades(clientId: string): Promise<readonly EstadoCapacidadCliente[]>;
  /** Concede o reactiva acceso y audita dentro de una transacción que revalida al ADMIN. */
  conceder(
    clientId: string,
    userId: string,
    actor: ActorAdministracionClientes,
  ): Promise<ResultadoConcesionAccesoCliente>;
  /** Revoca una asignación vigente y audita atómicamente; revalida ADMIN en la transacción. */
  revocar(
    clientId: string,
    userId: string,
    actor: ActorAdministracionClientes,
  ): Promise<'REVOKED' | 'NOT_FOUND' | 'ACTOR_FORBIDDEN'>;
  /** Persiste una capacidad y su auditoría en una transacción que revalida al ADMIN. */
  establecerCapacidad(
    clientId: string,
    capacidad: CapacidadCliente,
    habilitada: boolean,
    actor: ActorAdministracionClientes,
  ): Promise<'UPDATED' | 'CLIENT_NOT_FOUND' | 'ACTOR_FORBIDDEN'>;
  /** Obtiene identidad, cliente, asignación y capacidad desde PostgreSQL sin caché. */
  consultarEstadoAutorizacion(
    userId: string,
    clientId: string,
    capacidad: CapacidadCliente,
  ): Promise<EstadoAutorizacionCliente>;
}
