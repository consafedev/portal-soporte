import type { EstadoUsuario, RespuestaUsuarioPublico, RolUsuario } from './models.js';

/** Proporciona el instante actual de forma sustituible en pruebas y servicios. */
export interface RelojAuth {
  /** Devuelve la hora actual en UTC sin mutar el estado del reloj. */
  ahora(): Date;
}

/** Identidad vigente asociada a una sesión que el repositorio encontró en PostgreSQL. */
export interface CuentaSesion {
  /** Identificador UUID de la cuenta. */
  readonly id: string;
  /** Username normalizado de la cuenta. */
  readonly username: string;
  /** Nombre de presentación de la cuenta. */
  readonly displayName: string;
  /** Rol leído de PostgreSQL para la petición actual. */
  readonly role: RolUsuario;
  /** Estado leído de PostgreSQL para la petición actual. */
  readonly status: EstadoUsuario;
}

/** Campos de sesión persistidos, excluyendo el valor opaco que solo ve el navegador. */
export interface SesionPersistida {
  /** Identificador UUID de la sesión. */
  readonly id: string;
  /** Identificador UUID de la cuenta propietaria. */
  readonly userId: string;
  /** Digest SHA-256 hexadecimal del token opaco. */
  readonly tokenHash: string;
  /** Fecha UTC de creación. */
  readonly createdAt: Date;
  /** Fecha UTC de la última actividad validada. */
  readonly lastUsedAt: Date;
  /** Fecha límite de inactividad. */
  readonly idleExpiresAt: Date;
  /** Fecha límite absoluta. */
  readonly absoluteExpiresAt: Date;
}

/** Registro compuesto que permite comprobar sesión y cuenta en una consulta vigente. */
export interface RegistroSesionActual {
  /** Datos de la sesión, incluido su marcador de revocación. */
  readonly sesion: SesionPersistida & { readonly revokedAt: Date | null };
  /** Datos actuales de cuenta requeridos para autorizar. */
  readonly usuario: CuentaSesion;
}

/** Datos necesarios para extender una sesión durante una petición autenticada. */
export interface RenovacionSesion {
  /** Identificador UUID de la sesión revisada. */
  readonly sessionId: string;
  /** Digest SHA-256 del token opaco recibido. */
  readonly tokenHash: string;
  /** Hora UTC de la comprobación. */
  readonly ahora: Date;
  /** Nuevo límite inactivo, nunca posterior al límite absoluto. */
  readonly venceInactivoEn: Date;
}

/** Operaciones de persistencia de sesiones que el núcleo necesita para autorizar. */
export interface RepositorioSesiones {
  /** Crea una sesión guardando solo el digest y sus expiraciones. */
  crear(entrada: SesionPersistida): Promise<void>;
  /** Busca por digest y devuelve la cuenta vigente asociada, o `null`. */
  buscarPorHash(tokenHash: string): Promise<RegistroSesionActual | null>;
  /** Extiende la sesión de forma condicional si sigue activa y no venció. */
  renovar(entrada: RenovacionSesion): Promise<boolean>;
  /** Revoca por digest con una fecha UTC y devuelve si hubo una actualización. */
  revocarPorHash(tokenHash: string, revocadaEn: Date): Promise<boolean>;
  /** Revoca sesiones de la cuenta y permite conservar la sesión de la petición actual. */
  revocarSesionesDeUsuario(
    userId: string,
    conservarSesionId: string | null,
    revocadaEn: Date,
  ): Promise<number>;
}

/** Credenciales internas de cuenta necesarias para comparar el hash durante el login. */
export interface CuentaAutenticacion extends CuentaSesion {
  /** Hash PHC Argon2id actual o `null` mientras espera activación. */
  readonly passwordHash: string | null;
}

