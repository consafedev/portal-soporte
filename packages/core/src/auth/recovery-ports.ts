import type { EstadoUsuario, RolUsuario } from './models.js';
import type { EventoAuditoriaAuth } from './ports.js';

/** Propósitos cerrados de tokens de un solo uso de autenticación. */
export type PropositoTokenAuth =
  'ACTIVATION' | 'PASSWORD_RECOVERY' | 'EMAIL_CHANGE' | 'EMAIL_VERIFICATION';

/** Identidad mínima que permite aplicar recuperación sin exponer campos de persistencia. */
export interface CuentaCredencialesAuth {
  /** UUID de la cuenta del portal. */
  readonly id: string;
  /** Username normalizado, usado solo como clave interna de limitación. */
  readonly usernameNormalized: string;
  /** Correo actual, reservado para entrega SMTP. */
  readonly email: string;
  /** Correo canónico usado para consulta y unicidad. */
  readonly emailNormalized: string;
  /** Fecha de verificación o null hasta consumir su enlace. */
  readonly emailVerifiedAt: Date | null;
  /** Hash Argon2id o null antes de que una invitación se active. */
  readonly passwordHash: string | null;
  /** Rol vigente consultado en PostgreSQL. */
  readonly role: RolUsuario;
  /** Estado vigente consultado en PostgreSQL. */
  readonly status: EstadoUsuario;
}

/** Token que se persiste sin su valor opaco en claro. */
export interface EntradaTokenRecuperacionAuth {
  /** UUID interno del registro de token. */
  readonly id: string;
  /** Cuenta propietaria del token. */
  readonly userId: string;
  /** Digest SHA-256 hexadecimal del token opaco. */
  readonly tokenHash: string;
  /** Operación para la que se permite consumir el token. */
  readonly purpose: PropositoTokenAuth;
  /** Correo destino pendiente solo para propósito de cambio de correo. */
  readonly targetEmail: string | null;
  /** Instante UTC de emisión. */
  readonly createdAt: Date;
  /** Límite UTC de consumo, 30 minutos tras emisión. */
  readonly expiresAt: Date;
}

/** Cambio que se aplica al consumir un token validado dentro de transacción. */
export type CambioConsumoTokenAuth =
  | {
      /** Activación y recuperación deben reemplazar la contraseña. */
      readonly purpose: 'ACTIVATION' | 'PASSWORD_RECOVERY';
      /** Nuevo hash Argon2id, nunca la contraseña original. */
      readonly passwordHash: string;
    }
  | {
      /** El cambio/verificación de correo no recibe contraseñas. */
      readonly purpose: 'EMAIL_CHANGE' | 'EMAIL_VERIFICATION';
      /** Ningún secreto de contraseña participa de este cambio. */
      readonly passwordHash?: never;
    };

/** Operaciones transaccionales requeridas por recuperación y cambio de credenciales. */
export interface RepositorioCredencialesAuth {
  /** Busca cuenta por correo canónico sin distinguir estados o verificar existencia a la API. */
  buscarCuentaPorCorreo(emailNormalizado: string): Promise<CuentaCredencialesAuth | null>;
  /** Busca cuenta por UUID para validar reautenticación y acciones administrativas. */
  buscarCuentaPorId(userId: string): Promise<CuentaCredencialesAuth | null>;
  /** Invalida tokens previos del mismo propósito, inserta el digest y audita atómicamente. */
  crearToken(entrada: EntradaTokenRecuperacionAuth, evento: EventoAuditoriaAuth): Promise<void>;
  /** Consume token vigente del propósito exacto y muta cuenta/sesiones/auditoría en transacción. */
  consumirToken(
    tokenHash: string,
    cambio: CambioConsumoTokenAuth,
    ahora: Date,
    evento: EventoAuditoriaAuth,
  ): Promise<boolean>;
  /** Reemplaza hash y revoca todas las sesiones en la transacción auditada. */
  cambiarContrasena(
    userId: string,
    passwordHash: string,
    ahora: Date,
    evento: EventoAuditoriaAuth,
  ): Promise<boolean>;
}

/** Categorías que se contabilizan bajo los límites aprobados del portal. */
export type TipoIntentoAuth = 'LOGIN' | 'RECOVERY';

/** Controla intentos usando HMAC de identificador e IP sin persistir sus valores. */
export interface LimitadorIntentosAuth {
  /** Cuenta un intento y devuelve false al superar límites de cuenta o red. */
  registrarIntento(
    tipo: TipoIntentoAuth,
    identificador: string,
    direccionIp: string,
    ahora: Date,
  ): Promise<boolean>;
  /** Elimina contadores tras un login válido para la misma clave HMAC. */
  reiniciarIntentos(
    tipo: TipoIntentoAuth,
    identificador: string,
    direccionIp: string,
  ): Promise<void>;
}
