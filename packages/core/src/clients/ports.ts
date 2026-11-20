/** Estados permitidos para clientes y ambientes SAP del Portal. */
export type EstadoRegistroCliente = 'ACTIVE' | 'DISABLED';

/** Cliente visible en el Portal, sin secretos ni datos de conexiones externas. */
export interface ClientePortal {
  /** UUID inmutable del cliente. */
  readonly id: string;
  /** Nombre visible normalizado para la administración. */
  readonly nombre: string;
  /** Estado lógico; desactivar conserva referencias y auditoría. */
  readonly estado: EstadoRegistroCliente;
  /** Fecha de creación UTC. */
  readonly createdAt: Date;
  /** Fecha de la última modificación UTC. */
  readonly updatedAt: Date;
}

/** Ambiente SAP de un cliente, independiente de producción o pruebas del Portal. */
export interface AmbienteSapCliente {
  /** UUID inmutable del ambiente asociado. */
  readonly id: string;
  /** UUID del cliente propietario. */
  readonly clientId: string;
  /** Código único dentro del cliente, sin significado de entorno del Portal. */
  readonly codigo: string;
  /** Etiqueta legible por ADMIN. */
  readonly nombre: string;
  /** Estado lógico del ambiente SAP. */
  readonly estado: EstadoRegistroCliente;
  /** Fecha de creación UTC. */
  readonly createdAt: Date;
  /** Fecha de la última modificación UTC. */
  readonly updatedAt: Date;
}

/** Identidad de la sesión ADMIN que originó una mutación auditada. */
export interface ActorAdministracionClientes {
  /** UUID de la cuenta autenticada, resuelta por el servidor. */
  readonly actorUserId: string;
  /** Identificador de solicitud generado por Fastify. */
  readonly requestId: string;
}

/** Datos persistibles de alta de cliente; la auditoría comparte la transacción. */
export interface AltaClientePersistida {
  /** UUID generado por la capa de aplicación. */
  readonly id: string;
  /** Nombre visible ya validado y recortado. */
  readonly nombre: string;
  /** Instante UTC recibido del reloj inyectado. */
  readonly createdAt: Date;
}

/** Cambios persistibles de cliente con la fecha UTC de actualización. */
export interface CambiosClientePersistidos {
  /** Nuevo nombre visible cuando cambia. */
  readonly nombre?: string;
  /** Nuevo estado lógico cuando cambia. */
  readonly estado?: EstadoRegistroCliente;
  /** Instante UTC aplicado en la misma transacción que la auditoría. */
  readonly updatedAt: Date;
}

/** Datos persistibles de alta de ambiente SAP. */
export interface AltaAmbienteSapPersistida {
  /** UUID generado por la capa de aplicación. */
  readonly id: string;
  /** Código normalizado dentro del cliente. */
  readonly codigo: string;
  /** Nombre visible ya validado y recortado. */
  readonly nombre: string;
  /** Instante UTC recibido del reloj inyectado. */
  readonly createdAt: Date;
}

/** Cambios persistibles de ambiente SAP y fecha de actualización. */
export interface CambiosAmbienteSapPersistidos {
  /** Nuevo código SAP cuando cambia. */
  readonly codigo?: string;
  /** Nuevo nombre visible cuando cambia. */
  readonly nombre?: string;
  /** Nuevo estado lógico cuando cambia. */
  readonly estado?: EstadoRegistroCliente;
  /** Instante UTC aplicado junto con la auditoría. */
  readonly updatedAt: Date;
}

/** Resultado tipado que distingue alta correcta de conflicto o cliente inexistente. */
export type ResultadoAltaAmbienteSap =
  | { readonly kind: 'CREATED'; readonly ambiente: AmbienteSapCliente }
  | { readonly kind: 'CLIENT_NOT_FOUND' }
  | { readonly kind: 'DUPLICATE' };

/** Resultado tipado para actualizar un ambiente sin filtrar errores de PostgreSQL. */
export type ResultadoActualizacionAmbienteSap =
  | { readonly kind: 'UPDATED'; readonly ambiente: AmbienteSapCliente }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'DUPLICATE' };

/** Persistencia de clientes y ambientes; cada mutación escribe su auditoría atómicamente. */
export interface RepositorioClientes {
  /** Lista los clientes en orden determinista, sin perfiles ni secretos. */
  listar(): Promise<readonly ClientePortal[]>;
  /** Persiste el cliente y su evento de auditoría dentro de la misma transacción. */
  crear(entrada: AltaClientePersistida, actor: ActorAdministracionClientes): Promise<ClientePortal>;
  /** Actualiza un cliente y audita en la misma transacción, o devuelve null si no existe. */
  actualizar(
    id: string,
    cambios: CambiosClientePersistidos,
    actor: ActorAdministracionClientes,
  ): Promise<ClientePortal | null>;
  /** Lista ambientes SAP solo del cliente indicado. */
  listarAmbientesSap(clientId: string): Promise<readonly AmbienteSapCliente[]>;
  /** Persiste ambiente y auditoría de forma atómica, detectando FK y código duplicado. */
  crearAmbienteSap(
    clientId: string,
    entrada: AltaAmbienteSapPersistida,
    actor: ActorAdministracionClientes,
  ): Promise<ResultadoAltaAmbienteSap>;
  /** Actualiza el ambiente perteneciente al cliente y registra la auditoría atómicamente. */
  actualizarAmbienteSap(
    clientId: string,
    ambienteId: string,
    cambios: CambiosAmbienteSapPersistidos,
    actor: ActorAdministracionClientes,
  ): Promise<ResultadoActualizacionAmbienteSap>;
}
