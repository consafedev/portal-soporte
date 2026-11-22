import { describe, expect, it } from 'vitest';
import { SesionMysqlRf1 } from '../../packages/connectors/src/mysql-rf1-catalog.js';

const SQL_SOCIEDADES = 'SELECT sociedad, ambienteSap FROM sap_sociedad WHERE rfc = ? LIMIT 101';
const SQL_PROVEEDORES =
  'SELECT idProveedor FROM sap_proveedor WHERE rfc = ? AND sociedad = ? AND ambienteSap = ? LIMIT 2';
const SQL_UUID = 'SELECT 1 AS encontrado FROM factura WHERE uuid = ? LIMIT 1';

/** Crea una sesión de prueba que captura SQL/params y permite definir filas sintéticas. */
function crearSesion(
  responder: (
    consulta: string,
    parametros: readonly string[],
  ) => Promise<readonly unknown[]> = async () => [],
) {
  const consultas: { readonly sql: string; readonly parametros: readonly string[] }[] = [];
  let cierres = 0;
  const sesion = new SesionMysqlRf1(
    {
      /** Captura la consulta para comprobar SQL fijo y orden exacto de parámetros. */
      async ejecutar(sql, parametros) {
        consultas.push({ sql, parametros });
        return responder(sql, parametros);
      },
    },
    async () => {
      cierres += 1;
    },
    new AbortController().signal,
    500,
  );

  return { sesion, consultas, obtenerCierres: () => cierres };
}

describe('sesión de catálogo MySQL RF-1', () => {
  it('busca sociedades por RFC normalizado con una consulta fija y límite detectado', async () => {
    const fixture = crearSesion(async () => [
      { sociedad: '1000', ambienteSap: 'E1P' },
      { sociedad: '2000', ambienteSap: 'OPE' },
    ]);

    const sociedades = await fixture.sesion.buscarSociedadesPorRfc('  xaxx010101000  ');

    expect(sociedades).toEqual([
      { sociedad: '1000', ambienteSap: 'E1P' },
      { sociedad: '2000', ambienteSap: 'OPE' },
    ]);
    expect(fixture.consultas).toEqual([{ sql: SQL_SOCIEDADES, parametros: ['XAXX010101000'] }]);
  });

  it('rechaza más de cien sociedades en vez de devolver una lista truncada', async () => {
    const fixture = crearSesion(async () =>
      Array.from({ length: 101 }, () => ({ sociedad: '1000', ambienteSap: 'E1P' })),
    );

    await expect(fixture.sesion.buscarSociedadesPorRfc('XAXX010101000')).rejects.toThrow(
      'RF1_CATALOG_RESULT_LIMIT',
    );
    expect(fixture.consultas[0]?.sql).toBe(SQL_SOCIEDADES);
  });

  it('busca proveedor por RFC, sociedad y ambiente SAP en ese orden, conservando 0/1/2 filas', async () => {
    const resultados: readonly unknown[][] = [
      [],
      [{ idProveedor: 'PROV000001' }],
      [{ idProveedor: 'PROV000001' }, { idProveedor: 'PROV000002' }],
    ];

    for (const filas of resultados) {
      const fixture = crearSesion(async () => filas);
      const proveedores = await fixture.sesion.buscarProveedoresPorContexto(
        'COSC8001137NA',
        '1000',
        'E1P',
      );

      expect(proveedores).toEqual(filas);
      expect(fixture.consultas).toEqual([
        {
          sql: SQL_PROVEEDORES,
          parametros: ['COSC8001137NA', '1000', 'E1P'],
        },
      ]);
    }
  });

  it('rechaza valores con sintaxis SQL como entrada y no ejecuta consultas', async () => {
    const fixture = crearSesion();

    await expect(
      fixture.sesion.buscarProveedoresPorContexto("XAXX010101000' OR 1=1 --", '1000', 'E1P'),
    ).rejects.toThrow('RF1_CATALOG_INPUT_INVALID');
    await expect(
      fixture.sesion.buscarProveedoresPorContexto('COSC8001137NA', '1000 OR 1=1', 'E1P'),
    ).rejects.toThrow('RF1_CATALOG_INPUT_INVALID');
    expect(fixture.consultas).toEqual([]);
  });

  it('normaliza y parametriza UUID, devolviendo existencia sin escoger filas de factura', async () => {
    const fixture = crearSesion(async () => [{ encontrado: 1 }]);

    const existe = await fixture.sesion.existeUuid('  550e8400-e29b-41d4-a716-446655440001  ');

    expect(existe).toBe(true);
    expect(fixture.consultas).toEqual([
      {
        sql: SQL_UUID,
        parametros: ['550E8400-E29B-41D4-A716-446655440001'],
      },
    ]);
    expect(SQL_UUID).not.toMatch(/INSERT|UPDATE|DELETE/iu);
  });

  it('rechaza UUID inválido y libera una sola vez la conexión al cerrar', async () => {
    const fixture = crearSesion();

    await expect(fixture.sesion.existeUuid("x' OR 1=1 --")).rejects.toThrow(
      'RF1_CATALOG_INPUT_INVALID',
    );
    await fixture.sesion.cerrar();
    await fixture.sesion.cerrar();
    await expect(fixture.sesion.existeUuid('550e8400-e29b-41d4-a716-446655440001')).rejects.toThrow(
      'RF1_SESSION_CLOSED',
    );

    expect(fixture.obtenerCierres()).toBe(1);
    expect(fixture.consultas).toEqual([]);
  });

  it('no consulta después de cancelar la señal del broker', async () => {
    const controlador = new AbortController();
    const fixture = crearSesion();
    const sesionCancelable = new SesionMysqlRf1(
      {
        /** Captura ejecuciones realizadas antes de la cancelación del broker. */
        async ejecutar(sql, parametros) {
          fixture.consultas.push({ sql, parametros });
          return [];
        },
      },
      async () => undefined,
      controlador.signal,
      500,
    );
    controlador.abort();

    await expect(
      sesionCancelable.existeUuid('550e8400-e29b-41d4-a716-446655440001'),
    ).rejects.toThrow('RF1_SESSION_ABORTED');
    expect(fixture.consultas).toEqual([]);
  });

  it('aborta la conexión y cierra la sesión cuando vence una consulta', async () => {
    const controlador = new AbortController();
    let cierres = 0;
    const sesion = new SesionMysqlRf1(
      {
        /** Simula una consulta que no finaliza antes del timeout. */
        async ejecutar(): Promise<readonly unknown[]> {
          return new Promise(() => undefined);
        },
      },
      async () => {
        cierres += 1;
      },
      controlador.signal,
      10,
      () => controlador.abort(),
    );

    await expect(sesion.existeUuid('550e8400-e29b-41d4-a716-446655440001')).rejects.toThrow(
      'RF1_QUERY_TIMEOUT',
    );
    await sesion.cerrar();

    expect(controlador.signal.aborted).toBe(true);
    expect(cierres).toBe(1);
  });
});
