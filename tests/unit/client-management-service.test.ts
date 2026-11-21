import { describe, expect, it, vi } from 'vitest';
import {
  ServicioClientesPortal,
  type ActorAdministracionClientes,
} from '../../apps/api/src/clients/client-management-service.js';
import type {
  AmbienteSapCliente,
  ClientePortal,
  RepositorioClientes,
} from '../../packages/core/src/clients/ports.js';

const actor: ActorAdministracionClientes = {
  actorUserId: '00000000-0000-4000-8000-000000000001',
  requestId: 'request-sintetico-1',
};
const instante = new Date('2026-11-20T21:00:00.000Z');

/** Construye el servicio con un repositorio sintético verificable por cada escenario. */
function crearServicio(repositorio: RepositorioClientes): ServicioClientesPortal {
  return new ServicioClientesPortal(repositorio, { ahora: () => instante }, () => 'id-sintetico');
}

describe('ServicioClientesPortal', () => {
  it('recorta el nombre visible al crear un cliente', async () => {
    const repositorio: RepositorioClientes = {
      listar: vi.fn(async () => []),
      crear: vi.fn(async (entrada) => clienteDesdeEntrada(entrada.nombre)),
      actualizar: vi.fn(),
      listarAmbientesSap: vi.fn(async () => []),
      crearAmbienteSap: vi.fn(),
      actualizarAmbienteSap: vi.fn(),
    };

    const resultado = await crearServicio(repositorio).crear(
      { nombre: '  Cliente sintético  ' },
      actor,
    );

    expect(resultado.nombre).toBe('Cliente sintético');
    expect(repositorio.crear).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'Cliente sintético', id: 'id-sintetico' }),
      actor,
    );
  });

  it('normaliza el código SAP y conserva el entorno dentro de su cliente', async () => {
    const ambiente: AmbienteSapCliente = {
      id: 'ambiente-sintetico',
      clientId: 'cliente-sintetico',
      codigo: 'QAS_NORTE',
      nombre: 'Calidad norte',
      estado: 'ACTIVE',
      createdAt: instante,
      updatedAt: instante,
    };
    const repositorio: RepositorioClientes = {
      listar: vi.fn(async () => []),
      crear: vi.fn(),
      actualizar: vi.fn(),
      listarAmbientesSap: vi.fn(async () => [ambiente]),
      crearAmbienteSap: vi.fn(async (_clientId, entrada) => ({
        kind: 'CREATED' as const,
        ambiente: { ...ambiente, codigo: entrada.codigo },
      })),
      actualizarAmbienteSap: vi.fn(),
    };

    const resultado = await crearServicio(repositorio).crearAmbienteSap(
      'cliente-sintetico',
      { codigo: 'qas_norte', nombre: 'Calidad norte' },
      actor,
    );

    expect(resultado.codigo).toBe('QAS_NORTE');
    expect(repositorio.crearAmbienteSap).toHaveBeenCalledWith(
      'cliente-sintetico',
      expect.objectContaining({ codigo: 'QAS_NORTE' }),
      actor,
    );
  });

  it('rechaza códigos SAP que permitirían ambigüedad en sus identificadores', async () => {
    const repositorio: RepositorioClientes = {
      listar: vi.fn(async () => []),
      crear: vi.fn(),
      actualizar: vi.fn(),
      listarAmbientesSap: vi.fn(async () => []),
      crearAmbienteSap: vi.fn(),
      actualizarAmbienteSap: vi.fn(),
    };

    await expect(
      crearServicio(repositorio).crearAmbienteSap(
        'cliente-sintetico',
        { codigo: '../prod', nombre: 'Producción' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'SAP_ENVIRONMENT_CODE_INVALID' });
    expect(repositorio.crearAmbienteSap).not.toHaveBeenCalled();
  });

  it('devuelve un conflicto estable si el código ya existe para ese cliente', async () => {
    const repositorio: RepositorioClientes = {
      listar: vi.fn(async () => []),
      crear: vi.fn(),
      actualizar: vi.fn(),
      listarAmbientesSap: vi.fn(async () => []),
      crearAmbienteSap: vi.fn(async () => ({ kind: 'DUPLICATE' as const })),
      actualizarAmbienteSap: vi.fn(),
    };

    await expect(
      crearServicio(repositorio).crearAmbienteSap(
        'cliente-sintetico',
        { codigo: 'PRD', nombre: 'Producción' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'SAP_ENVIRONMENT_DUPLICATE' });
  });
});

/** Forma una entidad sintética para que el mock devuelva el contrato público completo. */
function clienteDesdeEntrada(nombre: string): ClientePortal {
  return {
    id: 'id-sintetico',
    nombre,
    estado: 'ACTIVE',
    createdAt: instante,
    updatedAt: instante,
  };
}
