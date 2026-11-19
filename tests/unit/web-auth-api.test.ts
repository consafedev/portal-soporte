import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  iniciarSesion,
  obtenerSesion,
  solicitarRecuperacion,
  crearUsuarioAdmin,
  ErrorApiAuth,
} from '../../apps/web/src/lib/auth-api.js';

const tokenCsrfSintetico = 'B'.repeat(43);
const usuarioSintetico = {
  id: '018f1000-0000-7000-8000-000000000001',
  username: 'admin_sintetico',
  displayName: 'Admin sintético',
  role: 'ADMIN' as const,
};

/** Crea una respuesta JSON local para simular solo el proxy same-origin. */
function respuestaJson(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('cliente same-origin de autenticación web', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('obtiene CSRF antes de login y envía credenciales solo por POST same-origin', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(respuestaJson({ token: tokenCsrfSintetico }))
      .mockResolvedValueOnce(respuestaJson({ user: usuarioSintetico }));
    vi.stubGlobal('fetch', fetch);

    await expect(iniciarSesion('admin_sintetico', 'Clave sintética segura')).resolves.toEqual(
      usuarioSintetico,
    );

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/auth/csrf', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ username: 'admin_sintetico', password: 'Clave sintética segura' }),
      }),
    );
    const opciones = fetch.mock.calls[1]?.[1];
    const encabezados = new Headers(opciones?.headers);
    expect(encabezados.get('content-type')).toBe('application/json');
    expect(encabezados.get('x-csrf-token')).toBe(tokenCsrfSintetico);
  });

  it('no envía recuperación fuera de la misma origen ni modifica el cuerpo genérico', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(respuestaJson({ token: tokenCsrfSintetico }))
      .mockResolvedValueOnce(respuestaJson({ accepted: true }, 202));
    vi.stubGlobal('fetch', fetch);

    await expect(solicitarRecuperacion('persona@example.test')).resolves.toEqual({
      accepted: true,
    });

    const [, solicitud] = fetch.mock.calls[1] ?? [];
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/v1/auth/recovery/request');
    expect(solicitud).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
  });

  it('expone un código estable y no guarda la respuesta sensible del servidor', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(respuestaJson({ token: tokenCsrfSintetico }))
      .mockResolvedValueOnce(
        respuestaJson({ code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas.' }, 401),
      );
    vi.stubGlobal('fetch', fetch);

    const rechazo = await iniciarSesion('admin_sintetico', 'Clave equivocada sintética').then(
      () => null,
      (error: unknown) => error,
    );

    expect(rechazo).toBeInstanceOf(ErrorApiAuth);
    expect(rechazo).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    expect(rechazo instanceof Error ? rechazo.message : '').not.toContain(
      'Clave equivocada sintética',
    );
  });

  it('rechaza respuestas de sesión con campos no permitidos sin exponerlos', async () => {
    const secretoSintetico = 'secreto-de-respuesta-sintetico';
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
        respuestaJson({
          user: { ...usuarioSintetico, password: secretoSintetico },
        }),
      ),
    );

    const rechazo = await obtenerSesion().then(
      () => null,
      (error: unknown) => error,
    );

    expect(rechazo).toBeInstanceOf(ErrorApiAuth);
    expect(rechazo).toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
    expect(rechazo instanceof Error ? rechazo.message : '').not.toContain(secretoSintetico);
  });

  it(
    'conserva la cuenta creada para cualquier estado de entrega bajo HTTP 201',
    pruebaResultadosAlta,
  );

  it('trata 429 y 503 del alta como errores previos a una cuenta creada', async () => {
    for (const caso of [
      { status: 429, code: 'RATE_LIMITED' },
      { status: 503, code: 'ADMIN_OPERATION_FAILED' },
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValueOnce(respuestaJson({ token: tokenCsrfSintetico }))
          .mockResolvedValueOnce(
            respuestaJson({ code: caso.code, message: 'Solicitud no completada.' }, caso.status),
          ),
      );

      await expect(
        crearUsuarioAdmin({
          username: 'support_sintetico',
          email: 'support@example.test',
          displayName: 'Soporte sintético',
          role: 'SUPPORT',
        }),
      ).rejects.toMatchObject({ code: caso.code, status: caso.status });
    }
  });
});

/** Comprueba que el cliente preserve el DTO para los estados de invitación bajo HTTP 201. */
async function pruebaResultadosAlta(): Promise<void> {
  const usuarioPendiente = {
    ...usuarioSintetico,
    role: 'SUPPORT' as const,
    email: 'support@example.test',
    emailVerifiedAt: null,
    status: 'PENDING_ACTIVATION' as const,
    hasPassword: false,
    createdAt: '2026-11-18T00:00:00.000Z',
  };
  const estados = ['ACCEPTED', 'RATE_LIMITED', 'DELIVERY_FAILED'] as const;

  for (const invitationStatus of estados) {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(respuestaJson({ token: tokenCsrfSintetico }))
      .mockResolvedValueOnce(respuestaJson({ user: usuarioPendiente, invitationStatus }, 201));
    vi.stubGlobal('fetch', fetch);

    await expect(
      crearUsuarioAdmin({
        username: usuarioPendiente.username,
        email: usuarioPendiente.email,
        displayName: usuarioPendiente.displayName,
        role: 'SUPPORT',
      }),
    ).resolves.toMatchObject({
      user: usuarioPendiente,
      invitationStatus,
    });
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/v1/admin/users');
  }
}
