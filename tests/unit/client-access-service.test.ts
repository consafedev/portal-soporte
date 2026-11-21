import { describe, expect, it, vi } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  asignacionClienteAdminSchema,
  establecerCapacidadClienteSchema,
  estadoCapacidadClienteAdminSchema,
} from '../../packages/contracts/src/clients.js';
import {
  ServicioAccesoCliente,
  ErrorAccesoCliente,
} from '../../apps/api/src/clients/client-access-service.js';
import type {
  EstadoAutorizacionCliente,
  RepositorioAccesoCliente,
} from '../../packages/core/src/clients/client-access-ports.js';
import type { ActorAdministracionClientes } from '../../packages/core/src/clients/ports.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const SUPPORT_ID = '00000000-0000-4000-8000-000000000002';
const CLIENT_ID = '00000000-0000-4000-8000-000000000003';
const REQUEST_ID = 'solicitud-prueba-001';

const actorAdmin: ActorAdministracionClientes = { actorUserId: ADMIN_ID, requestId: REQUEST_ID };
const actorSupport = { actorUserId: SUPPORT_ID, requestId: REQUEST_ID };

const clienteActivo = {
  id: CLIENT_ID,
  nombre: 'Cliente sintético',
  estado: 'ACTIVE' as const,
};

const usuarioAdminActivo = { role: 'ADMIN' as const, status: 'ACTIVE' as const };
const usuarioSupportActivo = { role: 'SUPPORT' as const, status: 'ACTIVE' as const };

/** Crea la autorización actual sintética que consultaría PostgreSQL en producción. */
function crearEstadoAutorizacion(
  ajustes: Partial<EstadoAutorizacionCliente> = {},
): EstadoAutorizacionCliente {
  return {
    usuario: usuarioSupportActivo,
    estadoCliente: 'ACTIVE',
    capacidadHabilitada: true,
    asignacionVigente: true,
    ...ajustes,
  };
}

/** Construye el servicio con repositorio aislado y respuestas configurables por prueba. */
function crearServicio(ajustes: Partial<RepositorioAccesoCliente> = {}): {
  readonly servicio: ServicioAccesoCliente;
  readonly repositorio: RepositorioAccesoCliente;
} {
  const repositorio = {
    buscarUsuarioActual: vi.fn(async (id: string) =>
      id === ADMIN_ID ? usuarioAdminActivo : usuarioSupportActivo,
    ),
    listarClientesGlobales: vi.fn(async () => [clienteActivo]),
    listarClientesAsignados: vi.fn(async () => [clienteActivo]),
    listarAsignaciones: vi.fn(async () => []),
    conceder: vi.fn(async () => ({ kind: 'CREATED' as const })),
    revocar: vi.fn(async () => 'REVOKED' as const),
    establecerCapacidad: vi.fn(async () => true),
    consultarEstadoAutorizacion: vi.fn(async () => crearEstadoAutorizacion()),
    ...ajustes,
  } as unknown as RepositorioAccesoCliente;

  return { servicio: new ServicioAccesoCliente(repositorio), repositorio };
}

/** Comprueba que ADMIN conserve el catálogo global y SUPPORT reciba solo asignaciones. */
async function probarListasPorRol(): Promise<void> {
  const { servicio, repositorio } = crearServicio();

  await expect(servicio.listarClientes(actorAdmin)).resolves.toEqual([clienteActivo]);
  await expect(servicio.listarClientes(actorSupport)).resolves.toEqual([clienteActivo]);

  expect(repositorio.listarClientesGlobales).toHaveBeenCalledWith(ADMIN_ID);
  expect(repositorio.listarClientesAsignados).toHaveBeenCalledWith(SUPPORT_ID);
}

