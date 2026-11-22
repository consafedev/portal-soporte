/** Proyección fiscal consumida por el conector, compatible con la salida del parser RF-1. */
export interface DatosFacturaFiscalRf1 {
  /** UUID normalizado leído del timbre fiscal. */
  readonly uuid: string;
  /** RFC normalizado del emisor. */
  readonly rfcEmisor: string;
  /** RFC normalizado del receptor. */
  readonly rfcReceptor: string;
  /** Fecha fiscal literal conservada desde el XML. */
  readonly fecha: string;
  /** Subtotal exacto como texto decimal. */
  readonly subtotal: string;
  /** Descuento exacto extraído por el parser, reservado para futuras reglas de mapeo. */
  readonly descuento: string;
  /** Moneda declarada en el CFDI. */
  readonly moneda: string;
  /** Total exacto como texto decimal. */
  readonly total: string;
  /** Referencia de serie y folio preparada por el parser. */
  readonly referencia: string;
  /** Tipo de comprobante admitido por el MVP. */
  readonly tipoComprobante: 'I';
  /** IVA trasladado federal exacto. */
  readonly importeIvaFAC: string;
  /** Retención ISR federal exacta. */
  readonly retencionIsr: string;
  /** Retención IVA federal exacta. */
  readonly retencionIva: string;
  /** Retención IEPS federal exacta. */
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

/** Campos opcionales ingresados por el operador para una factura individual. */
export interface DocumentosFacturaRf1 {
  /** Número de documento contable, de hasta diez caracteres. */
  readonly documentoContable?: string | null;
  /** Entrada de mercancía, de hasta dos mil caracteres. */
  readonly entradaMercancia?: string | null;
  /** Orden de compra, de hasta dos mil caracteres. */
  readonly ordenCompra?: string | null;
  /** Número de documento de pago, de hasta diez caracteres. */
  readonly documentoPago?: string | null;
}

/** Contexto SAP resuelto y confirmado en la misma conexión del cliente. */
export interface ResolucionFacturaRf1 {
  /** Sociedad válida para el RFC receptor seleccionado. */
  readonly sociedad: string;
  /** Ambiente SAP leído de la misma fila de sociedad. */
  readonly ambienteSap: string;
  /** Proveedor único del RFC emisor dentro de sociedad y ambiente SAP. */
  readonly idProveedor: string;
}

/** Entrada completa para mapear una vista previa autorizada a una fila de factura. */
export interface EntradaMapeoFacturaRf1 {
  /** Datos fiscales extraídos del XML CFDI 4.0 de ingreso. */
  readonly factura: DatosFacturaFiscalRf1;
  /** Resolución SAP que debe revalidarse antes de insertar. */
  readonly resolution: ResolucionFacturaRf1;
  /** Estado permitido por la decisión funcional del propietario. */
  readonly estatus: 'CONTABILIZADO' | 'PAGADA';
  /** Instante capturado por el servidor y expresado en UTC. */
  readonly fechaCarga: Date;
  /** Referencias opcionales capturadas por el operador. */
  readonly documentos?: DocumentosFacturaRf1;
}

/** Fila cerrada con nombres de columna aprobados para el destino MySQL sintético. */
export interface FilaFacturaRf1 {
  /** UUID fiscal que identifica la factura dentro de la base seleccionada. */
  readonly uuid: string;
  /** Número de documento contable opcional. */
  readonly nodocumentocontable: string | null;
  /** Año tomado de la fecha fiscal, sin conversión de zona horaria. */
  readonly ejercicio: string;
  /** RFC del receptor CFDI. */
  readonly rfcReceptor: string;
  /** RFC del emisor CFDI. */
  readonly rfcEmisor: string;
  /** Folio original opcional. */
  readonly folio: string | null;
  /** Serie original opcional. */
  readonly serie: string | null;
  /** Fecha fiscal literal reducida a AAAA-MM-DD. */
  readonly fecha: string;
  /** Moneda CFDI declarada. */
  readonly monedaFAC: string;
  /** Total fiscal exacto en representación decimal textual. */
  readonly totalFAC: string;
  /** Subtotal fiscal exacto en representación decimal textual. */
  readonly subtotalFAC: string;
  /** IVA trasladado federal exacto en representación decimal textual. */
  readonly importeIvaFAC: string;
  /** Marcador fijo de origen XML. */
  readonly rutaXml: 'AgregadoAutomatizado';
  /** No se carga PDF en esta entrega. */
  readonly rutaPdf: null;
  /** Estado permitido para inserción directa. */
  readonly estatus: 'CONTABILIZADO' | 'PAGADA';
  /** Versión CFDI admitida por el parser. */
  readonly version: '4.0';
  /** Fecha de carga como datetime UTC sin zona en MySQL. */
  readonly fechaCarga: string;
  /** Entrada de mercancía opcional. */
  readonly nea: string | null;
  /** Tipo de comprobante de ingreso. */
  readonly tipoComprobante: 'I';
  /** Método de pago CFDI opcional. */
  readonly metododepago: string | null;
  /** Forma de pago CFDI opcional. */
  readonly formadepago: string | null;
  /** Número de cuenta de pago no informado por RF-1. */
  readonly numctapago: null;
  /** Referencia formada con serie y folio sin espacios añadidos. */
  readonly referencia: string;
  /** Número de documento de pago opcional. */
  readonly nodocumentopago: string | null;
  /** Orden de compra opcional. */
  readonly noa: string | null;
  /** Identificador del proveedor resuelto en el contexto SAP exacto. */
  readonly creadoPor: string;
  /** No se carga documento logístico en esta entrega. */
  readonly nodocumentologistico: null;
  /** Sociedad SAP resuelta y revalidada. */
  readonly sociedad: string;
  /** Retención ISR federal exacta. */
  readonly retencionIsr: string;
  /** Retención IVA federal exacta. */
  readonly retencionIva: string;
  /** Retención IEPS federal exacta. */
  readonly retencionIeps: string;
  /** Módulo de origen fijo aprobado. */
  readonly moduloOrigen: 'REF';
  /** No se calcula detracción en el MVP. */
  readonly detraccion_pe: null;
}

/** Error de mapeo con código estable que no incluye XML ni valores suministrados. */
export class ErrorMapeoFacturaRf1 extends Error {
  /** Crea un error cerrado para rechazar valores sin truncarlos ni redondearlos. */
  public constructor(
    public readonly code: 'INPUT_INVALID' | 'FIELD_TOO_LONG' | 'DECIMAL_SCALE_UNSUPPORTED',
  ) {
    super(code);
    this.name = 'ErrorMapeoFacturaRf1';
  }
}

/** Mapea un CFDI validado a columnas permitidas sin conversión binaria ni datos inventados. */
export function mapearFacturaParaInsercionRf1(entrada: EntradaMapeoFacturaRf1): FilaFacturaRf1 {
  const { factura, resolution } = entrada;
  if (
    (entrada.estatus !== 'CONTABILIZADO' && entrada.estatus !== 'PAGADA') ||
    !Number.isFinite(entrada.fechaCarga.getTime()) ||
    !/^[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}$/u.test(factura.uuid) ||
    !fechaFiscalValida(factura.fecha) ||
    factura.tipoComprobante !== 'I' ||
    typeof resolution !== 'object' ||
    resolution === null
  ) {
    throw new ErrorMapeoFacturaRf1('INPUT_INVALID');
  }

  const fila: FilaFacturaRf1 = {
    uuid: limitarTexto(factura.uuid, 40),
    nodocumentocontable: textoOpcional(entrada.documentos?.documentoContable, 10),
    ejercicio: factura.fecha.slice(0, 4),
    rfcReceptor: limitarTexto(factura.rfcReceptor, 15),
    rfcEmisor: limitarTexto(factura.rfcEmisor, 15),
    folio: textoOpcional(factura.folio, 100),
    serie: textoOpcional(factura.serie, 25),
    fecha: factura.fecha.slice(0, 10),
    monedaFAC: limitarTexto(factura.moneda, 5),
    totalFAC: validarDecimal(factura.total, 10),
    subtotalFAC: validarDecimal(factura.subtotal, 10),
    importeIvaFAC: validarDecimal(factura.importeIvaFAC, 10),
    rutaXml: 'AgregadoAutomatizado',
    rutaPdf: null,
    estatus: entrada.estatus,
    version: '4.0',
    fechaCarga: entrada.fechaCarga.toISOString().slice(0, 19).replace('T', ' '),
    nea: textoOpcional(entrada.documentos?.entradaMercancia, 2000),
    tipoComprobante: 'I',
    metododepago: textoOpcional(factura.metodoPago, 100),
    formadepago: textoOpcional(factura.formaPago, 100),
    numctapago: null,
    referencia: limitarLongitud(factura.referencia, 100),
    nodocumentopago: textoOpcional(entrada.documentos?.documentoPago, 10),
    noa: textoOpcional(entrada.documentos?.ordenCompra, 2000),
    creadoPor: limitarTexto(resolution.idProveedor, 10),
    nodocumentologistico: null,
    sociedad: limitarTexto(resolution.sociedad, 8),
    retencionIsr: validarDecimal(factura.retencionIsr, 6),
    retencionIva: validarDecimal(factura.retencionIva, 6),
    retencionIeps: validarDecimal(factura.retencionIeps, 6),
    moduloOrigen: 'REF',
    detraccion_pe: null,
  };
  limitarTexto(resolution.ambienteSap, 3);
  return fila;
}

/** Valida longitud sin recortar ni cambiar texto recibido. */
function limitarTexto(valor: string, maximo: number): string {
  if (valor.length === 0) {
    throw new ErrorMapeoFacturaRf1('INPUT_INVALID');
  }
  if (valor.length > maximo) {
    throw new ErrorMapeoFacturaRf1('FIELD_TOO_LONG');
  }
  return valor;
}

/** Valida el máximo de caracteres y conserva referencias vacías admitidas por CFDI. */
function limitarLongitud(valor: string, maximo: number): string {
  if (valor.length > maximo) {
    throw new ErrorMapeoFacturaRf1('FIELD_TOO_LONG');
  }
  return valor;
}

/** Convierte ausencia opcional a NULL y rechaza valores fuera del límite del contrato. */
function textoOpcional(valor: string | null | undefined, maximo: number): string | null {
  if (valor === undefined || valor === null) {
    return null;
  }
  if (valor.length > maximo) {
    throw new ErrorMapeoFacturaRf1('FIELD_TOO_LONG');
  }
  return valor;
}

/** Valida precisión DECIMAL(…,2) con texto exacto; no redondea importes fiscales. */
function validarDecimal(valor: string, digitosEnteros: number): string {
  const coincidencia = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/u.exec(valor);
  if (coincidencia === null || (coincidencia[1]?.length ?? 0) > digitosEnteros) {
    if (/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(valor)) {
      throw new ErrorMapeoFacturaRf1('DECIMAL_SCALE_UNSUPPORTED');
    }
    throw new ErrorMapeoFacturaRf1('INPUT_INVALID');
  }
  return valor;
}

/** Valida el calendario fiscal literal sin desplazarlo por su zona horaria. */
function fechaFiscalValida(valor: string): boolean {
  const fecha = valor.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(fecha) || !/^\d{4}-\d{2}-\d{2}T/u.test(valor)) {
    return false;
  }
  const instante = new Date(`${fecha}T00:00:00.000Z`);
  return Number.isFinite(instante.getTime()) && instante.toISOString().slice(0, 10) === fecha;
}
