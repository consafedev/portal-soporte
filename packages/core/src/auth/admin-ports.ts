import type { RespuestaUsuarioAdmin, RolUsuario, EstadoUsuario } from './models.js';
import type { EventoAuditoriaAuth } from './ports.js';

/** Campos persistidos de un usuario invitado antes de recibir contraseña propia. */
export interface EntradaUsuarioAdminPersistida {
  /** UUID generado en el servidor para la nueva cuenta. */
  readonly id: string;
  /** Nombre canónico visible en la interfaz y durante el login. */
  readonly username: string;
  /** Nombre de usuario normalizado para búsquedas y unicidad. */
  readonly usernameNormalized: string;
  /** Nombre descriptivo proporcionado por el administrador. */
  readonly displayName: string;
  /** Correo de destino pendiente de verificación. */
  readonly email: string;
  /** Correo normalizado para búsquedas y unicidad. */
  readonly emailNormalized: string;
  /** Fecha nula hasta que la persona consuma el enlace de activación. */
  readonly emailVerifiedAt: null;
  /** Nulo mientras la cuenta invitada aún no establece contraseña. */
  readonly passwordHash: null;
  /** Rol asignado por el administrador. */
  readonly role: RolUsuario;
  /** Las cuentas invitadas no pueden iniciar sesión antes de activarse. */
  readonly status: 'PENDING_ACTIVATION';
  /** Instante UTC de creación. */
  readonly createdAt: Date;
  /** Instante UTC de última modificación. */
  readonly updatedAt: Date;
}

/** Campos del primer administrador persistidos tras hash Argon2id. */
export interface EntradaBootstrapAdminPersistida {
  /** UUID aleatorio generado dentro del proceso de bootstrap. */
  readonly id: string;
  /** Nombre de usuario presentado en el primer acceso. */
  readonly username: string;
  /** Username normalizado. */
  readonly usernameNormalized: string;
  /** Nombre visible del responsable inicial. */
  readonly displayName: string;
  /** Correo aún no verificado del primer administrador. */
  readonly email: string;
  /** Correo normalizado. */
  readonly emailNormalized: string;
  /** La identidad inicial debe verificar el correo en un flujo posterior. */
  readonly emailVerifiedAt: null;
  /** PHC Argon2id; el valor claro solo existe en el proceso durante el hash. */
  readonly passwordHash: string;
  /** El bootstrap crea exclusivamente el rol inicial ADMIN. */
  readonly role: 'ADMIN';
  /** El primer administrador queda activo de inmediato. */
  readonly status: 'ACTIVE';
  /** Instante UTC de creación. */
  readonly createdAt: Date;
  /** Instante UTC de última modificación. */
  readonly updatedAt: Date;
}

/** Campos mutables de una cuenta que no incluyen correo sin verificación. */
export interface CambiosUsuarioAdminPersistidos {
  /** Username visible, si cambió. */
  readonly username?: string;
  /** Username canónico para unicidad, si cambió. */
  readonly usernameNormalized?: string;
  /** Nombre visible, si cambió. */
  readonly displayName?: string;
  /** Rol objetivo, si cambió. */
  readonly role?: RolUsuario;
  /** Estado objetivo, si cambió. */
  readonly status?: EstadoUsuario;
  /** Instante UTC de la mutación. */
  readonly updatedAt: Date;
}

/** Errores controlados que puede producir la persistencia administrativa. */
export type CodigoErrorRepositorioAdmin =
  | 'ADMIN_ALREADY_EXISTS'
  | 'LAST_ADMIN_REQUIRED'
  | 'AUTH_INVARIANT_UNAVAILABLE'
  | 'USER_NOT_FOUND'
  | 'USERNAME_TAKEN'
  | 'EMAIL_TAKEN'
  | 'ACTIVATION_REQUIRED';

/** Error de persistencia con código estable y sin datos de SQL o de cuenta. */
export class ErrorRepositorioUsuariosAdmin extends Error {
  /** Construye un error acotado para traducirlo a una respuesta pública segura. */
  public constructor(public readonly code: CodigoErrorRepositorioAdmin) {
    super(code);
    this.name = 'ErrorRepositorioUsuariosAdmin';
  }
}

/** Contrato mínimo que permite serializar la creación del administrador inicial. */
export interface RepositorioBootstrapAdmin {
  /** Inserta el primer ADMIN con lock transaccional y auditoría atómica. */
  crearAdministradorInicial(
    entrada: EntradaBootstrapAdminPersistida,
    evento: EventoAuditoriaAuth,
  ): Promise<RespuestaUsuarioAdmin>;
}

/** Operaciones de persistencia necesarias para administración server-side. */
export interface RepositorioUsuariosAdmin extends RepositorioBootstrapAdmin {
  /** Lista DTOs acotados sin hashes, tokens ni credenciales. */
  listarUsuarios(): Promise<readonly RespuestaUsuarioAdmin[]>;
  /** Crea una invitación pendiente y su evento en una sola transacción. */
  crearUsuario(
    entrada: EntradaUsuarioAdminPersistida,
    evento: EventoAuditoriaAuth,
  ): Promise<RespuestaUsuarioAdmin>;
  /** Actualiza una cuenta, mantiene el invariante ADMIN y audita atómicamente. */
  actualizarUsuario(
    idUsuario: string,
    cambios: CambiosUsuarioAdminPersistidos,
    evento: EventoAuditoriaAuth,
  ): Promise<RespuestaUsuarioAdmin | null>;
  /** Revoca sesiones de una cuenta y audita el resultado en la misma transacción. */
  revocarSesionesAdmin(
    idUsuario: string,
    revocadasEn: Date,
    evento: EventoAuditoriaAuth,
  ): Promise<number | null>;
}
