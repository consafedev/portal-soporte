import type { ResultadoPruebaConexion, SobreSecretoCifrado } from './secret-custody-ports.js';
import type { ActorAdministracionClientes } from './ports.js';

/** Tipos de perfil MySQL admitidos por el broker del Portal. */
export type TipoPerfilConexionCliente = 'MYSQL_TCP' | 'MYSQL_SSH';

/** Entornos declarativos del sistema cliente, separados del entorno del Portal. */
export type EntornoPerfilConexionCliente = 'PRODUCTION' | 'TEST';

/** Estado lógico del perfil; desactivarlo conserva sus referencias y auditoría. */
export type EstadoPerfilConexionCliente = 'ACTIVE' | 'DISABLED';

/** Endpoint MySQL persistido dentro del perfil, sin resolverlo a una IP. */
export interface EndpointConexionPersistido {
  /** Hostname DNS ASCII o literal IP configurado por ADMIN. */
  readonly hostname: string;
  /** Puerto TCP del servicio, limitado a 1–65535 por la aplicación y la BD. */
  readonly port: number;
}

/** Endpoint SSH persistido con fingerprint SHA-256 verificada explícitamente. */
export interface GatewaySshPersistido extends EndpointConexionPersistido {
  /** Fingerprint OpenSSH SHA-256 sin relleno base64. */
  readonly fingerprint: string;
}

/** Metadatos internos de un perfil; los endpoints solo pueden serializarse en rutas ADMIN. */
export interface PerfilConexionCliente {
  /** UUID inmutable del perfil. */
  readonly id: string;
  /** UUID del cliente propietario. */
  readonly clientId: string;
  /** Etiqueta administrativa sin credenciales ni endpoints de red. */
  readonly nombre: string;
  /** Familia de conexión limitada al conector implementado. */
  readonly tipo: TipoPerfilConexionCliente;
  /** Ambiente del sistema cliente. */
  readonly entorno: EntornoPerfilConexionCliente;
  /** Referencia interna de destino; permanece para compatibilidad con perfiles legacy. */
  readonly destinoMySqlId: string;
  /** Referencia interna de gateway legacy, solo para MYSQL_SSH. */
  readonly gatewaySshId: string | null;
  /** Endpoint persistido para uso server-side y presentación ADMIN; no exponer a SUPPORT. */
  readonly destinoMySql?: EndpointConexionPersistido | null;
  /** Gateway y fingerprint persistidos; no exponer a SUPPORT. */
  readonly gatewaySsh?: GatewaySshPersistido | null;
  /** Nombre de la base MySQL, sin hostname, usuario o contraseña. */
  readonly baseDatos: string;
  /** Estado lógico del perfil. */
  readonly estado: EstadoPerfilConexionCliente;
  /** Fecha UTC de alta. */
  readonly createdAt: Date;
  /** Fecha UTC de modificación. */
  readonly updatedAt: Date;
}

/** Metadatos y sobre interno recuperado solo para una operación de servidor. */
export interface PerfilConexionPersistido extends PerfilConexionCliente {
  /** Sobre cifrado de usuario, contraseña, llave, certificados y material SSH. */
  readonly sobre: SobreSecretoCifrado;
  /** Endpoint de red persistido; null indica un perfil legacy aún no migrado a autoservicio. */
  readonly destinoMySql: EndpointConexionPersistido | null;
  /** Gateway del perfil SSH; null indica conexión directa o un perfil SSH legacy. */
  readonly gatewaySsh: GatewaySshPersistido | null;
}

