import { SaxesParser, type SaxesTagNS } from 'saxes';
import { ErrorRf1, type DatosCfdiIngreso } from './types.js';

/** Límites defensivos para cada archivo individual en el primer incremento de preview. */
export interface OpcionesParserCfdi {
  /** Máximo de bytes UTF-8 aceptados antes de instanciar el parser. */
  readonly tamanoMaximoBytes?: number;
  /** Máxima profundidad estructural permitida para evitar documentos patológicos. */
  readonly profundidadMaxima?: number;
  /** Máximo de nodos XML que se procesan por documento. */
  readonly nodosMaximos?: number;
}

interface DatosComprobanteParciales {
  /** Versión declarada en el nodo raíz de CFDI. */
  readonly version?: string;
  /** Tipo de comprobante declarado en el nodo raíz. */
  readonly tipo?: string;
  /** Fecha fiscal literal declarada en el nodo raíz. */
  readonly fecha?: string;
  /** Moneda fiscal declarada en el nodo raíz. */
  readonly moneda?: string;
  /** Subtotal declarado en el comprobante. */
  readonly subtotal?: string;
  /** Descuento declarado en el comprobante. */
  readonly descuento?: string;
  /** Total decimal textual declarado en el nodo raíz. */
  readonly total?: string;
  /** Serie opcional declarada en el nodo raíz. */
  readonly serie?: string;
  /** Folio opcional declarado en el nodo raíz. */
  readonly folio?: string;
  /** Método de pago declarado en el comprobante. */
  readonly metodoPago?: string;
  /** Forma de pago declarada en el comprobante. */
  readonly formaPago?: string;
}

interface AcumuladoImpuestosFederales {
  /** Importes de traslados federales de IVA del resumen del comprobante. */
  readonly ivaTrasladado: string[];
  /** Importes de retenciones federales de ISR del resumen del comprobante. */
  readonly isrRetenido: string[];
  /** Importes de retenciones federales de IVA del resumen del comprobante. */
  readonly ivaRetenido: string[];
  /** Importes de retenciones federales de IEPS del resumen del comprobante. */
  readonly iepsRetenido: string[];
}