/** Comprueba que una sesión ADMIN deba consultar cliente activo y capacidad de lectura. */
async function probarAdminRequiereCapacidadPorCliente(): Promise<void> {
  const { servicio, repositorio } = crearServicio({
    consultarEstadoAutorizacion: vi.fn(async () =>
      crearEstadoAutorizacion({
        usuario: usuarioAdminActivo,
        asignacionVigente: false,
      }),
    ),
  });

  await expect(servicio.exigir(actorAdmin, CLIENT_ID, 'rf-1:read')).resolves.toBeUndefined();
  expect(repositorio.consultarEstadoAutorizacion).toHaveBeenCalledWith(
    ADMIN_ID,
    CLIENT_ID,
    'rf-1:read',
  );
}

/** Comprueba que SUPPORT requiere una asignación vigente, cliente activo y permiso de lectura. */
async function probarSupportAutorizado(): Promise<void> {
  const { servicio } = crearServicio();

  await expect(servicio.exigir(actorSupport, CLIENT_ID, 'rf-1:read')).resolves.toBeUndefined();
}

/** Deniega el acceso SUPPORT si falta asignación, capacidad, usuario activo o cliente activo. */
async function probarDenegacionesDeAcceso(): Promise<void> {
  const estadosDenegados: readonly Partial<EstadoAutorizacionCliente>[] = [
    { asignacionVigente: false },
    { capacidadHabilitada: false },
    { estadoCliente: 'DISABLED' },
    { usuario: { role: 'SUPPORT', status: 'DISABLED' } },
    { usuario: null },
  ];

  for (const estado of estadosDenegados) {
    const { servicio } = crearServicio({
      consultarEstadoAutorizacion: vi.fn(async () => crearEstadoAutorizacion(estado)),
    });
    await expect(servicio.exigir(actorSupport, CLIENT_ID, 'rf-1:read')).rejects.toMatchObject({
      code: 'CLIENT_ACCESS_DENIED',
      statusCode: 403,
    });
  }
}

/** Confirma que ADMIN tampoco evita el estado del cliente ni el capability guard. */
async function probarAdminDenegadoSinCapacidad(): Promise<void> {
  const { servicio } = crearServicio({
    consultarEstadoAutorizacion: vi.fn(async () =>
      crearEstadoAutorizacion({
        usuario: usuarioAdminActivo,
        estadoCliente: 'ACTIVE',
        capacidadHabilitada: false,
      }),
    ),
  });

  await expect(servicio.exigir(actorAdmin, CLIENT_ID, 'rf-1:read')).rejects.toMatchObject({
    code: 'CLIENT_ACCESS_DENIED',
    statusCode: 403,
  });
}

/** Mantiene RF-1 execute apagado y rechaza cualquier capacidad no allowlisted. */
async function probarCapacidadesNoEjecutables(): Promise<void> {
  const { servicio, repositorio } = crearServicio();

  await expect(
    servicio.establecerCapacidad(CLIENT_ID, 'rf-1:execute', true, actorAdmin),
  ).rejects.toBeInstanceOf(ErrorAccesoCliente);
  await expect(servicio.exigir(actorSupport, CLIENT_ID, 'rf-1:execute')).rejects.toMatchObject({
    code: 'CLIENT_ACCESS_DENIED',
    statusCode: 403,
  });
  await expect(
    servicio.establecerCapacidad(CLIENT_ID, 'rf-1:unknown' as never, true, actorAdmin),
  ).rejects.toMatchObject({ code: 'CAPABILITY_UNKNOWN', statusCode: 400 });
  expect(repositorio.establecerCapacidad).not.toHaveBeenCalled();
}

/** Requiere usuario ADMIN activo antes de permitir la administración del catálogo. */
async function probarMutacionesSoloAdminActivo(): Promise<void> {
  const { servicio, repositorio } = crearServicio({
    buscarUsuarioActual: vi.fn(async () => usuarioSupportActivo),
  });

  await expect(servicio.conceder(CLIENT_ID, SUPPORT_ID, actorAdmin)).rejects.toMatchObject({
    code: 'CLIENT_ACCESS_DENIED',
    statusCode: 403,
  });
  expect(repositorio.conceder).not.toHaveBeenCalled();
}

