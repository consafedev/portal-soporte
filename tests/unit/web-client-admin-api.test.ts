import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorApiClientes,
  crearClienteAdmin,
  probarPerfilConexionAdmin,
} from '../../apps/web/src/lib/client-admin-api.js';

const CLIENT_ID = '35b77fcb-0bf8-4d88-8b81-187dd30d5101';
const PROFILE_ID = '756d0604-b994-433b-b103-1e881ea908e7';
const CSRF = 'a'.repeat(43);
const fetchMock = vi.fn<typeof fetch>();

/** Construye una respuesta JSON sintética para validar el cliente HTTP sin servicios externos. */
function crearRespuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  });
}

/** Prepara y limpia el fetch simulado para aislar cada prueba del cliente administrativo. */
function configurarFetchSimulado(): void {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
}

/** Elimina el fetch global simulado al terminar cada prueba unitaria. */
function limpiarFetchSimulado(): void {
  vi.unstubAllGlobals();
}

describe('mensajes de error del cliente administrativo', () => {
  it('no presenta el endpoint del perfil como una allowlist del servidor', () => {
    const error = new ErrorApiClientes('DESTINATION_NOT_ALLOWED', 422);

    expect(error.message).toBe(
      'El perfil no tiene un destino completo o no está disponible para esta operación.',
    );
    expect(error.message).not.toContain('configuración del servidor');
  });
});

describe('prueba de perfil de conexión administrativa', () => {
  beforeEach(configurarFetchSimulado);
  afterEach(limpiarFetchSimulado);

  it('envía POST con CSRF y omite JSON cuando la operación no tiene cuerpo', async () => {
    fetchMock
      .mockResolvedValueOnce(crearRespuestaJson({ token: CSRF }))
      .mockResolvedValueOnce(
        crearRespuestaJson({ code: 'CONNECTED', completedAt: '2026-11-24T00:00:00Z' }),
      );

    await expect(probarPerfilConexionAdmin(CLIENT_ID, PROFILE_ID)).resolves.toEqual({
      code: 'CONNECTED',
      completedAt: '2026-11-24T00:00:00Z',
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/admin/clients/${CLIENT_ID}/connection-profiles/${PROFILE_ID}/test`,
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'x-csrf-token': CSRF },
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).not.toHaveProperty('content-type');
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBeUndefined();
  });

  it('conserva JSON y CSRF en las mutaciones que sí envían datos', async () => {
    const solicitud = { nombre: 'Cliente sintético' };
    const respuesta = {
      id: CLIENT_ID,
      nombre: solicitud.nombre,
      estado: 'ACTIVE',
      createdAt: '2026-11-24T00:00:00Z',
      updatedAt: '2026-11-24T00:00:00Z',
    };
    fetchMock
      .mockResolvedValueOnce(crearRespuestaJson({ token: CSRF }))
      .mockResolvedValueOnce(crearRespuestaJson(respuesta, 201));

    await expect(crearClienteAdmin(solicitud)).resolves.toEqual(respuesta);

    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': CSRF },
      body: JSON.stringify(solicitud),
    });
  });
});