/** Analiza CFDI 4.0 tipo I de forma namespace-aware y rechaza DTD sin guardar el XML. */
export function analizarCfdiIngreso(
  contenido: Uint8Array,
  opciones: OpcionesParserCfdi = {},
): DatosCfdiIngreso {
  const limiteBytes = opciones.tamanoMaximoBytes ?? 5 * 1024 * 1024;
  const limiteProfundidad = opciones.profundidadMaxima ?? 64;
  const limiteNodos = opciones.nodosMaximos ?? 100_000;
  if (contenido.byteLength === 0) {
    throw new ErrorRf1('XML_MALFORMED');
  }
  if (contenido.byteLength > limiteBytes) {
    throw new ErrorRf1('XML_TOO_LARGE');
  }

  const texto = decodificarXml(contenido);
  let profundidad = 0;
  let nodos = 0;
  let comprobante: DatosComprobanteParciales | null = null;
  let emisor: string | null = null;
  let receptor: string | null = null;
  let emisorVisto = false;
  let receptorVisto = false;
  let uuid: string | null = null;
  let resumenImpuestosActivo = false;
  let resumenImpuestosVisto = false;
  let impuestoDeConceptoVisto = false;
  let seccionImpuestosActiva: 'traslados' | 'retenciones' | null = null;
  const impuestos: AcumuladoImpuestosFederales = {
    ivaTrasladado: [],
    isrRetenido: [],
    ivaRetenido: [],
    iepsRetenido: [],
  };
  const parser = new SaxesParser({ xmlns: true, position: false });

  parser.on('doctype', rechazarDoctype);
  parser.on('error', rechazarXmlMalformado);
  /** Valida límites estructurales y extrae solo atributos de los nodos fiscales permitidos. */
  parser.on('opentag', function procesarEtiqueta(tag): void {
    profundidad += 1;
    nodos += 1;
    if (profundidad > limiteProfundidad) {
      throw new ErrorRf1('XML_DEPTH_LIMIT');
    }
    if (nodos > limiteNodos) {
      throw new ErrorRf1('XML_NODE_LIMIT');
    }
    if (profundidad === 1) {
      if (tag.local !== 'Comprobante' || tag.uri !== NAMESPACE_CFDI_40) {
        throw new ErrorRf1('CFDI_ROOT_INVALID');
      }
      comprobante = leerComprobante(tag);
      return;
    }
    if (profundidad === 2 && tag.uri === NAMESPACE_CFDI_40 && tag.local === 'Impuestos') {
      if (resumenImpuestosVisto) {
        throw new ErrorRf1('CFDI_TAX_SUMMARY_AMBIGUOUS');
      }
      resumenImpuestosVisto = true;
      resumenImpuestosActivo = true;
      return;
    }
    if (resumenImpuestosActivo && profundidad === 3 && tag.uri === NAMESPACE_CFDI_40) {
      if (tag.local === 'Traslados' || tag.local === 'Retenciones') {
        const seccion = tag.local === 'Traslados' ? 'traslados' : 'retenciones';
        if (seccionImpuestosActiva !== null) {
          throw new ErrorRf1('CFDI_TAX_DATA_INVALID');
        }
        seccionImpuestosActiva = seccion;
      }
      return;
    }
    if (resumenImpuestosActivo && profundidad === 4 && tag.uri === NAMESPACE_CFDI_40) {
      if (seccionImpuestosActiva === 'traslados' && tag.local === 'Traslado') {
        acumularTrasladoFederal(tag, impuestos);
      } else if (seccionImpuestosActiva === 'retenciones' && tag.local === 'Retencion') {
        acumularRetencionFederal(tag, impuestos);
      }
      return;
    }
    if (
      !resumenImpuestosActivo &&
      tag.uri === NAMESPACE_CFDI_40 &&
      (tag.local === 'Traslado' || tag.local === 'Retencion')
    ) {
      impuestoDeConceptoVisto = true;
    }
    if (tag.uri === NAMESPACE_CFDI_40 && tag.local === 'Emisor') {
      if (emisorVisto || profundidad !== 2) {
        throw new ErrorRf1('CFDI_REQUIRED_FIELD_INVALID');
      }
      emisorVisto = true;
      emisor = leerAtributoSinNamespace(tag, 'Rfc') ?? null;
    }
    if (tag.uri === NAMESPACE_CFDI_40 && tag.local === 'Receptor') {
      if (receptorVisto || profundidad !== 2) {
        throw new ErrorRf1('CFDI_REQUIRED_FIELD_INVALID');
      }
      receptorVisto = true;
      receptor = leerAtributoSinNamespace(tag, 'Rfc') ?? null;
    }
    if (tag.uri === NAMESPACE_TIMBRE && tag.local === 'TimbreFiscalDigital') {
      if (uuid !== null) {
        throw new ErrorRf1('CFDI_UUID_INVALID');
      }
      uuid = leerAtributoSinNamespace(tag, 'UUID') ?? null;
    }
  });
  /** Mantiene la profundidad actual al cerrar cada elemento XML. */
  parser.on('closetag', function cerrarEtiqueta(): void {
    if (profundidad === 3) {
      seccionImpuestosActiva = null;
    }
    if (profundidad === 2 && resumenImpuestosActivo) {
      resumenImpuestosActivo = false;
      seccionImpuestosActiva = null;
    }
    profundidad -= 1;
  });

  try {
    parser.write(texto).close();
  } catch (error) {
    if (error instanceof ErrorRf1) {
      throw error;
    }
    throw new ErrorRf1('XML_MALFORMED');
  }

  if (comprobante === null || emisor === null || receptor === null || uuid === null) {
    throw new ErrorRf1('CFDI_REQUIRED_FIELD_INVALID');
  }
  if (!resumenImpuestosVisto && impuestoDeConceptoVisto) {
    throw new ErrorRf1('CFDI_TAX_SUMMARY_MISSING');
  }
  return validarDatosExtraidos(comprobante, emisor, receptor, uuid, impuestos);
}

/** Decodifica UTF-8 estricto sin editar ni reescribir los bytes recibidos. */
function decodificarXml(contenido: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(contenido);
  } catch {
    throw new ErrorRf1('XML_MALFORMED');
  }
}

/** Rechaza DTD de forma inmediata; el parser nunca carga entidades externas. */
function rechazarDoctype(): never {
  throw new ErrorRf1('XML_DOCTYPE_FORBIDDEN');
}

/** Sustituye mensajes variables del parser por un error estable sin datos del documento. */
function rechazarXmlMalformado(): never {
  throw new ErrorRf1('XML_MALFORMED');
}

/** Extrae atributos mínimos de Comprobante y exige los nombres XML exactos. */
function leerComprobante(tag: SaxesTagNS): DatosComprobanteParciales {
  return {
    version: leerAtributoSinNamespace(tag, 'Version'),
    tipo: leerAtributoSinNamespace(tag, 'TipoDeComprobante'),
    fecha: leerAtributoSinNamespace(tag, 'Fecha'),
    moneda: leerAtributoSinNamespace(tag, 'Moneda'),
    total: leerAtributoSinNamespace(tag, 'Total'),
    subtotal: leerAtributoSinNamespace(tag, 'SubTotal'),
    descuento: leerAtributoSinNamespace(tag, 'Descuento'),
    serie: leerAtributoSinNamespace(tag, 'Serie'),
    folio: leerAtributoSinNamespace(tag, 'Folio'),
    metodoPago: leerAtributoSinNamespace(tag, 'MetodoPago'),
    formaPago: leerAtributoSinNamespace(tag, 'FormaPago'),
  };
}