/** Acceso a cuentas y sesiones mediante operaciones de dominio parametrizadas. */
export interface RepositorioAutenticacion extends RepositorioSesiones {
  /** Busca una cuenta usando únicamente el username canónico. */
  buscarCuentaPorUsuarioNormalizado(username: string): Promise<CuentaAutenticacion | null>;
}

/** Implementación intercambiable de hash y verificación de contraseñas. */
export interface HasheadorContrasena {
  /** Genera un hash PHC seguro de la contraseña exacta, sin registrarla. */
  hash(contrasena: string): Promise<string>;
  /** Compara en el proveedor criptográfico un valor con un hash PHC. */
  verificar(hash: string, contrasena: string): Promise<boolean>;
}

/** Tipo cerrado de correo transaccional enviado por operaciones del núcleo. */
export interface MensajeCorreoAuth {
  /** Tipo de flujo que produjo el enlace. */
  readonly tipo: 'ACTIVACION' | 'RECUPERACION' | 'VERIFICACION_CORREO' | 'CAMBIO_CORREO';
  /** Dirección normalizada del destinatario. */
  readonly destinatario: string;
  /** URL construida exclusivamente desde configuración segura. */
  readonly enlace: string;
  /** Fecha UTC de expiración del token asociado. */
  readonly venceEn: Date;
}

/** Puerto SMTP configurable que no devuelve ni persiste el secreto del mensaje. */
export interface ServicioCorreoAuth {
  /** Envía un enlace transaccional; rechaza con error controlado si falla el adaptador. */
  enviar(mensaje: MensajeCorreoAuth): Promise<void>;
}

/** Resultados cerrados admitidos por el registro de auditoría de autenticación. */
export type ResultadoAuditoriaAuth = 'SUCCESS' | 'FAILURE' | 'DENIED';

/** Evento de auditoría sin contraseña, token, cookie, correo completo ni cuerpo HTTP. */
export interface EventoAuditoriaAuth {
  /** UUID del actor o `null` para una solicitud anónima. */
  readonly actorUserId: string | null;
  /** Código estable de la operación sensible. */
  readonly action: string;
  /** UUID del usuario objetivo o `null` cuando la acción no lo tiene. */
  readonly targetUserId: string | null;
  /** Resultado público de la decisión. */
  readonly outcome: ResultadoAuditoriaAuth;
  /** Metadatos allowlistados y limitados por quien produce el evento. */
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  /** Fecha UTC del evento. */
  readonly createdAt: Date;
}

/** Puerto que persiste eventos sensibles junto con la operación que los origina. */
export interface EscritorAuditoriaAuth {
  /** Agrega un evento de auditoría sin registrar secretos ni datos innecesarios. */
  registrar(evento: EventoAuditoriaAuth): Promise<void>;
}

/** Resultado interno del login; el token solo se entrega al adaptador de sesión. */
export type ResultadoInicioSesion =
  | {
      /** Indica que las credenciales activas se verificaron correctamente. */
      readonly autenticado: true;
      /** Token opaco para emitir en cookie segura, nunca para devolver en JSON. */
      readonly tokenSesion: string;
      /** Identificador para renovar o revocar la sesión desde el backend. */
      readonly sessionId: string;
      /** Identidad pública sin hash de contraseña. */
      readonly usuario: RespuestaUsuarioPublico;
      /** Expiraciones de esta sesión. */
      readonly idleExpiresAt: Date;
      /** Expiración absoluta. */
      readonly absoluteExpiresAt: Date;
    }
  | {
      /** Indica rechazo genérico sin revelar la existencia o estado de la cuenta. */
      readonly autenticado: false;
      /** Código estable compartido por toda credencial inválida. */
      readonly codigo: 'INVALID_CREDENTIALS';
    };

/** Orquesta comparación de credenciales sin exponer hashes ni detalles de cuenta. */
export interface ServicioAutenticacion {
  /** Autentica por username canónico y crea una sesión opaca tras verificar el hash. */
  iniciarSesion(username: string, contrasena: string): Promise<ResultadoInicioSesion>;
}
