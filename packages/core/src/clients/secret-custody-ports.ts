import type { SesionInsercionRf1 } from './rf1-insertion-ports.js';
export type { SesionInsercionRf1 } from './rf1-insertion-ports.js';

/** Versión recuperable de una clave maestra entregada al servicio de custodia. */
export interface VersionClaveMaestra {
  /** Identificador público de rotación; no contiene material secreto. */
  readonly id: string;
  /** Copia mutable de exactamente 32 bytes que el consumidor debe borrar al terminar. */
  readonly material: Uint8Array;
}

/** Contexto no secreto autenticado dentro de cada paquete cifrado de credenciales. */
export interface ContextoSobreSecreto {
  /** UUID del cliente propietario del perfil. */
  readonly clientId: string;
  /** UUID del perfil al que pertenece el paquete cifrado. */
  readonly profileId: string;
  /** Categoría estable del material protegido. */
  readonly purpose: 'MYSQL_CREDENTIALS' | 'SSH_CREDENTIALS' | 'TLS_CREDENTIALS';
}

/** Forma versionada persistible del envelope; no contiene material en claro. */
export interface SobreSecretoCifrado {
  /** Versión estructural para evolución compatible del envelope. */
  readonly version: 1;
  /** Algoritmo autenticado del paquete y su llave de datos. */
  readonly algoritmo: 'AES-256-GCM';
  /** Identificador no secreto de la llave maestra que envuelve la DEK. */
  readonly idClave: string;
  /** Nonce de 96 bits del envoltorio de la llave de datos. */
  readonly nonceClave: string;
  /** Llave de datos cifrada bajo la KEK versionada. */
  readonly claveDatosEnvuelta: string;
  /** Etiqueta GCM de 128 bits del envoltorio. */
  readonly tagClave: string;
  /** Nonce de 96 bits del cifrado del paquete. */
  readonly nonceDato: string;
  /** Credenciales cifradas y codificadas en base64. */
  readonly datoCifrado: string;
  /** Etiqueta GCM de 128 bits del paquete. */
  readonly tagDato: string;
}

/** Tipo de perfil MySQL y ruta de red elegidos en el catálogo, no por el navegador. */
export type TipoPerfilConexionMySql = 'MYSQL_TCP' | 'MYSQL_SSH';

/** Datos no secretos de un perfil autorizable por el broker de conexiones. */
export interface PerfilConexionPrueba {
  /** UUID estable del perfil guardado por el Portal. */
  readonly id: string;
  /** UUID del cliente propietario del perfil. */
  readonly clientId: string;
  /** Ruta de red admitida por la configuración operacional. */
  readonly tipo: TipoPerfilConexionMySql;
  /** Identificador de destino MySQL de la allowlist externa. */
  readonly destinoMySqlId: string;
  /** Identificador del gateway SSH aprobado cuando el perfil usa túnel. */
  readonly gatewaySshId?: string;
  /** Nombre de la base seleccionada por ADMIN, validado y limitado. */
  readonly baseDatos: string;
}

/** Host MySQL fijado por la lista confiable, no suministrado por el usuario de API. */
export interface DestinoMySqlAutorizado {
  /** Identificador estable de configuración. */
  readonly id: string;
  /** Hostname conservado para validación de identidad TLS. */
  readonly hostname: string;
  /** Dirección IP fijada para evitar resolución arbitraria al conectar. */
  readonly address: string;
  /** Puerto MySQL autorizado. */
  readonly port: number;
}

/** Gateway SSH fijado por la allowlist con fingerprint de host obligatorio. */
export interface DestinoGatewaySsh {
  /** Identificador estable de configuración. */
  readonly id: string;
  /** Hostname esperado del gateway. */
  readonly hostname: string;
  /** Dirección IP fijada para evitar redirección DNS al conectar. */
  readonly address: string;
  /** Puerto SSH autorizado. */
  readonly port: number;
  /** Fingerprint SHA-256 esperado en formato OpenSSH. */
  readonly fingerprint: string;
}

/** Categoría estable de resultado de una prueba no mutante de conectividad. */
export type CodigoResultadoPruebaConexion =
  | 'CONNECTED'
  | 'CONNECTOR_BUSY'
  | 'PROFILE_INVALID'
  | 'DESTINATION_NOT_ALLOWED'
  | 'INVALID_CREDENTIALS'
  | 'SSH_KEY_FORMAT_UNSUPPORTED'
  | 'SSH_KEY_INVALID'
  | 'SSH_HOST_KEY_REJECTED'
  | 'SSH_CONNECTION_FAILED'
  | 'MYSQL_TLS_FAILED'
  | 'MYSQL_AUTHENTICATION_FAILED'
  | 'MYSQL_CONNECTION_FAILED'
  | 'SECRET_CUSTODY_DISABLED'
  | 'SECRET_CUSTODY_UNAVAILABLE'
  | 'SECRET_PACKAGE_INVALID'
  | 'CONNECTION_TIMEOUT';

