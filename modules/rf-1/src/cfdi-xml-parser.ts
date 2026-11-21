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
  /** Total decimal textual declarado en el nodo raíz. */
  readonly total?: string;
  /** Serie opcional declarada en el nodo raíz. */
  readonly serie?: string;
  /** Folio opcional declarado en el nodo raíz. */
  readonly folio?: string;
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
  let uuid: string | null = null;
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
    if (tag.uri === NAMESPACE_CFDI_40 && tag.local === 'Emisor') {
      if (emisor !== null || profundidad !== 2) {
        throw new ErrorRf1('CFDI_REQUIRED_FIELD_INVALID');
      }
      emisor = leerAtributoSinNamespace(tag, 'Rfc') ?? null;
    }
    if (tag.uri === NAMESPACE_CFDI_40 && tag.local === 'Receptor') {
      if (receptor !== null || profundidad !== 2) {
        throw new ErrorRf1('CFDI_REQUIRED_FIELD_INVALID');
      }
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
  return validarDatosExtraidos(comprobante, emisor, receptor, uuid);
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
    serie: leerAtributoSinNamespace(tag, 'Serie'),
    folio: leerAtributoSinNamespace(tag, 'Folio'),
  };
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
  if (
    rfcEmisor === null ||
    rfcReceptor === null ||
    fecha === undefined ||
    !fechaValida(fecha) ||
    moneda === undefined ||
    !/^[A-Z]{3}$/u.test(moneda) ||
    total === undefined ||
    !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/u.test(total)
  ) {
    throw new ErrorRf1('CFDI_REQUIRED_FIELD_INVALID');
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
    moneda,
    total,
    referencia,
    tipoComprobante: 'I',
  };
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