/** Datos validados para crear un perfil y persistirlo con su sobre cifrado. */
export interface AltaPerfilConexionPersistido {
  /** UUID generado en la capa de aplicación. */
  readonly id: string;
  /** UUID del cliente propietario. */
  readonly clientId: string;
  /** Nombre validado para la interfaz ADMIN. */
  readonly nombre: string;
  /** Tipo de conexión configurado. */
  readonly tipo: TipoPerfilConexionCliente;
  /** Ambiente del sistema cliente. */
  readonly entorno: EntornoPerfilConexionCliente;
  /** Referencia interna derivada del perfil; no representa aprobación por allowlist. */
  readonly destinoMySqlId: string;
  /** Endpoint nuevo por perfil; se omite solo mientras la capa de aplicación migra legacy. */
  readonly destinoMySql?: EndpointConexionPersistido | null;
  /** Referencia interna derivada del perfil cuando se usa SSH. */
  readonly gatewaySshId: string | null;
  /** Endpoint y fingerprint SSH; null para conexión directa o perfil legacy. */
  readonly gatewaySsh?: GatewaySshPersistido | null;
  /** Base MySQL acotada, validada por la capa de aplicación. */
  readonly baseDatos: string;
  /** Credenciales cifradas con AAD ligado al cliente y perfil. */
  readonly sobre: SobreSecretoCifrado;
  /** Instante UTC de creación. */
  readonly createdAt: Date;
}

/** Campos administrativos editables sin reemplazar secretos. */
export interface CambiosPerfilConexionPersistidos {
  /** Nombre alternativo validado. */
  readonly nombre?: string;
  /** Ambiente alternativo del sistema cliente. */
  readonly entorno?: EntornoPerfilConexionCliente;
  /** Referencia interna derivada del perfil; se conserva para filas legacy. */
  readonly destinoMySqlId?: string;
  /** Endpoint MySQL actualizado; null no se acepta para un perfil nuevo habilitado. */
  readonly destinoMySql?: EndpointConexionPersistido | null;
  /** Referencia interna de gateway o null al retirar SSH. */
  readonly gatewaySshId?: string | null;
  /** Gateway actualizado, o null al retirar SSH; sin endpoint queda como perfil legacy. */
  readonly gatewaySsh?: GatewaySshPersistido | null;
  /** Base MySQL alternativa. */
  readonly baseDatos?: string;
  /** Estado lógico actualizado. */
  readonly estado?: EstadoPerfilConexionCliente;
  /** Instante UTC de modificación. */
  readonly updatedAt: Date;
}

/** Resultado sin datos sensibles del alta de un perfil asociado al cliente. */
export type ResultadoAltaPerfilConexion =
  | { readonly kind: 'CREATED'; readonly perfil: PerfilConexionCliente }
  | { readonly kind: 'CLIENT_NOT_FOUND' }
  | { readonly kind: 'PROFILE_DUPLICATE' };

/** Repositorio que nunca expone sobres cifrados fuera de servicios server-side. */
export interface RepositorioPerfilesConexion {
  /** Lista perfiles redactados asociados al cliente indicado. */
  listar(clientId: string): Promise<readonly PerfilConexionCliente[]>;
  /** Inserta perfil y evento de auditoría dentro de la misma transacción. */
  crear(
    entrada: AltaPerfilConexionPersistido,
    actor: ActorAdministracionClientes,
  ): Promise<ResultadoAltaPerfilConexion>;
  /** Actualiza metadatos/estado y audita de forma atómica. */
  actualizar(
    clientId: string,
    profileId: string,
    cambios: CambiosPerfilConexionPersistidos,
    actor: ActorAdministracionClientes,
  ): Promise<PerfilConexionCliente | null>;
  /** Reemplaza el sobre de secretos sin devolverlo a API ni registrar valores. */
  reemplazarSobre(
    clientId: string,
    profileId: string,
    sobre: SobreSecretoCifrado,
    updatedAt: Date,
    actor: ActorAdministracionClientes,
  ): Promise<PerfilConexionCliente | null>;
  /** Recupera el sobre solo para el broker y solo si el perfil está activo. */
  obtenerParaPrueba(clientId: string, profileId: string): Promise<PerfilConexionPersistido | null>;
  /** Audita el resultado estable de una prueba sin material de conexión. */
  registrarPrueba(
    clientId: string,
    profileId: string,
    resultado: ResultadoPruebaConexion,
    actor: ActorAdministracionClientes,
  ): Promise<void>;
}
