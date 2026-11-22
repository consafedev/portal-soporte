import { describe, expect, it, vi } from 'vitest';
import { ServicioInsercionRf1 } from '../../apps/api/src/clients/rf1-insertion-service.js';
import type { VistaPreviaCfdiRf1 } from '../../modules/rf-1/src/preview.js';
import type { SesionInsercionRf1 } from '../../packages/core/src/clients/rf1-insertion-ports.js';
import type { EntradaMapeoFacturaRf1 } from '../../packages/core/src/clients/rf1-insertion-ports.js';
import type { PerfilConexionCliente } from '../../packages/core/src/clients/connection-profile-ports.js';
import { calcularHuellaPerfilConexion } from '../../apps/api/src/clients/connection-profile-fingerprint.js';

const ACTOR_ID = '00000000-0000-4000-8000-000000000001';
const CLIENTE_ID = '00000000-0000-4000-8000-000000000002';
const PERFIL_ID = '00000000-0000-4000-8000-000000000003';
const FACTURA = {
  uuid: '550E8400-E29B-41D4-A716-446655440000',
  rfcEmisor: 'AAA010101AAA',
  rfcReceptor: 'BBB010101BBB',
  fecha: '2026-11-20T14:35:00',
  subtotal: '100.25',
  descuento: '0',
  moneda: 'MXN',
  total: '100.25',
  referencia: 'A-12',
  tipoComprobante: 'I' as const,
  importeIvaFAC: '0',
  retencionIsr: '0',
  retencionIva: '0',
  retencionIeps: '0',
};
const SOLICITUD = {
  actor: { actorUserId: ACTOR_ID, requestId: 'request-synthetic' },
  clientId: CLIENTE_ID,
  profileId: PERFIL_ID,
  estatus: 'PAGADA' as const,
  archivos: [Buffer.from('<xml-sintetico />')],
  seleccionesSociedad: [],
  senal: new AbortController().signal,
};
const VISTA_LISTA: VistaPreviaCfdiRf1 = {
  status: 'READY',
  factura: FACTURA,
  estatus: 'PAGADA',
  resolution: { sociedad: '1000', ambienteSap: 'E1P', idProveedor: 'PROV-SINTETICO' },
};
const PERFIL_ACTIVO: PerfilConexionCliente = {
  id: PERFIL_ID,
  clientId: CLIENTE_ID,
  nombre: 'Perfil sintético',
  tipo: 'MYSQL_TCP',
  entorno: 'TEST',
  destinoMySqlId: 'mysql-fixture',
  gatewaySshId: null,
  baseDatos: 'fixture_db',
  estado: 'ACTIVE',
  createdAt: new Date('2026-11-22T10:00:00.000Z'),
  updatedAt: new Date('2026-11-22T11:00:00.000Z'),
};

/**
 * Construye los puertos falsos de autorización, preview, auditoría y escritura para cada caso.
 * @param overrides Variantes sintéticas de gate, permisos, revocación o resultado del preview.
 * @returns Servicio y dobles de prueba para inspeccionar efectos sin conectar a MySQL.
 * @effects Todos los datos y credenciales de prueba permanecen en memoria.
 */
function crearDependencias(
  overrides: {
    readonly enabled?: boolean;
    readonly accesoDenegado?: boolean;
    readonly revocarAntesDml?: boolean;
    readonly resultados?: readonly VistaPreviaCfdiRf1[];
  } = {},
) {
  const insertar = vi.fn(
    async (
      _entrada: EntradaMapeoFacturaRf1,
      autorizarEscrituraVigente?: () => Promise<
        'AUTORIZADA' | 'ACCESO_REVOCADO' | 'PERFIL_CAMBIADO'
      >,
    ) => {
      const decision = await autorizarEscrituraVigente?.();
      if (decision === 'ACCESO_REVOCADO' || decision === 'PERFIL_CAMBIADO') {
        return {
          status: 'RECHAZADA' as const,
          errorCode:
            decision === 'ACCESO_REVOCADO'
              ? ('RF1_ACCESS_REVOKED' as const)
              : ('RF1_PROFILE_CHANGED' as const),
        };
      }
      return { status: 'INSERTADA_VERIFICADA' as const };
    },
  );
  const cerrar = vi.fn(async () => undefined);
  const exigir = vi.fn(async () => {
    if (overrides.accesoDenegado || (overrides.revocarAntesDml && exigir.mock.calls.length >= 4)) {
      throw Object.assign(new Error('CLIENT_ACCESS_DENIED'), { statusCode: 403 });
    }
  });
  const auditoria = { registrar: vi.fn(async () => undefined) };
  const vistaPrevia = {
    preautorizar: vi.fn(async () => undefined),
    ejecutar: vi.fn(async () => overrides.resultados ?? [VISTA_LISTA]),
  };
  const perfiles = {
    listar: vi.fn(async () => [PERFIL_ACTIVO]),
    abrirInsercionRf1: vi.fn(async () => ({ insertar, cerrar }) as SesionInsercionRf1),
  };
  const servicio = new ServicioInsercionRf1(
    { exigir },
    perfiles,
    vistaPrevia,
    auditoria,
    { ahora: () => new Date('2026-11-22T12:00:00.000Z') },
    overrides.enabled ?? false,
  );

  return { servicio, exigir, insertar, cerrar, auditoria, vistaPrevia, perfiles };
}

