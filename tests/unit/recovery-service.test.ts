import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  EscritorAuditoriaAuth,
  RelojAuth,
  ServicioCorreoAuth,
} from '../../packages/core/src/auth/ports.js';
import type {
  LimitadorIntentosAuth,
  RepositorioCredencialesAuth,
} from '../../packages/core/src/auth/recovery-ports.js';
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
    crearToken: vi.fn(async () => undefined),
    consumirToken: vi.fn(async () => true),
    cambiarContrasena: vi.fn(async () => true),
  };
  const correo: ServicioCorreoAuth = { enviar: vi.fn(async () => undefined) };
  const limitador: LimitadorIntentosAuth = {
    registrarIntento: vi.fn(async () => true),
    reiniciarIntentos: vi.fn(async () => undefined),
  };
  const auditoria: EscritorAuditoriaAuth = { registrar: vi.fn(async () => undefined) };
  const hasheador = {
    hash: vi.fn(async () => hashSintetico),
    verificar: vi.fn(
      async (_hash: string, contrasena: string) => contrasena === 'Clave actual sintética',
    ),
  };
  const sesiones = {
    crear: vi.fn(async () => ({
      sessionId: '018f1000-0000-7000-8000-000000000002',
      token: tokenSintetico,
      idleExpiresAt: new Date(ahora.getTime() + 30 * 60_000),
      absoluteExpiresAt: new Date(ahora.getTime() + 8 * 60 * 60_000),
    })),
  };

  return {
    repositorio,
    correo,
    limitador,
    auditoria,
    hasheador,
    sesiones,
    reloj,
    publicAppOrigin: 'https://portal.example.test',
    ...sobreescrituras,
  } as DependenciasRecuperacionAuth;
}

describe('recuperación de credenciales del portal', () => {
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
    expect(dependencias.sesiones.crear).not.toHaveBeenCalled();
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
