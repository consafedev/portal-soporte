import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  concederAccesoCliente,
  establecerCapacidadCliente,
  listarAsignacionesCliente,
  listarAmbientesSapCliente,
  listarClientesAutorizados,
  listarPerfilesConexionCliente,
  revocarAccesoCliente,
} from '../../apps/web/src/lib/client-access-api.js';

const CLIENT_ID = '35b77fcb-0bf8-4d88-8b81-187dd30d5101';
const USER_ID = '51bd52f6-d40d-4590-9f81-d7041729b5dd';
const CSRF = 'a'.repeat(43);
const fetchMock = vi.fn<typeof fetch>();

/** Construye una respuesta JSON sintética con el estado HTTP solicitado. */
function crearRespuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  });
}

/** Devuelve los encabezados mínimos para que los tests no dependan de servicios externos. */
function crearRespuestaCsrf(): Response {
  return crearRespuestaJson({ token: CSRF });
}

describe('cliente HTTP same-origin para permisos de cliente', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('consulta clientes autorizados con cookie same-origin y caché privada', async () => {
    const clientes = [{ id: CLIENT_ID, nombre: 'Cliente de prueba', estado: 'ACTIVE' }];
    fetchMock.mockResolvedValueOnce(crearRespuestaJson(clientes));

    await expect(listarClientesAutorizados()).resolves.toEqual(clientes);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/clients', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
  });

  it('consulta ambientes autorizados por cliente y valida la pertenencia del DTO', async () => {
    const ambientes = [
      {
        id: USER_ID,
        clientId: CLIENT_ID,
        codigo: 'QA-01',
        nombre: 'Ambiente de pruebas',
        estado: 'ACTIVE',
        createdAt: '2026-11-21T12:00:00Z',
        updatedAt: '2026-11-21T12:00:00Z',
      },
    ];
    fetchMock.mockResolvedValueOnce(crearRespuestaJson(ambientes));

    await expect(listarAmbientesSapCliente(CLIENT_ID)).resolves.toEqual(ambientes);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/clients/${CLIENT_ID}/sap-environments`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
  });

  it('consulta perfiles redactados sin aceptar sobres cifrados ni datos de destino', async () => {
    const perfil = {
      id: USER_ID,
      clientId: CLIENT_ID,
      nombre: 'Conexión de laboratorio',
      tipo: 'MYSQL_TCP',
      entorno: 'TEST',
      estado: 'ACTIVE',
    };
    fetchMock.mockResolvedValueOnce(crearRespuestaJson([perfil]));

    await expect(listarPerfilesConexionCliente(CLIENT_ID)).resolves.toEqual([perfil]);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/clients/${CLIENT_ID}/connection-profiles`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });

    fetchMock.mockResolvedValueOnce(
      crearRespuestaJson([{ ...perfil, secretEnvelope: { ciphertext: 'secreto' } }]),
    );
    await expect(listarPerfilesConexionCliente(CLIENT_ID)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('valida el resumen de acceso y no acepta campos de correo o secretos', async () => {
    fetchMock.mockResolvedValueOnce(
      crearRespuestaJson({ asignaciones: [], capacidades: [], email: 'no-visible@example.test' }),
    );

    await expect(listarAsignacionesCliente(CLIENT_ID)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('consulta asignaciones mediante la ruta administrativa codificada', async () => {
    const acceso = { asignaciones: [], capacidades: [] };
    fetchMock.mockResolvedValueOnce(crearRespuestaJson(acceso));

    await expect(listarAsignacionesCliente(CLIENT_ID)).resolves.toEqual(acceso);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/admin/clients/${encodeURIComponent(CLIENT_ID)}/access`,
      { method: 'GET', credentials: 'same-origin', cache: 'no-store' },
    );
  });

  it('protege concesiones y revocaciones con un CSRF nuevo y respuesta vacía', async () => {
    fetchMock
      .mockResolvedValueOnce(crearRespuestaCsrf())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(crearRespuestaCsrf())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await concederAccesoCliente(CLIENT_ID, USER_ID);
    await revocarAccesoCliente(CLIENT_ID, USER_ID);

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/admin/clients/${CLIENT_ID}/access/users/${USER_ID}`,
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'x-csrf-token': CSRF },
    });
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      method: 'DELETE',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'x-csrf-token': CSRF },
    });
  });

  it('envía solo el estado de capacidad permitido con CSRF', async () => {
    fetchMock
      .mockResolvedValueOnce(crearRespuestaCsrf())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await establecerCapacidadCliente(CLIENT_ID, 'rf-1:read', true);

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/admin/clients/${CLIENT_ID}/capabilities/rf-1%3Aread`,
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-csrf-token': CSRF },
      body: JSON.stringify({ enabled: true }),
    });
  });

  it('permite solicitar rf-1:execute con CSRF al endpoint ADMIN protegido', async () => {
    fetchMock
      .mockResolvedValueOnce(crearRespuestaCsrf())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await establecerCapacidadCliente(CLIENT_ID, 'rf-1:execute', false);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/admin/clients/${CLIENT_ID}/capabilities/rf-1%3Aexecute`,
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
      headers: { 'content-type': 'application/json', 'x-csrf-token': CSRF },
    });
  });

  it('traduce denegación sin conservar mensajes arbitrarios del servidor', async () => {
    fetchMock.mockResolvedValueOnce(
      crearRespuestaJson(
        { code: 'CLIENT_ACCESS_DENIED', message: 'detalle_conexion_no_publicable' },
        403,
      ),
    );

    await expect(listarClientesAutorizados()).rejects.toMatchObject({
      status: 403,
      message: expect.not.stringContaining('detalle_conexion_no_publicable'),
    });
  });
});