describe('servicio de inserción RF-1 con autorización y confirmación efímera', () => {
  it('falla cerrado si la compuerta global está apagada', async () => {
    const { servicio, exigir, perfiles } = crearDependencias();

    await expect(servicio.prepararConfirmacion(SOLICITUD, [VISTA_LISTA])).resolves.toMatchObject({
      executionAvailable: false,
      confirmationToken: null,
    });
    await expect(servicio.ejecutar(SOLICITUD, 'A'.repeat(43))).rejects.toMatchObject({
      code: 'RF1_INSERTION_DISABLED',
      statusCode: 503,
    });
    expect(exigir).not.toHaveBeenCalled();
    expect(perfiles.abrirInsercionRf1).not.toHaveBeenCalled();
  });

  it('no emite confirmación cuando la capacidad del cliente está denegada', async () => {
    const { servicio, exigir } = crearDependencias({ enabled: true, accesoDenegado: true });

    await expect(servicio.prepararConfirmacion(SOLICITUD, [VISTA_LISTA])).resolves.toEqual({
      executionAvailable: false,
      confirmationToken: null,
    });
    expect(exigir).toHaveBeenCalledWith(SOLICITUD.actor, CLIENTE_ID, 'rf-1:execute');
  });

  it('no emite confirmación si algún documento no está listo', async () => {
    const { servicio, exigir } = crearDependencias({ enabled: true });

    await expect(
      servicio.prepararConfirmacion(SOLICITUD, [{ status: 'BLOCKED', errorCode: 'XML_MALFORMED' }]),
    ).resolves.toEqual({ executionAvailable: false, confirmationToken: null });
    expect(exigir).not.toHaveBeenCalled();
  });

  it('recalcula, consume una sola vez y reutiliza el motor transaccional tipado', async () => {
    const { servicio, exigir, insertar, cerrar, auditoria, perfiles, vistaPrevia } =
      crearDependencias({ enabled: true });
    const confirmado = await servicio.prepararConfirmacion(SOLICITUD, [VISTA_LISTA]);
    const token = confirmado.confirmationToken;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const resultado = await servicio.ejecutar(SOLICITUD, token!);

    expect(resultado).toEqual([{ status: 'INSERTADA_VERIFICADA' }]);
    expect(vistaPrevia.ejecutar).toHaveBeenCalledWith(SOLICITUD);
    expect(perfiles.abrirInsercionRf1).toHaveBeenCalledWith(
      CLIENTE_ID,
      PERFIL_ID,
      SOLICITUD.senal,
      calcularHuellaPerfilConexion(PERFIL_ACTIVO),
    );
    expect(exigir).toHaveBeenCalledWith(SOLICITUD.actor, CLIENTE_ID, 'rf-1:read');
    expect(exigir).toHaveBeenCalledWith(SOLICITUD.actor, CLIENTE_ID, 'rf-1:execute');
    expect(insertar).toHaveBeenCalledWith(
      expect.objectContaining({
        factura: FACTURA,
        estatus: 'PAGADA',
        resolution: VISTA_LISTA.resolution,
        fechaCarga: new Date('2026-11-22T12:00:00.000Z'),
      }),
      expect.any(Function),
    );
    expect(cerrar).toHaveBeenCalledOnce();
    expect(auditoria.registrar).toHaveBeenCalledTimes(2);
    expect(auditoria.registrar).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: 'RF1_INSERTION_REQUESTED', outcome: 'SUCCESS' }),
    );
    expect(auditoria.registrar).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: 'RF1_INSERTION_COMPLETED', outcome: 'SUCCESS' }),
    );
    await expect(servicio.ejecutar(SOLICITUD, token!)).rejects.toMatchObject({
      code: 'RF1_CONFIRMATION_INVALID',
      statusCode: 409,
    });
  });

  it('rechaza cambios del lote antes de abrir un perfil de escritura', async () => {
    const { servicio, perfiles } = crearDependencias({ enabled: true });
    const confirmado = await servicio.prepararConfirmacion(SOLICITUD, [VISTA_LISTA]);
    const solicitudModificada = { ...SOLICITUD, archivos: [Buffer.from('<xml-distinto />')] };

    await expect(
      servicio.ejecutar(solicitudModificada, confirmado.confirmationToken!),
    ).rejects.toMatchObject({
      code: 'RF1_CONFIRMATION_INVALID',
      statusCode: 409,
    });
    expect(perfiles.abrirInsercionRf1).not.toHaveBeenCalled();
  });

  it('no abre una conexión de escritura si no puede auditar la solicitud confirmada', async () => {
    const { servicio, perfiles, auditoria } = crearDependencias({ enabled: true });
    const confirmado = await servicio.prepararConfirmacion(SOLICITUD, [VISTA_LISTA]);
    auditoria.registrar.mockRejectedValueOnce(new Error('AUDIT_WRITE_FAILED'));

    await expect(servicio.ejecutar(SOLICITUD, confirmado.confirmationToken!)).rejects.toThrow(
      'AUDIT_WRITE_FAILED',
    );

    expect(auditoria.registrar).toHaveBeenCalledOnce();
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RF1_INSERTION_REQUESTED', outcome: 'SUCCESS' }),
    );
    expect(perfiles.abrirInsercionRf1).not.toHaveBeenCalled();
  });

  it('rechaza si la resolución cambia después de la vista previa confirmada', async () => {
    const { servicio, perfiles, vistaPrevia } = crearDependencias({ enabled: true });
    const confirmado = await servicio.prepararConfirmacion(SOLICITUD, [VISTA_LISTA]);
    vistaPrevia.ejecutar.mockResolvedValueOnce([
      {
        ...VISTA_LISTA,
        resolution: { ...VISTA_LISTA.resolution!, idProveedor: 'PROV-DISTINTO' },
      },
    ]);

    await expect(servicio.ejecutar(SOLICITUD, confirmado.confirmationToken!)).rejects.toMatchObject(
      {
        code: 'RF1_CONFIRMATION_INVALID',
        statusCode: 409,
      },
    );
    expect(perfiles.abrirInsercionRf1).not.toHaveBeenCalled();
  });

  it('rechaza si el destino o la revisión del perfil cambia tras confirmar', async () => {
    const { servicio, perfiles } = crearDependencias({ enabled: true });
    const confirmado = await servicio.prepararConfirmacion(SOLICITUD, [VISTA_LISTA]);
    perfiles.listar.mockResolvedValue([
      { ...PERFIL_ACTIVO, updatedAt: new Date('2026-11-22T11:01:00.000Z') },
    ]);

    await expect(servicio.ejecutar(SOLICITUD, confirmado.confirmationToken!)).rejects.toMatchObject(
      {
        code: 'RF1_CONFIRMATION_INVALID',
        statusCode: 409,
      },
    );
    expect(perfiles.abrirInsercionRf1).not.toHaveBeenCalled();
  });

  it('revierte la factura si el perfil cambia justo antes del INSERT', async () => {
    const { servicio, perfiles, insertar } = crearDependencias({ enabled: true });
    const confirmado = await servicio.prepararConfirmacion(SOLICITUD, [VISTA_LISTA]);
    perfiles.listar
      .mockResolvedValueOnce([PERFIL_ACTIVO])
      .mockResolvedValueOnce([
        { ...PERFIL_ACTIVO, updatedAt: new Date('2026-11-22T11:01:00.000Z') },
      ]);

    await expect(servicio.ejecutar(SOLICITUD, confirmado.confirmationToken!)).resolves.toEqual([
      { status: 'RECHAZADA', errorCode: 'RF1_PROFILE_CHANGED' },
    ]);
    expect(insertar).toHaveBeenCalledOnce();
  });

  it('vuelve a consultar permiso justo antes del DML y no escribe tras una revocación', async () => {
    const { servicio, insertar, cerrar, auditoria } = crearDependencias({
      enabled: true,
      revocarAntesDml: true,
    });
    const confirmado = await servicio.prepararConfirmacion(SOLICITUD, [VISTA_LISTA]);

    await expect(servicio.ejecutar(SOLICITUD, confirmado.confirmationToken!)).resolves.toEqual([
      { status: 'RECHAZADA', errorCode: 'RF1_ACCESS_REVOKED' },
    ]);

    expect(insertar).toHaveBeenCalledOnce();
    expect(cerrar).toHaveBeenCalledOnce();
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RF1_INSERTION_COMPLETED', outcome: 'FAILURE' }),
    );
  });
});
