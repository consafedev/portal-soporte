import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  EscritorAuditoriaAuth,
  RelojAuth,
  ServicioCorreoAuth,
} from '../../packages/core/src/auth/ports.js';
import type {
  CuentaCredencialesAuth,
  LimitadorIntentosAuth,
  RepositorioCredencialesAuth,
} from '../../packages/core/src/auth/recovery-ports.js';
import { ErrorRepositorioUsuariosAdmin } from '../../packages/core/src/auth/admin-ports.js';
import {
  ServicioRecuperacionAuth,
  type DependenciasRecuperacionAuth,
} from '../../apps/api/src/auth/recovery-service.js';
import {
  AdaptadorCorreoSmtp,
  crearEnlaceCorreoAuth,
  type TransporteCorreoAuth,
} from '../../apps/api/src/auth/mailer.js';

const ahora = new Date('2026-11-18T06:00:00.000Z');
const tokenSintetico = 'A'.repeat(43);
const correoSintetico = 'support@example.test';
const hashSintetico = '$argon2id$v=19$m=19456,p=1,t=2$hash-sintetico';

/** Reloj UTC fijo para que expiración y auditoría sean deterministas. */
const reloj: RelojAuth = {
  /** Devuelve el instante sintético sin exponer credenciales ni estado mutable. */
  ahora: () => new Date(ahora),
};

/** Construye dependencias controladas sin conectarse a servicios externos. */
function crearDependencias(
  sobreescrituras: Partial<DependenciasRecuperacionAuth> = {},
): DependenciasRecuperacionAuth {
  const cuenta = {
    id: '018f1000-0000-7000-8000-000000000001',
    usernameNormalized: 'support_sintetico',
    email: correoSintetico,
    emailNormalized: correoSintetico,
    emailVerifiedAt: new Date(ahora),
    passwordHash: hashSintetico,
    role: 'SUPPORT' as const,
    status: 'ACTIVE' as const,
  };
  const repositorio: RepositorioCredencialesAuth = {
    buscarCuentaPorCorreo: vi.fn(async (email) => (email === correoSintetico ? cuenta : null)),
    buscarCuentaPorId: vi.fn(async (id) => (id === cuenta.id ? cuenta : null)),
    crearToken: vi.fn(async () => true),
    consumirToken: vi.fn(async () => true),
    cambiarContrasena: vi.fn(async () => true),
  };
  const correo: ServicioCorreoAuth = { enviar: vi.fn(async () => undefined) };
  const limitador: LimitadorIntentosAuth = {
    registrarIntento: vi.fn(async () => true),
    descontarReservaExitosa: vi.fn(async () => undefined),
  };
  const auditoria: EscritorAuditoriaAuth = { registrar: vi.fn(async () => undefined) };
  const hasheador = {
    hash: vi.fn(async () => hashSintetico),
    verificar: vi.fn(
      async (_hash: string, contrasena: string) => contrasena === 'Clave actual sintética',
    ),
  };
  const sesiones = {
    preparar: vi.fn((userId: string) => ({
      registro: {
        id: '018f1000-0000-7000-8000-000000000002',
        userId,
        tokenHash: 'a'.repeat(64),
        createdAt: ahora,
        lastUsedAt: ahora,
        idleExpiresAt: new Date(ahora.getTime() + 30 * 60_000),
        absoluteExpiresAt: new Date(ahora.getTime() + 8 * 60 * 60_000),
      },
      credencial: {
        sessionId: '018f1000-0000-7000-8000-000000000002',
        token: tokenSintetico,
        idleExpiresAt: new Date(ahora.getTime() + 30 * 60_000),
        absoluteExpiresAt: new Date(ahora.getTime() + 8 * 60 * 60_000),
      },
    })),
  };

  return {
    repositorio,
    correo,
    correoHabilitado: true,
    limitador,
    auditoria,
    hasheador,
    sesiones,
    reloj,
    publicAppOrigin: 'https://portal.example.test',
    ...sobreescrituras,
  } as DependenciasRecuperacionAuth;
}

/** Construye una invitación sin contraseña para probar sus resultados de entrega. */
function crearCuentaInvitada(): CuentaCredencialesAuth {
  return {
    id: '018f1000-0000-7000-8000-000000000003',
    usernameNormalized: 'invitado_sintetico',
    email: 'invite@example.test',
    emailNormalized: 'invite@example.test',
    emailVerifiedAt: null,
    passwordHash: null,
    role: 'SUPPORT',
    status: 'PENDING_ACTIVATION',
  };
}

