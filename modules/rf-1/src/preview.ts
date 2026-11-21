import { analizarCfdiIngreso } from './cfdi-xml-parser.js';
import { ErrorRf1, type DatosCfdiIngreso } from './types.js';

/** Sociedad real obtenida por RFC receptor dentro de la conexión MySQL elegida. */
export interface SociedadCatalogoRf1 {
  /** Clave sociedad devuelta por el catálogo del cliente. */
  readonly sociedad: string;
  /** Ambiente SAP asociado a esa sociedad, no al entorno PROD/TEST de conexión. */
  readonly ambienteSap: string;
}

/** Puerto deliberadamente de solo lectura para catálogos y duplicados de RF-1. */
export interface CatalogoLecturaRf1 {
  /** Consulta sociedades por RFC receptor dentro del perfil autorizado. */
  buscarSociedadesPorRfc(rfcReceptor: string): Promise<readonly SociedadCatalogoRf1[]>;
  /** Busca proveedores con los tres criterios contextuales aprobados. */
  buscarProveedoresPorContexto(
    rfcEmisor: string,
    sociedad: string,
    ambienteSap: string,
  ): Promise<readonly { readonly idProveedor: string }[]>;
  /** Comprueba el UUID en factura sin modificar el destino. */
  existeUuid(uuid: string): Promise<boolean>;
}

/** Entrada de preview con CFDI sintético y contexto SAP opcional ya elegido por el operador. */
export interface SolicitudVistaPreviaRf1 {
  /** Bytes originales de un único XML; nunca se persisten ni se corrigen. */
  readonly xml: Uint8Array;
  /** Estatus de negocio aprobado para el futuro INSERT, solo mostrado en preview. */
  readonly estatus: string;
  /** Sociedad seleccionada explícitamente cuando el receptor tiene más de una. */
  readonly sociedad?: string;
  /** Ambiente SAP de la sociedad seleccionada explícitamente. */
  readonly ambienteSap?: string;
}

/** Vista de un documento listo, pendiente de selección o bloqueado, sin efectos de escritura. */
export interface VistaPreviaCfdiRf1 {
  /** Estado de resolución del documento antes de cualquier operación futura. */
  readonly status: 'READY' | 'NEEDS_SELECTION' | 'BLOCKED';
  /** Código de regla o bloqueo para traducir en una interfaz futura. */
  readonly errorCode?: string;
  /** Datos tipados extraídos y validados del documento sintético. */
  readonly factura?: DatosCfdiIngreso;
  /** Opciones reales obtenidas del catálogo cuando hace falta selección. */
  readonly sociedadesDisponibles?: readonly SociedadCatalogoRf1[];
  /** Resultado contextual completo solo si proveedor y sociedad son inequívocos. */
  readonly resolution?: {
    /** Sociedad validada por RFC receptor y seleccionada en el catálogo consultado. */
    readonly sociedad: string;
    /** Ambiente SAP leído de la fila de sociedad seleccionada. */
    readonly ambienteSap: string;
    /** Identificador del proveedor único dentro del mismo contexto. */
    readonly idProveedor: string;
  };
  /** Estatus que se mostraría como parte de la previsualización final. */
  readonly estatus?: 'CONTABILIZADO' | 'PAGADA';
}

/** Ejecuta análisis, resolución contextual y duplicados sin exponer ninguna operación DML. */
export async function generarVistaPreviaCfdi(
  solicitud: SolicitudVistaPreviaRf1,
  catalogo: CatalogoLecturaRf1,
): Promise<VistaPreviaCfdiRf1> {
  let factura: DatosCfdiIngreso;
  try {
    factura = analizarCfdiIngreso(solicitud.xml);
  } catch (error) {
    if (error instanceof ErrorRf1) {
      return { status: 'BLOCKED', errorCode: error.code };
    }
    return { status: 'BLOCKED', errorCode: 'XML_MALFORMED' };
  }

  if (solicitud.estatus !== 'CONTABILIZADO' && solicitud.estatus !== 'PAGADA') {
    return { status: 'BLOCKED', errorCode: 'CFDI_STATUS_UNSUPPORTED', factura };
  }

  try {
    const sociedades = await catalogo.buscarSociedadesPorRfc(factura.rfcReceptor);
    const contexto = resolverSociedad(sociedades, solicitud);
    if ('status' in contexto) {
      return { ...contexto, factura };
    }
    const proveedores = await catalogo.buscarProveedoresPorContexto(
      factura.rfcEmisor,
      contexto.sociedad,
      contexto.ambienteSap,
    );
    if (proveedores.length === 0) {
      return { status: 'BLOCKED', errorCode: 'RF1_SUPPLIER_NOT_FOUND', factura };
    }
    if (proveedores.length !== 1) {
      return { status: 'BLOCKED', errorCode: 'RF1_SUPPLIER_AMBIGUOUS', factura };
    }
    if (await catalogo.existeUuid(factura.uuid)) {
      return { status: 'BLOCKED', errorCode: 'RF1_DUPLICATE_UUID', factura };
    }
    return {
      status: 'READY',
      factura,
      estatus: solicitud.estatus,
      resolution: {
        ...contexto,
        idProveedor: proveedores[0]!.idProveedor,
      },
    };
  } catch {
    return { status: 'BLOCKED', errorCode: 'RF1_CATALOG_UNAVAILABLE', factura };
  }
}

/** Resuelve una selección disponible y bloquea catálogos duplicados o contextos ajenos. */
function resolverSociedad(
  sociedades: readonly SociedadCatalogoRf1[],
  solicitud: SolicitudVistaPreviaRf1,
):
  | SociedadCatalogoRf1
  | {
      readonly status: 'NEEDS_SELECTION';
      readonly errorCode: string;
      readonly sociedadesDisponibles: readonly SociedadCatalogoRf1[];
    }
  | { readonly status: 'BLOCKED'; readonly errorCode: string } {
  if (sociedades.length === 0) {
    return { status: 'BLOCKED', errorCode: 'RF1_SOCIETY_NOT_FOUND' };
  }
  const llaves = new Set<string>();
  for (const sociedad of sociedades) {
    const llave = `${sociedad.sociedad}\u0000${sociedad.ambienteSap}`;
    if (llaves.has(llave)) {
      return { status: 'BLOCKED', errorCode: 'RF1_SOCIETY_CATALOG_AMBIGUOUS' };
    }
    llaves.add(llave);
  }

  const tieneSeleccion = solicitud.sociedad !== undefined || solicitud.ambienteSap !== undefined;
  if (sociedades.length > 1 && !tieneSeleccion) {
    return {
      status: 'NEEDS_SELECTION',
      errorCode: 'RF1_SOCIETY_SELECTION_REQUIRED',
      sociedadesDisponibles: sociedades.map((sociedad) => ({ ...sociedad })),
    };
  }
  if (tieneSeleccion) {
    const seleccion = sociedades.find(
      (sociedad) =>
        sociedad.sociedad === solicitud.sociedad && sociedad.ambienteSap === solicitud.ambienteSap,
    );
    return seleccion ?? { status: 'BLOCKED', errorCode: 'RF1_CONTEXT_MISMATCH' };
  }
  return sociedades[0]!;
}