/** Permite crear un nuevo historial de concesión después de una revocación. */
async function probarReasignacionTrasRevocacion(): Promise<void> {
  const { servicio, repositorio } = crearServicio({
    conceder: vi.fn(async () => 'CREATED' as const),
  });

  await servicio.revocar(CLIENT_ID, SUPPORT_ID, actorAdmin);
  await expect(servicio.conceder(CLIENT_ID, SUPPORT_ID, actorAdmin)).resolves.toBeUndefined();
  expect(repositorio.revocar).toHaveBeenCalledWith(CLIENT_ID, SUPPORT_ID, actorAdmin);
  expect(repositorio.conceder).toHaveBeenCalledWith(CLIENT_ID, SUPPORT_ID, actorAdmin);
}

/** Rechaza identificadores con formato inválido antes de consultar persistencia. */
async function probarValidacionDeIdentificadores(): Promise<void> {
  const { servicio, repositorio } = crearServicio();

  await expect(servicio.exigir(actorSupport, 'not-a-uuid', 'rf-1:read')).rejects.toMatchObject({
    code: 'INPUT_INVALID',
    statusCode: 400,
  });
  expect(repositorio.consultarEstadoAutorizacion).not.toHaveBeenCalled();
}

/** Comprueba que los contratos excluyan secretos y que execute solo se represente apagada. */
function probarContratosRedactados(): void {
  const instante = '2026-11-21T12:00:00.000Z';
  const asignacionValida = {
    userId: SUPPORT_ID,
    displayName: 'Soporte sintético',
    userActive: true,
    grantedAt: instante,
    revokedAt: null,
  };

  expect(Value.Check(asignacionClienteAdminSchema, asignacionValida)).toBe(true);
  expect(
    Value.Check(asignacionClienteAdminSchema, { ...asignacionValida, email: 'user@example.test' }),
  ).toBe(false);
  expect(
    Value.Check(establecerCapacidadClienteSchema, { enabled: true, clientId: CLIENT_ID }),
  ).toBe(false);
  expect(
    Value.Check(estadoCapacidadClienteAdminSchema, {
      clientId: CLIENT_ID,
      capabilityId: 'rf-1:read',
      enabled: true,
      changedAt: instante,
    }),
  ).toBe(true);
  expect(
    Value.Check(estadoCapacidadClienteAdminSchema, {
      clientId: CLIENT_ID,
      capabilityId: 'rf-1:execute',
      enabled: true,
      changedAt: instante,
    }),
  ).toBe(false);
}

/** Define la suite de autorización por cliente con repositorios aislados. */
function definirPruebasAccesoCliente(): void {
  it('lista el catálogo global a ADMIN y las asignaciones actuales a SUPPORT', probarListasPorRol);
  it('exige cliente activo y rf-1:read incluso para ADMIN', probarAdminRequiereCapacidadPorCliente);
  it('permite a SUPPORT asignado usar lectura habilitada', probarSupportAutorizado);
  it('deniega SUPPORT sin asignación, capacidad o estado vigente', probarDenegacionesDeAcceso);
  it('deniega RF-1 a ADMIN si falta la capacidad del cliente', probarAdminDenegadoSinCapacidad);
  it('rechaza execute y capacidades desconocidas', probarCapacidadesNoEjecutables);
  it('exige un ADMIN activo para conceder acceso', probarMutacionesSoloAdminActivo);
  it(
    'permite reactivar el historial tras revocar el acceso anterior',
    probarReasignacionTrasRevocacion,
  );
  it('valida UUID antes de consultar el repositorio', probarValidacionDeIdentificadores);
  it(
    'mantiene DTO redactados y rf-1:execute deshabilitada en los contratos',
    probarContratosRedactados,
  );
}

describe('servicio de acceso al cliente y capacidades', definirPruebasAccesoCliente);