/** Acumula solo IVA trasladado declarado en el resumen fiscal del comprobante.
 * @param tag - Nodo de traslado del namespace CFDI.
 * @param impuestos - Acumuladores exactos del resumen fiscal.
 * @returns Nada; agrega el importe cuando el impuesto es IVA.
 * @throws `ErrorRf1` si el código, factor o importe no cumple el formato admitido.
 */
function acumularTrasladoFederal(tag: SaxesTagNS, impuestos: AcumuladoImpuestosFederales): void {
  const codigo = leerAtributoSinNamespace(tag, 'Impuesto');
  const tipoFactor = leerAtributoSinNamespace(tag, 'TipoFactor');
  if (
    codigo === undefined ||
    !/^(001|002|003)$/u.test(codigo) ||
    tipoFactor === undefined ||
    !/^(Tasa|Cuota|Exento)$/u.test(tipoFactor)
  ) {
    throw new ErrorRf1('CFDI_TAX_DATA_INVALID');
  }
  if (tipoFactor === 'Exento') {
    return;
  }
  const importe = validarImporteFiscal(leerAtributoSinNamespace(tag, 'Importe'));
  if (codigo === '002') {
    impuestos.ivaTrasladado.push(importe);
  }
}

/** Acumula las retenciones federales mapeadas sin incluir impuestos locales.
 * @param tag - Nodo de retención del namespace CFDI.
 * @param impuestos - Acumuladores exactos del resumen fiscal.
 * @returns Nada; agrega el importe en la categoría correspondiente.
 * @throws `ErrorRf1` si el código o importe no cumple el formato admitido.
 */
function acumularRetencionFederal(tag: SaxesTagNS, impuestos: AcumuladoImpuestosFederales): void {
  const codigo = leerAtributoSinNamespace(tag, 'Impuesto');
  if (codigo === undefined || !/^(001|002|003)$/u.test(codigo)) {
    throw new ErrorRf1('CFDI_TAX_DATA_INVALID');
  }
  const importe = validarImporteFiscal(leerAtributoSinNamespace(tag, 'Importe'));
  if (codigo === '001') {
    impuestos.isrRetenido.push(importe);
  } else if (codigo === '002') {
    impuestos.ivaRetenido.push(importe);
  } else {
    impuestos.iepsRetenido.push(importe);
  }
}

/** Valida un importe fiscal textual sin convertirlo a punto flotante.
 * @param valor - Importe textual opcional leído de un atributo XML.
 * @returns El texto original cuando cumple la gramática y el rango básico.
 * @throws `ErrorRf1` cuando falta el importe o contiene un valor no admitido.
 */
function validarImporteFiscal(valor: string | undefined): string {
  if (valor === undefined || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/u.test(valor)) {
    throw new ErrorRf1('CFDI_TAX_DATA_INVALID');
  }
  return valor;
}

/** Lee solo atributos no cualificados para evitar aceptar sustituciones con otro namespace. */
function leerAtributoSinNamespace(tag: SaxesTagNS, nombre: string): string | undefined {
  const atributo = Object.values(tag.attributes).find(
    (candidato) => candidato.local === nombre && candidato.uri === '',
  );
  return atributo?.value;
}

