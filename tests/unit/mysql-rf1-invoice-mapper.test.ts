import { describe, expect, it } from 'vitest';
import {
  ErrorMapeoFacturaRf1,
  mapearFacturaParaInsercionRf1,
  type EntradaMapeoFacturaRf1,
} from '../../packages/connectors/src/mysql-rf1-invoice-mapper.js';

const facturaBase: EntradaMapeoFacturaRf1 = {
  factura: {
    uuid: '550E8400-E29B-41D4-A716-446655440099',
    rfcEmisor: 'COSC8001137NA',
    rfcReceptor: 'XAXX010101000',
    fecha: '2025-06-07T23:30:00-06:00',
    subtotal: '1250.50',
    descuento: '0',
    moneda: 'MXN',
    total: '1450.58',
    referencia: 'AB-120',
    tipoComprobante: 'I',
    importeIvaFAC: '200.08',
    retencionIsr: '0',
    retencionIva: '0',
    retencionIeps: '0',
    serie: 'AB-',
    folio: '120',
    metodoPago: 'PUE',
    formaPago: '03',
  },
  resolution: { sociedad: '1000', ambienteSap: 'E1P', idProveedor: 'PROV000001' },
  estatus: 'PAGADA',
  fechaCarga: new Date('2026-11-22T07:00:00.000Z'),
  documentos: {
    documentoContable: null,
    entradaMercancia: null,
    ordenCompra: null,
    documentoPago: null,
  },
};

describe('mapearFacturaParaInsercionRf1', () => {
  it('mapea campos fiscales y SAP sin usar punto flotante ni cambiar la fecha fiscal', () => {
    const fila = mapearFacturaParaInsercionRf1(facturaBase);

    expect(fila).toEqual({
      uuid: '550E8400-E29B-41D4-A716-446655440099',
      nodocumentocontable: null,
      ejercicio: '2025',
      rfcReceptor: 'XAXX010101000',
      rfcEmisor: 'COSC8001137NA',
      folio: '120',
      serie: 'AB-',
      fecha: '2025-06-07',
      monedaFAC: 'MXN',
      totalFAC: '1450.58',
      subtotalFAC: '1250.50',
      importeIvaFAC: '200.08',
      rutaXml: 'AgregadoAutomatizado',
      rutaPdf: null,
      estatus: 'PAGADA',
      version: '4.0',
      fechaCarga: '2026-11-22 07:00:00',
      nea: null,
      tipoComprobante: 'I',
      metododepago: 'PUE',
      formadepago: '03',
      numctapago: null,
      referencia: 'AB-120',
      nodocumentopago: null,
      noa: null,
      creadoPor: 'PROV000001',
      nodocumentologistico: null,
      sociedad: '1000',
      retencionIsr: '0',
      retencionIva: '0',
      retencionIeps: '0',
      moduloOrigen: 'REF',
      detraccion_pe: null,
    });
  });

  it('admite CONTABILIZADO y conserva folio opcional sin inventar serie', () => {
    const fila = mapearFacturaParaInsercionRf1({
      ...facturaBase,
      factura: { ...facturaBase.factura, serie: undefined, referencia: '42' },
      estatus: 'CONTABILIZADO',
      documentos: { ordenCompra: 'OC-42' },
    });

    expect(fila.estatus).toBe('CONTABILIZADO');
    expect(fila.serie).toBeNull();
    expect(fila.folio).toBe('120');
    expect(fila.referencia).toBe('42');
    expect(fila.noa).toBe('OC-42');
  });

  it('conserva una referencia vacía cuando el CFDI no incluye serie ni folio', () => {
    const fila = mapearFacturaParaInsercionRf1({
      ...facturaBase,
      factura: { ...facturaBase.factura, referencia: '', serie: undefined, folio: undefined },
    });

    expect(fila.referencia).toBe('');
    expect(fila.serie).toBeNull();
    expect(fila.folio).toBeNull();
  });

  it('rechaza escalas no confirmadas en vez de redondear valores fiscales', () => {
    expect(() =>
      mapearFacturaParaInsercionRf1({
        ...facturaBase,
        factura: { ...facturaBase.factura, total: '1450.581' },
      }),
    ).toThrowError(new ErrorMapeoFacturaRf1('DECIMAL_SCALE_UNSUPPORTED'));
  });

  it('rechaza documentos mayores al DDL supuesto sin truncarlos', () => {
    expect(() =>
      mapearFacturaParaInsercionRf1({
        ...facturaBase,
        documentos: { documentoPago: '12345678901' },
      }),
    ).toThrowError(new ErrorMapeoFacturaRf1('FIELD_TOO_LONG'));
  });

  it('rechaza un estatus o fecha de carga fuera del contrato', () => {
    expect(() =>
      mapearFacturaParaInsercionRf1({ ...facturaBase, estatus: 'PENDIENTE' as 'PAGADA' }),
    ).toThrowError(new ErrorMapeoFacturaRf1('INPUT_INVALID'));
    expect(() =>
      mapearFacturaParaInsercionRf1({ ...facturaBase, fechaCarga: new Date(Number.NaN) }),
    ).toThrowError(new ErrorMapeoFacturaRf1('INPUT_INVALID'));
  });
});
