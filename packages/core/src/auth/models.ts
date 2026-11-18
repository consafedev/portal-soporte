/** Roles cerrados que gobiernan las capacidades del núcleo del portal. */
export type RolUsuario = 'ADMIN' | 'SUPPORT';

/** Estados válidos para el ciclo de vida de una cuenta del portal. */
export type EstadoUsuario = 'PENDING_ACTIVATION' | 'ACTIVE' | 'DISABLED';

/** Resultado público de validar una contraseña elegida por una persona. */
export type ResultadoValidacionContrasena =
  | { readonly valida: true }
  | {
      readonly valida: false;
      readonly codigo: 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_LONG' | 'COMMON_PASSWORD';
      readonly mensaje: string;
    };

/** Identidad mínima que una sesión puede exponer al usuario autenticado. */
export interface RespuestaUsuarioPublico {
  /** Identificador interno de la cuenta, en formato UUID. */
  readonly id: string;
  /** Nombre de usuario normalizado usado para iniciar sesión. */
  readonly username: string;
  /** Nombre de presentación de la cuenta. */
  readonly displayName: string;
  /** Rol vigente leído del servidor para esta solicitud. */
  readonly role: RolUsuario;
}

/** Campos administrativos permitidos para presentar una cuenta en gestión. */
export interface RespuestaUsuarioAdmin extends RespuestaUsuarioPublico {
  /** Correo normalizado asociado a la cuenta. */
  readonly email: string;
  /** Fecha UTC de verificación del correo, o null si aún no se verifica. */
  readonly emailVerifiedAt: Date | null;
  /** Estado actual de la cuenta. */
  readonly status: EstadoUsuario;
  /** Fecha UTC de creación de la cuenta. */
  readonly createdAt: Date;
}
