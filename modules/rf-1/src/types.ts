/** Error de dominio RF-1 con un código estable y sin mensajes de drivers externos. */
export class ErrorRf1 extends Error {
  /** Crea un error público estable para parser o validación fiscal local. */
  public constructor(public readonly code: CodigoErrorRf1) {
    super(code);
    this.name = 'ErrorRf1';
  }
}

/** Códigos controlados de validación RF-1; no contienen SQL ni datos del catálogo. */
export type CodigoErrorRf1 =
  | 'XML_TOO_LARGE'
  | 'XML_DEPTH_LIMIT'
  | 'XML_NODE_LIMIT'
  | 'XML_DOCTYPE_FORBIDDEN'
  | 'XML_MALFORMED'
  | 'CFDI_ROOT_INVALID'
  | 'CFDI_VERSION_UNSUPPORTED'
  | 'CFDI_TYPE_UNSUPPORTED'
  | 'CFDI_REQUIRED_FIELD_INVALID'
  | 'CFDI_UUID_INVALID'
  | 'CFDI_REFERENCE_TOO_LONG'
  | 'CFDI_TAX_DATA_INVALID'
  | 'CFDI_TAX_SUMMARY_AMBIGUOUS'
  | 'CFDI_TAX_SUMMARY_MISSING'
  | 'CFDI_PAYMENT_METHOD_INVALID'
  | 'BATCH_EMPTY'
  | 'BATCH_TOO_MANY_FILES'
  | 'BATCH_TOO_LARGE'
  | 'CFDI_STATUS_UNSUPPORTED';

/** Datos inmutables extraídos de un CFDI de ingreso sin mutar ni guardar su origen. */
export interface DatosCfdiIngreso {
  /** UUID fiscal normalizado a mayúsculas, leído de TimbreFiscalDigital. */
  readonly uuid: string;
  /** RFC normalizado del emisor, usado solo para la resolución contextual. */
  readonly rfcEmisor: string;
  /** RFC normalizado del receptor, usado para localizar sociedades en la conexión elegida. */
  readonly rfcReceptor: string;
  /** Fecha fiscal literal del XML; no se convierte de zona horaria. */
  readonly fecha: string;
  /** Subtotal fiscal exacto expresado como texto decimal. */
  readonly subtotal: string;
  /** Descuento fiscal exacto; se representa como cero cuando no viene informado. */
  readonly descuento: string;
  /** Moneda declarada en el comprobante. */
  readonly moneda: string;
  /** Total decimal textual exacto; no se convierte a número binario. */
  readonly total: string;
  /** Serie y folio concatenados sin espacios agregados, o cadena vacía. */
  readonly referencia: string;
  /** Tipo de comprobante validado como ingreso. */
  readonly tipoComprobante: 'I';
  /** IVA trasladado agregado desde el resumen fiscal del comprobante. */
  readonly importeIvaFAC: string;
  /** ISR retenido agregado desde el resumen fiscal del comprobante. */
  readonly retencionIsr: string;
  /** IVA retenido agregado desde el resumen fiscal del comprobante. */
  readonly retencionIva: string;
  /** IEPS retenido agregado desde el resumen fiscal del comprobante. */
  readonly retencionIeps: string;
  /** Método de pago CFDI cuando el emisor lo informó. */
  readonly metodoPago?: string;
  /** Forma de pago CFDI cuando el emisor la informó. */
  readonly formaPago?: string;
  /** Serie original cuando el comprobante la incluye. */
  readonly serie?: string;
  /** Folio original cuando el comprobante lo incluye. */
  readonly folio?: string;
}