/** Valida los valores extraídos y conserva texto decimal y fecha fiscal sin conversiones. */
function validarDatosExtraidos(
  comprobante: DatosComprobanteParciales,
  emisor: string,
  receptor: string,
  uuid: string,
  impuestos: AcumuladoImpuestosFederales,
): DatosCfdiIngreso {
  if (comprobante.version !== '4.0') {
    throw new ErrorRf1('CFDI_VERSION_UNSUPPORTED');
  }
  if (comprobante.tipo !== 'I') {
    throw new ErrorRf1('CFDI_TYPE_UNSUPPORTED');
  }
  const rfcEmisor = normalizarRfc(emisor);
  const rfcReceptor = normalizarRfc(receptor);
  const fecha = comprobante.fecha;
  const moneda = comprobante.moneda;
  const total = comprobante.total;
  const subtotal = comprobante.subtotal;
  const descuento = comprobante.descuento ?? '0';
  if (
    rfcEmisor === null ||
    rfcReceptor === null ||
    fecha === undefined ||
    !fechaValida(fecha) ||
    moneda === undefined ||
    !/^[A-Z]{3}$/u.test(moneda) ||
    total === undefined ||
    subtotal === undefined ||
    !montoFiscalValido(total) ||
    !montoFiscalValido(subtotal) ||
    !montoFiscalValido(descuento)
  ) {
    throw new ErrorRf1('CFDI_REQUIRED_FIELD_INVALID');
  }
  if (
    (comprobante.metodoPago !== undefined && !/^(PUE|PPD)$/u.test(comprobante.metodoPago)) ||
    (comprobante.formaPago !== undefined && !/^\d{2}$/u.test(comprobante.formaPago))
  ) {
    throw new ErrorRf1('CFDI_PAYMENT_METHOD_INVALID');
  }
  const uuidNormalizado = uuid.trim().toUpperCase();
  if (!UUID_VALIDO.test(uuidNormalizado)) {
    throw new ErrorRf1('CFDI_UUID_INVALID');
  }
  const referencia = (comprobante.serie ?? '') + (comprobante.folio ?? '');
  if (referencia.length > 100) {
    throw new ErrorRf1('CFDI_REFERENCE_TOO_LONG');
  }
  return {
    uuid: uuidNormalizado,
    rfcEmisor,
    rfcReceptor,
    fecha,
    subtotal,
    descuento,
    moneda,
    total,
    referencia,
    tipoComprobante: 'I',
    importeIvaFAC: sumarImportesExactos(impuestos.ivaTrasladado),
    retencionIsr: sumarImportesExactos(impuestos.isrRetenido),
    retencionIva: sumarImportesExactos(impuestos.ivaRetenido),
    retencionIeps: sumarImportesExactos(impuestos.iepsRetenido),
    ...(comprobante.metodoPago === undefined ? {} : { metodoPago: comprobante.metodoPago }),
    ...(comprobante.formaPago === undefined ? {} : { formaPago: comprobante.formaPago }),
    ...(comprobante.serie === undefined ? {} : { serie: comprobante.serie }),
    ...(comprobante.folio === undefined ? {} : { folio: comprobante.folio }),
  };
}

/** Comprueba el rango textual decimal sin imponer redondeo binario ni perder escala.
 * @param valor - Número decimal textual extraído del CFDI.
 * @returns `true` si tiene hasta diez enteros y seis decimales.
 */
function montoFiscalValido(valor: string): boolean {
  return /^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/u.test(valor);
}

/** Suma importes decimales mediante enteros alineados a escala, sin `number`.
 * @param importes - Valores ya validados del resumen fiscal.
 * @returns Suma decimal textual normalizada, o `0` si no hay importes.
 */
function sumarImportesExactos(importes: readonly string[]): string {
  if (importes.length === 0) {
    return '0';
  }
  const escala = importes.reduce(
    (maxima, importe) => Math.max(maxima, importe.split('.')[1]?.length ?? 0),
    0,
  );
  const suma = importes.reduce((total, importe) => {
    const [entero = '0', fraccion = ''] = importe.split('.');
    const coeficiente = BigInt(`${entero}${fraccion.padEnd(escala, '0')}`);
    return total + coeficiente;
  }, 0n);
  if (escala === 0) {
    return suma.toString();
  }
  const monto = suma.toString().padStart(escala + 1, '0');
  const parteEntera = monto.slice(0, -escala);
  const parteDecimal = monto.slice(-escala).replace(/0+$/u, '');
  return parteDecimal.length === 0 ? parteEntera : `${parteEntera}.${parteDecimal}`;
}

/** Normaliza el RFC solo para búsqueda, sin modificar el XML original. */
function normalizarRfc(valor: string): string | null {
  const rfc = valor.trim().toUpperCase();
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/u.test(rfc) ? rfc : null;
}

/** Verifica estructura de fecha CFDI y existencia del día sin cambiar su zona horaria. */
function fechaValida(valor: string): boolean {
  const coincidencia =
    /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/u.exec(valor);
  if (coincidencia === null || !Number.isFinite(Date.parse(valor))) {
    return false;
  }
  const fechaUtc = new Date(`${coincidencia[1]}-${coincidencia[2]}-${coincidencia[3]}T00:00:00Z`);
  const fechaEsperada = `${coincidencia[1]}-${coincidencia[2]}-${coincidencia[3]}`;
  return fechaUtc.toISOString().slice(0, 10) === fechaEsperada;
}

const NAMESPACE_CFDI_40 = 'http://www.sat.gob.mx/cfd/4';
const NAMESPACE_TIMBRE = 'http://www.sat.gob.mx/TimbreFiscalDigital';
const UUID_VALIDO = /^[0-9A-F]{8}-[0-9A-F]{4}-[1-8][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/u;
