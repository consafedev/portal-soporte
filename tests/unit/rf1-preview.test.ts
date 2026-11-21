import { describe, expect, it } from 'vitest';
import {
  ErrorRf1,
  analizarCfdiIngreso,
  generarVistaPreviaCfdi,
  type CatalogoLecturaRf1,
  type SociedadCatalogoRf1,
} from '../../modules/rf-1/src/index.js';

const UUID_CFDI = '550e8400-e29b-41d4-a716-446655440000';
const RFC_EMISOR = 'AAA010101AAA';
const RFC_RECEPTOR = 'BBB010101BBB';
const SOCIEDAD_E1P: SociedadCatalogoRf1 = { sociedad: '1000', ambienteSap: 'E1P' };

/** Crea un CFDI sintético con namespace configurable y campos fiscales mínimos válidos. */
function crearXml(overrides: Readonly<Record<string, string>> = {}): Uint8Array {
  const atributos = {
    Version: '4.0',
    TipoDeComprobante: 'I',
    Fecha: '2026-11-20T14:35:00',
    Moneda: 'MXN',
    Total: '100.25',
    ...overrides,
  };
  const atributosXml = Object.entries(atributos)
    .map(([nombre, valor]) => `${nombre}="${valor}"`)
    .join(' ');
  return new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8"?>
<c:Comprobante xmlns:c="http://www.sat.gob.mx/cfd/4" xmlns:t="http://www.sat.gob.mx/TimbreFiscalDigital" ${atributosXml} Serie="A" Folio="12">
  <c:Emisor Rfc="${RFC_EMISOR}"/><c:Receptor Rfc="${RFC_RECEPTOR}"/>
  <c:Complemento><t:TimbreFiscalDigital UUID="${UUID_CFDI}"/></c:Complemento>
</c:Comprobante>`,
  );
}

/** Crea un catálogo de lectura que registra el contexto exacto solicitado por el preview. */
function crearCatalogo(
  datos: {
    readonly sociedades?: readonly SociedadCatalogoRf1[];
    readonly proveedores?: readonly { readonly idProveedor: string }[];
    readonly existeUuid?: boolean;
    readonly fallar?: boolean;
  } = {},
): {
  readonly catalogo: CatalogoLecturaRf1;
  readonly consultasProveedor: { rfc: string; sociedad: string; ambienteSap: string }[];
} {
  const consultasProveedor: { rfc: string; sociedad: string; ambienteSap: string }[] = [];
  const catalogo: CatalogoLecturaRf1 = {
    async buscarSociedadesPorRfc(): Promise<readonly SociedadCatalogoRf1[]> {
      if (datos.fallar) {
        throw new Error('detalle sintético que no debe exponerse');
      }
      return datos.sociedades ?? [SOCIEDAD_E1P];
    },
    async buscarProveedoresPorContexto(
      rfc: string,
      sociedad: string,
      ambienteSap: string,
    ): Promise<readonly { readonly idProveedor: string }[]> {
      consultasProveedor.push({ rfc, sociedad, ambienteSap });
      if (datos.fallar) {
        throw new Error('detalle sintético que no debe exponerse');
      }
      return datos.proveedores ?? [{ idProveedor: 'PROV-001' }];
    },
    async existeUuid(): Promise<boolean> {
      if (datos.fallar) {
        throw new Error('detalle sintético que no debe exponerse');
      }
      return datos.existeUuid ?? false;
    },
  };
  return { catalogo, consultasProveedor };
}

/** Comprueba extracción por namespace, totales exactos y referencia sin inventar folios. */
async function analizaCfdiSintetico(): Promise<void> {
  const factura = analizarCfdiIngreso(crearXml());

  expect(factura).toMatchObject({
    uuid: UUID_CFDI.toUpperCase(),
    rfcEmisor: RFC_EMISOR,
    rfcReceptor: RFC_RECEPTOR,
    fecha: '2026-11-20T14:35:00',
    moneda: 'MXN',
    total: '100.25',
    referencia: 'A12',
    tipoComprobante: 'I',
  });
}

/** Conserva una referencia vacía cuando el XML no aporta serie ni folio. */
async function permiteFacturaSinSerieNiFolio(): Promise<void> {
  const xml = new TextDecoder().decode(crearXml()).replace(' Serie="A" Folio="12"', '');

  expect(analizarCfdiIngreso(new TextEncoder().encode(xml)).referencia).toBe('');
}

/** Rechaza DTD y entidades externas antes de procesar contenido del CFDI. */
async function rechazaDtd(): Promise<void> {
  const xml = `<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${new TextDecoder().decode(crearXml())}`;

  expect(() => analizarCfdiIngreso(new TextEncoder().encode(xml))).toThrowError(
    expect.objectContaining({ code: 'XML_DOCTYPE_FORBIDDEN' }),
  );
}

/** Rechaza tipos CFDI fuera del MVP sin reinterpretarlos como facturas de ingreso. */
async function rechazaNotaDeCredito(): Promise<void> {
  expect(() => analizarCfdiIngreso(crearXml({ TipoDeComprobante: 'E' }))).toThrowError(
    expect.objectContaining({ code: 'CFDI_TYPE_UNSUPPORTED' }),
  );
}

/** Restringe el tamaño antes de decodificar XML suministrado por el usuario. */
async function rechazaXmlDemasiadoGrande(): Promise<void> {
  expect(() => analizarCfdiIngreso(new Uint8Array(5 * 1024 * 1024 + 1))).toThrowError(
    expect.objectContaining({ code: 'XML_TOO_LARGE' }),
  );
}

/** Rechaza atributos RFC homónimos provenientes de un namespace ajeno al CFDI. */
async function rechazaRfcConNamespaceAjeno(): Promise<void> {
  const xml = new TextDecoder()
    .decode(crearXml())
    .replace('<c:Emisor Rfc=', '<c:Emisor xmlns:x="urn:sintetico" x:Rfc=');

  expect(() => analizarCfdiIngreso(new TextEncoder().encode(xml))).toThrowError(
    expect.objectContaining({ code: 'CFDI_REQUIRED_FIELD_INVALID' }),
  );
}

/** Rechaza fecha fiscal imposible e importe que excede la gramática decimal autorizada. */
async function rechazaFechaEImporteInvalidos(): Promise<void> {
  for (const xml of [
    crearXml({ Fecha: '2026-02-30T14:35:00' }),
    crearXml({ Total: '1e3' }),
    crearXml({ Total: '-1.00' }),
  ]) {
    expect(() => analizarCfdiIngreso(xml)).toThrowError(
      expect.objectContaining({ code: 'CFDI_REQUIRED_FIELD_INVALID' }),
    );
  }
}

/** Rechaza UUID ausente, inválido o repetido en el complemento fiscal. */
async function rechazaUuidInvalidoORepetido(): Promise<void> {
  const xmlSinTimbre = new TextDecoder()
    .decode(crearXml())
    .replace(/<c:Complemento>[\s\S]*?<\/c:Complemento>/u, '<c:Complemento/>');
  const xmlRepetido = new TextDecoder()
    .decode(crearXml())
    .replace(
      '</c:Complemento>',
      '<t:TimbreFiscalDigital UUID="550e8400-e29b-41d4-a716-446655440000"/></c:Complemento>',
    );
  const xmlUuidInvalido = new TextDecoder().decode(crearXml()).replace(UUID_CFDI, 'no-es-un-uuid');

  expect(() => analizarCfdiIngreso(new TextEncoder().encode(xmlSinTimbre))).toThrowError(
    expect.objectContaining({ code: 'CFDI_REQUIRED_FIELD_INVALID' }),
  );
  expect(() => analizarCfdiIngreso(new TextEncoder().encode(xmlRepetido))).toThrowError(
    expect.objectContaining({ code: 'CFDI_UUID_INVALID' }),
  );
  expect(() => analizarCfdiIngreso(new TextEncoder().encode(xmlUuidInvalido))).toThrowError(
    expect.objectContaining({ code: 'CFDI_UUID_INVALID' }),
  );
}

/** Detiene entradas profundamente anidadas o con demasiados nodos dentro de límites configurados. */
async function rechazaLimitesEstructurales(): Promise<void> {
  const xml = crearXml();

  expect(() => analizarCfdiIngreso(xml, { profundidadMaxima: 2 })).toThrowError(
    expect.objectContaining({ code: 'XML_DEPTH_LIMIT' }),
  );
  expect(() => analizarCfdiIngreso(xml, { nodosMaximos: 2 })).toThrowError(
    expect.objectContaining({ code: 'XML_NODE_LIMIT' }),
  );
}

/** Rechaza referencias fiscales que exceden el límite de almacenamiento futuro. */
async function rechazaReferenciaExcesiva(): Promise<void> {
  const xml = new TextDecoder()
    .decode(crearXml())
    .replace('Serie="A"', `Serie="${'S'.repeat(51)}"`)
    .replace('Folio="12"', `Folio="${'F'.repeat(50)}"`);

  expect(() => analizarCfdiIngreso(new TextEncoder().encode(xml))).toThrowError(
    expect.objectContaining({ code: 'CFDI_REFERENCE_TOO_LONG' }),
  );
}

/** Selecciona al proveedor solo en sociedad y ambiente SAP de la sociedad receptora. */
async function resuelveProveedorEnContextoExacto(): Promise<void> {
  const { catalogo, consultasProveedor } = crearCatalogo({
    proveedores: [{ idProveedor: 'PROV-E1P-1000' }],
  });
  const preview = await generarVistaPreviaCfdi(
    { xml: crearXml(), estatus: 'CONTABILIZADO' },
    catalogo,
  );

  expect(preview.status).toBe('READY');
  expect(preview.resolution).toMatchObject({
    sociedad: '1000',
    ambienteSap: 'E1P',
    idProveedor: 'PROV-E1P-1000',
  });
  expect(consultasProveedor).toEqual([{ rfc: RFC_EMISOR, sociedad: '1000', ambienteSap: 'E1P' }]);
}

/** Pide selección si el RFC receptor resuelve más de un par sociedad/ambiente. */
async function exigeSeleccionDeSociedad(): Promise<void> {
  const opciones = [SOCIEDAD_E1P, { sociedad: '2000', ambienteSap: 'OPE' }];
  const { catalogo } = crearCatalogo({ sociedades: opciones });
  const preview = await generarVistaPreviaCfdi({ xml: crearXml(), estatus: 'PAGADA' }, catalogo);

  expect(preview).toMatchObject({
    status: 'NEEDS_SELECTION',
    errorCode: 'RF1_SOCIETY_SELECTION_REQUIRED',
    sociedadesDisponibles: opciones,
  });
}

/** Bloquea ausencia y duplicidad del proveedor dentro del único contexto solicitado. */
async function bloqueaProveedorAusenteOAmebiguo(): Promise<void> {
  const ausente = crearCatalogo({ proveedores: [] });
  const ambiguo = crearCatalogo({
    proveedores: [{ idProveedor: 'PROV-001' }, { idProveedor: 'PROV-002' }],
  });
  const opciones = { xml: crearXml(), estatus: 'CONTABILIZADO' as const };

  await expect(generarVistaPreviaCfdi(opciones, ausente.catalogo)).resolves.toMatchObject({
    status: 'BLOCKED',
    errorCode: 'RF1_SUPPLIER_NOT_FOUND',
  });
  await expect(generarVistaPreviaCfdi(opciones, ambiguo.catalogo)).resolves.toMatchObject({
    status: 'BLOCKED',
    errorCode: 'RF1_SUPPLIER_AMBIGUOUS',
  });
}

/** Rechaza sociedad receptora ausente o una selección que no pertenece al catálogo. */
async function bloqueaContextoDeSociedadInvalido(): Promise<void> {
  const ausente = crearCatalogo({ sociedades: [] });
  const noAutorizada = crearCatalogo();

  await expect(
    generarVistaPreviaCfdi({ xml: crearXml(), estatus: 'PAGADA' }, ausente.catalogo),
  ).resolves.toMatchObject({ status: 'BLOCKED', errorCode: 'RF1_SOCIETY_NOT_FOUND' });
  await expect(
    generarVistaPreviaCfdi(
      {
        xml: crearXml(),
        estatus: 'PAGADA',
        sociedad: '9999',
        ambienteSap: 'ZZZ',
      },
      noAutorizada.catalogo,
    ),
  ).resolves.toMatchObject({ status: 'BLOCKED', errorCode: 'RF1_CONTEXT_MISMATCH' });
}

/** Bloquea duplicados y traduce fallos del catálogo sin filtrar errores del driver. */
async function bloqueaDuplicadoYFallaCerrado(): Promise<void> {
  const duplicado = crearCatalogo({ existeUuid: true });
  const catalogoCaido = crearCatalogo({ fallar: true });
  const solicitud = { xml: crearXml(), estatus: 'CONTABILIZADO' as const };

  await expect(generarVistaPreviaCfdi(solicitud, duplicado.catalogo)).resolves.toMatchObject({
    status: 'BLOCKED',
    errorCode: 'RF1_DUPLICATE_UUID',
  });
  const fallo = await generarVistaPreviaCfdi(solicitud, catalogoCaido.catalogo);
  expect(fallo).toMatchObject({ status: 'BLOCKED', errorCode: 'RF1_CATALOG_UNAVAILABLE' });
  expect(JSON.stringify(fallo)).not.toContain('detalle sintético');
}

/** Bloquea filas sociales indistinguibles y no elige el primer registro recibido. */
async function bloqueaSociedadesDuplicadas(): Promise<void> {
  const { catalogo } = crearCatalogo({ sociedades: [SOCIEDAD_E1P, SOCIEDAD_E1P] });
  const preview = await generarVistaPreviaCfdi(
    { xml: crearXml(), estatus: 'CONTABILIZADO' },
    catalogo,
  );

  expect(preview).toMatchObject({
    status: 'BLOCKED',
    errorCode: 'RF1_SOCIETY_CATALOG_AMBIGUOUS',
  });
}

/** Distingue errores de dominio del parser sin presentar mensajes técnicos externos. */
async function exponeCodigoControladoDeXmlMalformado(): Promise<void> {
  try {
    analizarCfdiIngreso(
      new TextEncoder().encode('<c:Comprobante xmlns:c="http://www.sat.gob.mx/cfd/4">'),
    );
    throw new Error('La prueba esperaba un error de XML.');
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorRf1);
    expect(error).toMatchObject({ code: 'XML_MALFORMED' });
  }
}

/** Agrupa las pruebas del parser que solo consume documentos sintéticos en memoria. */
function describirParserCfdi(): void {
  it('extrae datos por namespace y conserva el importe decimal', analizaCfdiSintetico);
  it('permite serie y folio ausentes sin inventar la referencia', permiteFacturaSinSerieNiFolio);
  it('rechaza DTD y entidades externas', rechazaDtd);
  it('rechaza CFDI fuera del tipo de ingreso', rechazaNotaDeCredito);
  it('rechaza documentos que exceden el límite configurado', rechazaXmlDemasiadoGrande);
  it(
    'rechaza atributos fiscales sustituidos mediante namespaces ajenos',
    rechazaRfcConNamespaceAjeno,
  );
  it('rechaza fechas e importes fuera de la gramática permitida', rechazaFechaEImporteInvalidos);
  it('rechaza UUID ausente o repetido', rechazaUuidInvalidoORepetido);
  it('limita profundidad y cantidad de nodos', rechazaLimitesEstructurales);
  it('rechaza referencias de serie y folio demasiado extensas', rechazaReferenciaExcesiva);
  it(
    'devuelve un error de dominio estable para XML malformado',
    exponeCodigoControladoDeXmlMalformado,
  );
}

/** Agrupa la validación de preview contra catálogos de lectura sintéticos sin métodos de escritura. */
function describirPreviewSinEscritura(): void {
  it(
    'resuelve proveedor por RFC, sociedad y ambiente SAP exactos',
    resuelveProveedorEnContextoExacto,
  );
  it('solicita selección cuando hay varias sociedades', exigeSeleccionDeSociedad);
  it(
    'bloquea proveedores ausentes o duplicados dentro del contexto',
    bloqueaProveedorAusenteOAmebiguo,
  );
  it('bloquea sociedad ausente o selección fuera del catálogo', bloqueaContextoDeSociedadInvalido);
  it('bloquea UUID duplicado y falla cerrado ante indisponibilidad', bloqueaDuplicadoYFallaCerrado);
  it('bloquea filas de sociedad indistinguibles', bloqueaSociedadesDuplicadas);
}

describe('análisis CFDI RF-1', describirParserCfdi);
describe('preview RF-1 de solo lectura', describirPreviewSinEscritura);
