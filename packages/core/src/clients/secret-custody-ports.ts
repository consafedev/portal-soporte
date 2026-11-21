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

/** Broker server-side que prueba un perfil autorizado sin exponer secretos al navegador. */
export interface ClientConnectionBroker {
  /** Ejecuta exclusivamente la prueba de solo lectura `SELECT 1` y borra el paquete recibido. */
  probar(perfil: PerfilConexionPrueba, secretos: Uint8Array): Promise<ResultadoPruebaConexion>;
}

/** Provee copias de las llaves maestras activas e históricas sin persistirlas en PostgreSQL. */
export interface ProveedorClavesMaestras {
  /** Devuelve una copia de la llave activa para nuevos cifrados y reenvolturas. */
  obtenerActiva(): Promise<VersionClaveMaestra>;
  /** Recupera una copia de una versión histórica o rechaza con un error seguro. */
  obtener(id: string): Promise<VersionClaveMaestra>;
}