/** Resultado sin hosts, usuarios, mensajes del driver ni valores secretos. */
export interface ResultadoPruebaConexion {
  /** Código estable que permite mostrar un estado comprensible sin filtrar datos. */
  readonly code: CodigoResultadoPruebaConexion;
  /** Fecha UTC de resultado fijada por la capa de aplicación. */
  readonly completedAt: Date;
}

/** Sociedad y ambiente SAP de un resultado de lectura limitado de RF-1. */
export interface SociedadLecturaRf1 {
  /** Código de sociedad obtenido desde el catálogo aprobado. */
  readonly sociedad: string;
  /** Ambiente SAP vinculado a la sociedad, no al perfil de conexión. */
  readonly ambienteSap: string;
}

/** Sesión MySQL de vida corta con operaciones semánticas fijas de solo lectura. */
export interface SesionLecturaRf1 {
  /**
   * Busca hasta cien sociedades por RFC receptor y falla ante resultados excesivos.
   * @param rfcReceptor RFC receptor que debe validarse y normalizarse.
   * @returns Sociedades acotadas.
   */
  buscarSociedadesPorRfc(rfcReceptor: string): Promise<readonly SociedadLecturaRf1[]>;
  /**
   * Busca como máximo dos proveedores por RFC, sociedad y ambiente SAP.
   * @param rfcEmisor RFC emisor.
   * @param sociedad Código SAP.
   * @param ambienteSap Ambiente SAP.
   * @returns Cero, uno o dos resultados para detectar ambigüedad.
   */
  buscarProveedoresPorContexto(
    rfcEmisor: string,
    sociedad: string,
    ambienteSap: string,
  ): Promise<readonly { readonly idProveedor: string }[]>;
  /**
   * Comprueba si ya existe un UUID en factura sin devolver el registro.
   * @param uuid UUID fiscal que debe validarse.
   * @returns Si existe al menos una coincidencia.
   */
  existeUuid(uuid: string): Promise<boolean>;
  /**
   * Cierra la conexión y libera el límite de concurrencia del broker.
   * @returns Promesa de cierre seguro, idempotente.
   */
  cerrar(): Promise<void>;
}

/** Broker server-side que prueba un perfil autorizado sin exponer secretos al navegador. */
export interface ClientConnectionBroker {
  /**
   * Ejecuta exclusivamente la prueba de solo lectura `SELECT 1` y borra el paquete recibido.
   * @param perfil Perfil allowlisted.
   * @param secretos Buffer mutable de credenciales que se borra.
   * @returns Resultado sanitizado de conectividad.
   */
  probar(perfil: PerfilConexionPrueba, secretos: Uint8Array): Promise<ResultadoPruebaConexion>;
  /**
   * Abre una sesión RF-1 con lecturas tipadas, cancelación y sin exponer SQL arbitrario.
   * @param perfil Perfil allowlisted.
   * @param secretos Buffer mutable de credenciales que se borra.
   * @param senal Cancelación de la solicitud autorizada.
   * @returns Sesión limitada que el llamador debe cerrar en `finally`.
   */
  abrirLecturaRf1(
    perfil: PerfilConexionPrueba,
    secretos: Uint8Array,
    senal: AbortSignal,
  ): Promise<SesionLecturaRf1>;
  /**
   * Abre una sesión MySQL transaccional RF-1 acotada al inserto aprobado.
   * @param perfil Perfil activo que ya fue autorizado por el servicio de aplicación.
   * @param secretos Buffer mutable de credenciales cifradas descifradas; el broker lo borra.
   * @param senal Cancelación de la solicitud autenticada.
   * @returns Sesión limitada que el llamador debe cerrar en `finally`.
   */
  abrirInsercionRf1(
    perfil: PerfilConexionPrueba,
    secretos: Uint8Array,
    senal: AbortSignal,
  ): Promise<SesionInsercionRf1>;
}

/** Provee copias de las llaves maestras activas e históricas sin persistirlas en PostgreSQL. */
export interface ProveedorClavesMaestras {
  /** Devuelve una copia de la llave activa para nuevos cifrados y reenvolturas. */
  obtenerActiva(): Promise<VersionClaveMaestra>;
  /** Recupera una copia de una versión histórica o rechaza con un error seguro. */
  obtener(id: string): Promise<VersionClaveMaestra>;
}
