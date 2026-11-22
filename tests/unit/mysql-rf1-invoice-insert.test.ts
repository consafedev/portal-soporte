import { describe, expect, it, vi } from 'vitest';
import {
  SesionInsercionMysqlRf1,
  type EjecutorTransaccionFacturaRf1,
  type ConsultaFacturaRf1,
  type ResultadoConsultaFacturaRf1,
} from '../../packages/connectors/src/mysql-rf1-invoice-insert.js';
import type { EntradaMapeoFacturaRf1 } from '../../packages/connectors/src/mysql-rf1-invoice-mapper.js';

const factura: EntradaMapeoFacturaRf1 = {
  factura: {
    uuid: '550E8400-E29B-41D4-A716-446655440098',
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
};

/** Crea un ejecutor falso con catálogo válido y una fila verificable tras el INSERT. */
function crearEjecutor(
  reemplazo: Partial<EjecutorTransaccionFacturaRf1> = {},
): EjecutorTransaccionFacturaRf1 & { readonly eventos: string[] } {
  const eventos: string[] = [];
  const ejecutarPredeterminado = async (
    consulta: ConsultaFacturaRf1,
  ): Promise<ResultadoConsultaFacturaRf1> => {
    if (consulta.includes('FROM sap_sociedad')) {
      return { rows: [{ sociedad: '1000', ambienteSap: 'E1P' }], affectedRows: 0 };
    }
    if (consulta.includes('FROM sap_proveedor')) {
      return { rows: [{ idProveedor: 'PROV000001' }], affectedRows: 0 };
    }
    if (consulta.includes('SELECT 1 AS encontrado')) {
      return { rows: [], affectedRows: 0 };
    }
    if (consulta.startsWith('INSERT INTO factura')) {
      return { rows: [], affectedRows: 1 };
    }
    if (consulta.includes('FROM factura WHERE uuid')) {
      return {
        rows: [
          {
            uuid: factura.factura.uuid,
            sociedad: '1000',
            estatus: 'PAGADA',
            totalFAC: '1450.58',
            creadoPor: 'PROV000001',
          },
        ],
        affectedRows: 0,
      };
    }
    throw new Error('QUERY_NOT_EXPECTED');
  };
  return {
    eventos,
    iniciarTransaccion: vi.fn(async () => {
      eventos.push('BEGIN');
      await reemplazo.iniciarTransaccion?.();
    }),
    ejecutar: vi.fn(
      async (
        consulta: ConsultaFacturaRf1,
        parametros: readonly (string | null)[],
      ): Promise<ResultadoConsultaFacturaRf1> => {
        eventos.push(consulta);
        return reemplazo.ejecutar === undefined
          ? ejecutarPredeterminado(consulta)
          : reemplazo.ejecutar(consulta, parametros);
      },
    ),
    confirmarTransaccion: vi.fn(async () => {
      eventos.push('COMMIT');
      await reemplazo.confirmarTransaccion?.();
    }),
    revertirTransaccion: vi.fn(async () => {
      eventos.push('ROLLBACK');
      await reemplazo.revertirTransaccion?.();
    }),
    abortar: vi.fn(),
    cerrar: vi.fn(async () => undefined),
  };
}

describe('SesionInsercionMysqlRf1', () => {
  it('revalida el contexto, inserta en una transacción y verifica después del commit', async () => {
    const ejecutor = crearEjecutor();
    const sesion = new SesionInsercionMysqlRf1(ejecutor);

    await expect(sesion.insertar(factura)).resolves.toEqual({ status: 'INSERTADA_VERIFICADA' });

    expect(ejecutor.eventos).toEqual([
      'BEGIN',
      expect.stringContaining('FROM sap_sociedad'),
      expect.stringContaining('FROM sap_proveedor'),
      expect.stringContaining('SELECT 1 AS encontrado'),
      expect.stringContaining('INSERT INTO factura'),
      'COMMIT',
      expect.stringContaining('FROM factura WHERE uuid'),
    ]);
    expect(ejecutor.ejecutar).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO factura'),
      expect.arrayContaining(['PAGADA', 'AgregadoAutomatizado', 'PROV000001']),
    );
  });

  it('no modifica una factura cuando el UUID ya existe', async () => {
    const ejecutor = crearEjecutor({
      ejecutar: vi.fn(async (consulta: ConsultaFacturaRf1) => {
        if (consulta.includes('SELECT 1 AS encontrado')) {
          return { rows: [{ encontrado: 1 }], affectedRows: 0 };
        }
        if (consulta.includes('FROM sap_sociedad')) {
          return { rows: [{ sociedad: '1000', ambienteSap: 'E1P' }], affectedRows: 0 };
        }
        if (consulta.includes('FROM sap_proveedor')) {
          return { rows: [{ idProveedor: 'PROV000001' }], affectedRows: 0 };
        }
        return { rows: [], affectedRows: 0 };
      }),
    });
    const sesion = new SesionInsercionMysqlRf1(ejecutor);

    await expect(sesion.insertar(factura)).resolves.toEqual({ status: 'YA_EXISTE' });
    expect(ejecutor.eventos).not.toContain('COMMIT');
    expect(ejecutor.eventos).toContain('ROLLBACK');
    expect(ejecutor.ejecutar).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO factura'),
      expect.anything(),
    );
  });

  it('rechaza un contexto SAP que cambió antes de la inserción', async () => {
    const ejecutor = crearEjecutor({
      ejecutar: vi.fn(async (consulta: ConsultaFacturaRf1) =>
        consulta.includes('FROM sap_sociedad')
          ? { rows: [{ sociedad: '2000', ambienteSap: 'OPE' }], affectedRows: 0 }
          : { rows: [], affectedRows: 0 },
      ),
    });
    const sesion = new SesionInsercionMysqlRf1(ejecutor);

    await expect(sesion.insertar(factura)).resolves.toEqual({
      status: 'RECHAZADA',
      errorCode: 'RF1_CONTEXT_MISMATCH',
    });
    expect(ejecutor.eventos).toContain('ROLLBACK');
    expect(ejecutor.ejecutar).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO factura'),
      expect.anything(),
    );
  });

  it('marca ERROR_REVERTIDO cuando el INSERT falla y el rollback termina', async () => {
    const ejecutor = crearEjecutor({
      ejecutar: vi.fn(async (consulta: ConsultaFacturaRf1) => {
        if (consulta.startsWith('INSERT INTO factura')) {
          throw new Error('SYNTHETIC_INSERT_FAILURE');
        }
        if (consulta.includes('FROM sap_sociedad')) {
          return { rows: [{ sociedad: '1000', ambienteSap: 'E1P' }], affectedRows: 0 };
        }
        if (consulta.includes('FROM sap_proveedor')) {
          return { rows: [{ idProveedor: 'PROV000001' }], affectedRows: 0 };
        }
        return { rows: [], affectedRows: 0 };
      }),
    });
    const sesion = new SesionInsercionMysqlRf1(ejecutor);

    await expect(sesion.insertar(factura)).resolves.toEqual({ status: 'ERROR_REVERTIDO' });
    expect(ejecutor.eventos).toContain('ROLLBACK');
  });

  it('devuelve INDETERMINADO si el commit falla', async () => {
    const ejecutor = crearEjecutor({
      confirmarTransaccion: vi.fn(async () => {
        throw new Error('COMMIT_OUTCOME_UNKNOWN');
      }),
    });
    const sesion = new SesionInsercionMysqlRf1(ejecutor);

    await expect(sesion.insertar(factura)).resolves.toEqual({ status: 'INDETERMINADO' });
  });
});