describe('recuperación de credenciales del portal', () => {
  it('deshabilita recuperación sin guardar tokens si no hay SMTP', async () => {
    const dependencias = crearDependencias({ correoHabilitado: false });
    const servicio = new ServicioRecuperacionAuth(dependencias);

    await expect(
      servicio.solicitarRecuperacion(correoSintetico, '127.0.0.1', 'req-smtp-off'),
    ).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_DISABLED', statusCode: 503 });
    expect(dependencias.repositorio.crearToken).not.toHaveBeenCalled();
    expect(dependencias.repositorio.buscarCuentaPorCorreo).not.toHaveBeenCalled();
  });

  it('genera enlaces desde el origen configurado y mantiene el token solo en el fragmento', () => {
    const enlace = crearEnlaceCorreoAuth(
      'https://portal.example.test',
      'PASSWORD_RECOVERY',
      tokenSintetico,
    );
    const url = new URL(enlace);

    expect(url.origin).toBe('https://portal.example.test');
    expect(url.pathname).toBe('/recover-access/complete');
    expect(url.search).toBe('');
    expect(url.hash).toContain(`token=${tokenSintetico}`);
    expect(url.hash).toContain('flow=recovery');
  });

  it('responde igual para correos conocidos y desconocidos y nunca devuelve el token', async () => {
    const dependencias = crearDependencias();
    const servicio = new ServicioRecuperacionAuth(dependencias);
    const conocida = await servicio.solicitarRecuperacion(
      correoSintetico,
      '127.0.0.1',
      'req-known',
    );
    const desconocida = await servicio.solicitarRecuperacion(
      'missing@example.test',
      '127.0.0.1',
      'req-missing',
    );

    expect(conocida).toBe('ACEPTADA');
    expect(desconocida).toBe('ACEPTADA');
    expect(dependencias.correo.enviar).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([conocida, desconocida])).not.toContain(tokenSintetico);
  });

  it('solo envía recuperación al correo verificado y persiste el digest del token', async () => {
    const dependencias = crearDependencias();
    const servicio = new ServicioRecuperacionAuth(dependencias);

    await servicio.solicitarRecuperacion(correoSintetico, '127.0.0.1', 'req-recovery');

    const entrada = vi.mocked(dependencias.repositorio.crearToken).mock.calls[0]?.[0];
    const mensaje = vi.mocked(dependencias.correo.enviar).mock.calls[0]?.[0];
    expect(entrada).toMatchObject({ purpose: 'PASSWORD_RECOVERY', targetEmail: null });
    expect(entrada?.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(entrada?.tokenHash).not.toBe(tokenSintetico);
    expect(mensaje?.enlace).toContain('#flow=recovery&token=');
    expect(new URL(mensaje?.enlace ?? 'https://portal.example.test').search).toBe('');
    expect(entrada?.tokenHash).toBe(
      createHash('sha256')
        .update(mensaje?.enlace.split('token=')[1] ?? '')
        .digest('hex'),
    );
  });

  it('conserva la aceptación pública y omite el correo si ya cambió la cuenta destinataria', async () => {
    const dependencias = crearDependencias();
    vi.mocked(dependencias.repositorio.crearToken).mockResolvedValue(false);
    const servicio = new ServicioRecuperacionAuth(dependencias);
    await expect(
      servicio.solicitarRecuperacion(correoSintetico, '127.0.0.1', 'req-obsoleta'),
    ).resolves.toBe('ACEPTADA');
    expect(dependencias.correo.enviar).not.toHaveBeenCalled();
  });

  it('mantiene la respuesta pública de recuperación si falla la entrega SMTP', async () => {
    const dependencias = crearDependencias();
    vi.mocked(dependencias.correo.enviar).mockRejectedValue(new Error('Fallo SMTP sintético.'));
    const servicio = new ServicioRecuperacionAuth(dependencias);

    await expect(
      servicio.solicitarRecuperacion(correoSintetico, '127.0.0.1', 'req-recovery-delivery'),
    ).resolves.toBe('ACEPTADA');
    expect(dependencias.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RECOVERY_DELIVERY_FAILED', outcome: 'FAILURE' }),
    );
  });

  it('devuelve DELIVERY_FAILED cuando no puede enviar una invitación recién persistida', async () => {
    const dependencias = crearDependencias();
    vi.mocked(dependencias.repositorio.buscarCuentaPorId).mockResolvedValue(crearCuentaInvitada());
    vi.mocked(dependencias.correo.enviar).mockRejectedValue(
      new Error(`SMTP sintético ${correoSintetico} ${tokenSintetico}`),
    );
    const servicio = new ServicioRecuperacionAuth(dependencias);

    const resultado = await servicio.solicitarInvitacion(
      '018f1000-0000-7000-8000-000000000003',
      {
        userId: '018f1000-0000-7000-8000-000000000001',
        role: 'ADMIN',
        sessionId: '018f1000-0000-7000-8000-000000000009',
      },
      '127.0.0.1',
      'req-invitation-delivery-failed',
    );

    expect(resultado).toBe('DELIVERY_FAILED');
    expect(dependencias.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RECOVERY_DELIVERY_FAILED', outcome: 'FAILURE' }),
    );
    expect(JSON.stringify(resultado)).not.toContain(tokenSintetico);
  });

  it('devuelve RATE_LIMITED y no intenta emitir ni entregar la invitación', async () => {
    const dependencias = crearDependencias();
    vi.mocked(dependencias.repositorio.buscarCuentaPorId).mockResolvedValue(crearCuentaInvitada());
    vi.mocked(dependencias.limitador.registrarIntento).mockResolvedValue(false);
    const servicio = new ServicioRecuperacionAuth(dependencias);

    const resultado = await servicio.solicitarInvitacion(
      '018f1000-0000-7000-8000-000000000003',
      {
        userId: '018f1000-0000-7000-8000-000000000001',
        role: 'ADMIN',
        sessionId: '018f1000-0000-7000-8000-000000000009',
      },
      '127.0.0.1',
      'req-invitation-limited',
    );

    expect(resultado).toBe('LIMITADA');
    expect(dependencias.repositorio.crearToken).not.toHaveBeenCalled();
    expect(dependencias.correo.enviar).not.toHaveBeenCalled();
  });

  it('no confirma un restablecimiento de una invitación cuyo correo falló', async () => {
    const dependencias = crearDependencias();
    vi.mocked(dependencias.repositorio.buscarCuentaPorId).mockResolvedValue(crearCuentaInvitada());
    vi.mocked(dependencias.correo.enviar).mockRejectedValue(new Error('Fallo SMTP sintético.'));
    const servicio = new ServicioRecuperacionAuth(dependencias);

    await expect(
      servicio.solicitarRestablecimientoAdmin(
        '018f1000-0000-7000-8000-000000000003',
        {
          userId: '018f1000-0000-7000-8000-000000000001',
          role: 'ADMIN',
          sessionId: '018f1000-0000-7000-8000-000000000009',
        },
        '127.0.0.1',
        'req-invitation-reset-delivery',
      ),
    ).resolves.toBe('DELIVERY_FAILED');
  });

  it('no distingue correos ocupados de libres al solicitar cambios administrativos', async () => {
    const dependencias = crearDependencias();
    const cuentaOcupante: CuentaCredencialesAuth = {
      id: '018f1000-0000-7000-8000-000000000004',
      usernameNormalized: 'otro_usuario',
      email: 'ocupado@example.test',
      emailNormalized: 'ocupado@example.test',
      emailVerifiedAt: new Date(ahora),
      passwordHash: hashSintetico,
      role: 'SUPPORT',
      status: 'ACTIVE',
    };
    vi.mocked(dependencias.repositorio.buscarCuentaPorCorreo).mockImplementation(async (email) =>
      email === cuentaOcupante.emailNormalized ? cuentaOcupante : null,
    );
    const servicio = new ServicioRecuperacionAuth(dependencias);

    const ocupado = await servicio.solicitarCambioCorreoAdmin(
      '018f1000-0000-7000-8000-000000000001',
      cuentaOcupante.email,
      {
        userId: '018f1000-0000-7000-8000-000000000002',
        role: 'ADMIN',
        sessionId: '018f1000-0000-7000-8000-000000000009',
      },
      '127.0.0.1',
      'req-email-occupied',
    );
    const libre = await servicio.solicitarCambioCorreoAdmin(
      '018f1000-0000-7000-8000-000000000001',
      'libre@example.test',
      {
        userId: '018f1000-0000-7000-8000-000000000002',
        role: 'ADMIN',
        sessionId: '018f1000-0000-7000-8000-000000000009',
      },
      '127.0.0.1',
      'req-email-free',
    );

    expect(ocupado).toBe('ACEPTADA');
    expect(libre).toBe(ocupado);
    expect(dependencias.correo.enviar).toHaveBeenCalledTimes(1);
  });

  it('no enumera correos ocupados al solicitar cambio propio de dirección', async () => {
    const dependencias = crearDependencias();
    const cuentaOcupante: CuentaCredencialesAuth = {
      id: '018f1000-0000-7000-8000-000000000004',
      usernameNormalized: 'otro_usuario',
      email: 'ocupado@example.test',
      emailNormalized: 'ocupado@example.test',
      emailVerifiedAt: new Date(ahora),
      passwordHash: hashSintetico,
      role: 'SUPPORT',
      status: 'ACTIVE',
    };
    vi.mocked(dependencias.repositorio.buscarCuentaPorCorreo).mockImplementation(async (email) =>
      email === cuentaOcupante.emailNormalized ? cuentaOcupante : null,
    );
    const servicio = new ServicioRecuperacionAuth(dependencias);

    await expect(
      servicio.solicitarCambioCorreo(
        '018f1000-0000-7000-8000-000000000001',
        'Clave actual sintética',
        cuentaOcupante.email,
        '127.0.0.1',
        'req-own-email-occupied',
      ),
    ).resolves.toBe('ACEPTADA');
    expect(dependencias.correo.enviar).not.toHaveBeenCalled();
  });

  it('oculta un correo ocupado si la unicidad cambia entre búsqueda y emisión del token', async () => {
    const dependencias = crearDependencias();
    vi.mocked(dependencias.repositorio.crearToken).mockRejectedValue(
      new ErrorRepositorioUsuariosAdmin('EMAIL_TAKEN'),
    );
    const servicio = new ServicioRecuperacionAuth(dependencias);

    await expect(
      servicio.solicitarCambioCorreoAdmin(
        '018f1000-0000-7000-8000-000000000001',
        'carrera@example.test',
        {
          userId: '018f1000-0000-7000-8000-000000000002',
          role: 'ADMIN',
          sessionId: '018f1000-0000-7000-8000-000000000009',
        },
        '127.0.0.1',
        'req-email-race',
      ),
    ).resolves.toBe('ACEPTADA');
    expect(dependencias.correo.enviar).not.toHaveBeenCalled();
  });

  it('no cambia una contraseña voluntaria si la contraseña actual es incorrecta', async () => {
    const dependencias = crearDependencias();
    const servicio = new ServicioRecuperacionAuth(dependencias);

    await expect(
      servicio.cambiarContrasena(
        '018f1000-0000-7000-8000-000000000001',
        'Actual equivocada sintética',
        'Nueva frase sintética suficientemente larga ñ',
        '127.0.0.1',
        'req-password-change',
      ),
    ).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' });

    expect(dependencias.repositorio.cambiarContrasena).not.toHaveBeenCalled();
    expect(dependencias.sesiones.preparar).not.toHaveBeenCalled();
  });

  it('requiere contraseña actual antes de emitir un enlace voluntario de cambio de correo', async () => {
    const dependencias = crearDependencias();
    const servicio = new ServicioRecuperacionAuth(dependencias);

    await expect(
      servicio.solicitarCambioCorreo(
        '018f1000-0000-7000-8000-000000000001',
        'Actual equivocada sintética',
        'nuevo@example.test',
        '127.0.0.1',
        'req-email-change',
      ),
    ).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' });

    expect(dependencias.repositorio.crearToken).not.toHaveBeenCalled();
    expect(dependencias.correo.enviar).not.toHaveBeenCalled();
  });

  it('redacta el error SMTP y no propaga su mensaje, destinatario ni enlace', async () => {
    const transporte: TransporteCorreoAuth = {
      enviar: vi.fn(async () => {
        throw new Error(`SMTP sintético ${correoSintetico} ${tokenSintetico}`);
      }),
    };
    const adaptador = new AdaptadorCorreoSmtp({ remitente: 'portal@example.test' }, transporte);
    const error = await adaptador
      .enviar({
        tipo: 'RECUPERACION',
        destinatario: correoSintetico,
        enlace: `https://portal.example.test/recover-access/complete#token=${tokenSintetico}`,
        venceEn: new Date(ahora.getTime() + 30 * 60_000),
      })
      .then(
        () => null,
        (rechazo: unknown) => rechazo,
      );

    expect(error).toMatchObject({ code: 'SMTP_DELIVERY_FAILED' });
    expect(error instanceof Error ? error.message : '').not.toContain(correoSintetico);
    expect(error instanceof Error ? error.message : '').not.toContain(tokenSintetico);
  });
});
