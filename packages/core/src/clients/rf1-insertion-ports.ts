/** Campos fiscales permitidos para preparar una fila RF-1 desde un CFDI validado. */
export interface DatosFacturaFiscalRf1 {
  /** UUID normalizado leído del timbre fiscal. */
  readonly uuid: string;
  /** RFC normalizado del emisor. */
  readonly rfcEmisor: string;
  /** RFC normalizado del receptor. */
  readonly rfcReceptor: string;
  /** Fecha literal del comprobante sin desplazar por zona horaria. */
  readonly fecha: string;
  /** Subtotal decimal exacto como texto. */
  readonly subtotal: string;
  /** Descuento extraído como texto decimal exacto. */
  readonly descuento: string;
  /** Moneda declarada en el CFDI. */
  readonly moneda: string;
  /** Total decimal exacto como texto. */
  readonly total: string;
  /** Referencia calculada de serie y folio. */
  readonly referencia: string;
  /** Único tipo de comprobante habilitado por el MVP. */
  readonly tipoComprobante: 'I';
  /** IVA trasladado federal exacto. */
  readonly importeIvaFAC: string;
  /** Retención federal ISR exacta. */
  readonly retencionIsr: string;
  /** Retención federal IVA exacta. */
  readonly retencionIva: string;
  /** Retención federal IEPS exacta. */
  readonly retencionIeps: string;
  /** Método de pago CFDI opcional. */
  readonly metodoPago?: string;
  /** Forma de pago CFDI opcional. */
  readonly formaPago?: string;
  /** Serie original opcional. */
  readonly serie?: string;
  /** Folio original opcional. */
  readonly folio?: string;
}

/** Referencias operativas opcionales por factura; nunca contienen credenciales. */
export interface DocumentosFacturaRf1 {
  /** Número de documento contable de hasta diez caracteres. */
  readonly documentoContable?: string | null;
  /** Entrada de mercancía de hasta dos mil caracteres. */
  readonly entradaMercancia?: string | null;
  /** Orden de compra de hasta dos mil caracteres. */
  readonly ordenCompra?: string | null;
  /** Número de documento de pago de hasta diez caracteres. */
  readonly documentoPago?: string | null;
}

/** Resolución SAP validada para el proveedor, sociedad y ambiente seleccionados. */
export interface ResolucionFacturaRf1 {
  /** Sociedad elegida de las coincidencias del receptor en la conexión. */
  readonly sociedad: string;
  /** Ambiente SAP leído de la fila de sociedad. */
  readonly ambienteSap: string;
  /** Identificador del proveedor único dentro de ese contexto. */
  readonly idProveedor: string;
}

/** Datos completos que el ejecutor remapea y revalida dentro de su transacción. */
export interface EntradaMapeoFacturaRf1 {
  /** Datos fiscales extraídos del XML original. */
  readonly factura: DatosFacturaFiscalRf1;
  /** Resolución contextual que se comprobará otra vez antes del INSERT. */
  readonly resolution: ResolucionFacturaRf1;
  /** Estado aprobado para la inserción directa. */
  readonly estatus: 'CONTABILIZADO' | 'PAGADA';
  /** Hora capturada por el servidor y expresada en UTC. */
  readonly fechaCarga: Date;
  /** Referencias opcionales ingresadas por operación. */
  readonly documentos?: DocumentosFacturaRf1;
}

/** Resultado por factura sin mensajes de driver, SQL ni datos de conexión. */
export interface ResultadoInsercionFacturaRf1 {
  /** Estado verificable de la operación individual. */
  readonly status:
    'INSERTADA_VERIFICADA' | 'YA_EXISTE' | 'RECHAZADA' | 'ERROR_REVERTIDO' | 'INDETERMINADO';
  /** Código acotado de un rechazo de negocio o conexión. */
  readonly errorCode?:
    | 'RF1_CONTEXT_MISMATCH'
    | 'RF1_CATALOG_UNAVAILABLE'
    | 'RF1_SUPPLIER_NOT_FOUND'
    | 'RF1_SUPPLIER_AMBIGUOUS'
    | 'RF1_INSERT_MAPPING_INVALID'
    | 'RF1_INSERT_DECIMAL_SCALE_UNSUPPORTED'
    | 'RF1_SESSION_BUSY'
    | 'RF1_ACCESS_REVOKED'
    | 'RF1_PROFILE_CHANGED';
}

/** Decisión del guard server-side reconsultado antes de la sentencia INSERT. */
export type DecisionAutorizacionEscrituraRf1 = 'AUTORIZADA' | 'ACCESO_REVOCADO' | 'PERFIL_CAMBIADO';

/** Sesión de escritura de vida corta con un único contrato de inserción tipado. */
export interface SesionInsercionRf1 {
  /**
   * Inserta o clasifica una factura con transacción y verificación posterior.
   * @param entrada Datos fiscales y contexto SAP que el motor valida de nuevo.
   * @param autorizarEscrituraVigente Guard consultado tras las lecturas y justo antes del INSERT.
   * @returns Resultado de la factura sin mensaje de driver ni datos de conexión.
   * @effects Abre una transacción individual y la confirma o revierte antes de devolver.
   */
  insertar(
    entrada: EntradaMapeoFacturaRf1,
    autorizarEscrituraVigente?: () => Promise<DecisionAutorizacionEscrituraRf1>,
  ): Promise<ResultadoInsercionFacturaRf1>;
  /** Cierra conexión y revierte cualquier transacción que aún esté abierta. */
  cerrar(): Promise<void>;
}
