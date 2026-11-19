import { describe, expect, it, vi } from 'vitest';
import type {
  CuentaAutenticacion,
  CuentaSesion,
  EscritorAuditoriaAuth,
  EventoAuditoriaAuth,
  HasheadorContrasena,
  RepositorioAutenticacion,
  RenovacionSesion,
  RegistroSesionActual,
  SesionPersistida,
} from '../../packages/core/src/auth/ports.js';
import { ServicioAutenticacionCore } from '../../apps/api/src/auth/auth-service.js';
import { ServicioSesion } from '../../apps/api/src/auth/session-service.js';

const cuentaActiva: CuentaAutenticacion = {
  id: '00000000-0000-4000-8000-000000000201',
  username: 'soporte_1',
  displayName: 'Cuenta Sintética',
  role: 'SUPPORT',
  status: 'ACTIVE',
  passwordHash: '$argon2id$v=19$m=19456,p=1,t=2$sal-sintetica$hash-sintetico',
};
const contrasenaValidaSintetica = 'contraseña de prueba sintética';

/** Repositorio en memoria que conserva únicamente entradas seguras de sesión. */
class RepositorioAutenticacionMemoria implements RepositorioAutenticacion {
  /** Sustituye el cierre auditado, ajeno al flujo de login que cubre esta suite. */
  public readonly cerrarSesion = vi
    .fn<RepositorioAutenticacion['cerrarSesion']>()
    .mockResolvedValue(undefined);
  private readonly sesiones = new Map<string, SesionPersistida & { revokedAt: Date | null }>();

  /** Construye el repositorio con la cuenta que el caso necesite simular. */
  public constructor(
    private readonly cuenta: CuentaAutenticacion | null,
    private readonly auditoria: EscritorAuditoriaAuth,
  ) {}

  /** Busca una cuenta solo por el nombre canónico usado en el inicio de sesión. */
  public async buscarCuentaPorUsuarioNormalizado(
    username: string,
  ): Promise<CuentaAutenticacion | null> {
    return this.cuenta?.username.toLowerCase() === username ? this.cuenta : null;
  }

  /** Guarda la sesión de prueba y nunca recibe el token original. */
  public async crear(entrada: SesionPersistida): Promise<void> {
    this.sesiones.set(entrada.tokenHash, { ...entrada, revokedAt: null });
  }

  /** Simula el guardado condicionado por las credenciales y la auditoría del login. */
  public async confirmarLogin(
    sesion: SesionPersistida,
    hash: string,
    username: string,
    evento: EventoAuditoriaAuth,
  ) {
    if (
      !this.cuenta ||
      this.cuenta.status !== 'ACTIVE' ||
      this.cuenta.passwordHash !== hash ||
      this.cuenta.username !== username
    )
      return null;
    await this.crear(sesion);
    const { id, displayName, role } = this.cuenta;
    await this.auditoria.registrar({
      ...evento,
      metadata: { ...evento.metadata, actorRole: role },
    });
    return { id, username, displayName, role };
  }

  /** Simula una consulta de sesión con los datos actuales de la cuenta. */
  public async buscarPorHash(tokenHash: string): Promise<RegistroSesionActual | null> {
    const sesion = this.sesiones.get(tokenHash);
    if (sesion === undefined || this.cuenta === null) {
      return null;
    }

    const usuario: CuentaSesion = {
      id: this.cuenta.id,
      username: this.cuenta.username,
      displayName: this.cuenta.displayName,
      role: this.cuenta.role,
      status: this.cuenta.status,
    };

    return { sesion, usuario };
  }

  /** Renueva la sesión si no está revocada ni vencida. */
  public async renovar(entrada: RenovacionSesion): Promise<boolean> {
    const entradaHash = [...this.sesiones.entries()].find(
      ([, sesion]) => sesion.id === entrada.sessionId && sesion.tokenHash === entrada.tokenHash,
    );
    if (
      entradaHash === undefined ||
      entradaHash[1].revokedAt !== null ||
      entradaHash[1].idleExpiresAt <= entrada.ahora ||
      entradaHash[1].absoluteExpiresAt <= entrada.ahora ||
      this.cuenta?.status !== 'ACTIVE'
    ) {
      return false;
    }

    this.sesiones.set(entrada.tokenHash, {
      ...entradaHash[1],
      lastUsedAt: entrada.ahora,
      idleExpiresAt: entrada.venceInactivoEn,
    });
    return true;
  }

  /** Marca como revocada la sesión identificada por digest. */
  public async revocarPorHash(tokenHash: string, revocadaEn: Date): Promise<boolean> {
    const sesion = this.sesiones.get(tokenHash);
    if (sesion === undefined || sesion.revokedAt !== null) {
      return false;
    }

    this.sesiones.set(tokenHash, { ...sesion, revokedAt: revocadaEn });
    return true;
  }

  /** Revoca las sesiones de la cuenta, si el caso requiere una sesión actual. */
  public async revocarSesionesDeUsuario(
    userId: string,
    conservarSesionId: string | null,
    revocadaEn: Date,
  ): Promise<number> {
    let total = 0;
    for (const [hash, sesion] of this.sesiones) {
      if (
        sesion.userId === userId &&
        sesion.id !== conservarSesionId &&
        sesion.revokedAt === null
      ) {
        this.sesiones.set(hash, { ...sesion, revokedAt: revocadaEn });
        total += 1;
      }
    }

    return total;
  }
}

/** Hasheador simulado que permite comprobar elección de hash sin costo de Argon2. */
class HasheadorMemoria implements HasheadorContrasena {
  public readonly verificaciones: Array<{ hash: string; contrasena: string }> = [];
  public hashesGenerados = 0;

  /** Entrega un hash ficticio reservado para usuarios desconocidos. */
  public async hash(): Promise<string> {
    this.hashesGenerados += 1;
    return 'hash-dummy-sintetico';
  }

  /** Acepta solo el par de prueba fijado en el entorno unitario. */
  public async verificar(hash: string, contrasena: string): Promise<boolean> {
    this.verificaciones.push({ hash, contrasena });

    return hash === cuentaActiva.passwordHash && contrasena === contrasenaValidaSintetica;
  }
}

/** Captura auditoría en memoria para revisar que no reciba credenciales. */
class AuditoriaMemoria implements EscritorAuditoriaAuth {
  public readonly eventos: EventoAuditoriaAuth[] = [];

  /** Registra el evento ficticio producido por el servicio. */
  public async registrar(evento: EventoAuditoriaAuth): Promise<void> {
    this.eventos.push(evento);
  }
}

/** Reloj fijo para evitar dependencias del tiempo del equipo de desarrollo. */
const relojFijo = {
  /** Devuelve un instante estable para la emisión de sesión y auditoría. */
  ahora(): Date {
    return new Date('2026-11-17T14:00:00.000Z');
  },
};

/** Construye el servicio bajo prueba con puertos simulados y estado aislado. */
function crearSujeto(cuenta: CuentaAutenticacion | null = cuentaActiva) {
  const hasheador = new HasheadorMemoria();
  const auditoria = new AuditoriaMemoria();
  const repositorio = new RepositorioAutenticacionMemoria(cuenta, auditoria);
  const servicio = new ServicioAutenticacionCore(
    repositorio,
    hasheador,
    new ServicioSesion(repositorio, relojFijo),
    auditoria,
    relojFijo,
  );

  return { repositorio, hasheador, auditoria, servicio };
}

/** Agrupa casos de credenciales válidas, respuestas genéricas y auditoría. */
function definirPruebasDeAutenticacion(): void {
  it(
    'inicia sesión activa con nombre canónico y devuelve solo identidad pública',
    pruebaLoginExitoso,
  );
  it(
    'usa respuesta uniforme para usuario inexistente y contraseña errónea',
    pruebaRespuestaSinEnumeracion,
  );
  it(
    'verifica contraseña de cuenta desactivada antes de denegarla genéricamente',
    pruebaCuentaDesactivada,
  );
  it('audita el resultado sin registrar contraseña ni hash', pruebaAuditoriaSinSecretos);
}

/** Comprueba la autenticación por username y la sesión opaca creada. */
async function pruebaLoginExitoso(): Promise<void> {
  const { servicio } = crearSujeto();
  const resultado = await servicio.iniciarSesion(
    '  SOPORTE_1 ',
    contrasenaValidaSintetica,
    'req-login-unitario',
  );

  expect(resultado).toMatchObject({
    autenticado: true,
    usuario: { id: cuentaActiva.id, username: 'soporte_1', role: 'SUPPORT' },
  });
  if (resultado.autenticado) {
    expect(Buffer.from(resultado.tokenSesion, 'base64url')).toHaveLength(32);
    expect(resultado).not.toHaveProperty('passwordHash');
  }
}

/** Comprueba igualdad de forma entre cuenta ausente y credencial inválida. */
async function pruebaRespuestaSinEnumeracion(): Promise<void> {
  const conocido = crearSujeto();
  const desconocido = crearSujeto(null);
  await desconocido.servicio.preparar();

  const respuestaConocido = await conocido.servicio.iniciarSesion(
    'soporte_1',
    'contraseña incorrecta sintética',
    'req-login-unitario',
  );
  const respuestaDesconocido = await desconocido.servicio.iniciarSesion(
    'usuario_ausente',
    'contraseña incorrecta sintética',
    'req-login-unitario',
  );

  expect(respuestaConocido).toEqual(respuestaDesconocido);
  expect(conocido.hasheador.verificaciones).toHaveLength(1);
  expect(desconocido.hasheador.verificaciones).toHaveLength(1);
  expect(desconocido.hasheador.verificaciones[0]?.hash).toBe('hash-dummy-sintetico');
  expect(desconocido.hasheador.hashesGenerados).toBe(1);
}

/** Comprueba que la cuenta desactivada no pueda iniciar sesión con clave correcta. */
async function pruebaCuentaDesactivada(): Promise<void> {
  const { servicio, hasheador } = crearSujeto({ ...cuentaActiva, status: 'DISABLED' });

  await expect(
    servicio.iniciarSesion('soporte_1', contrasenaValidaSintetica, 'req-login-unitario'),
  ).resolves.toEqual({ autenticado: false, codigo: 'INVALID_CREDENTIALS' });
  expect(hasheador.verificaciones).toHaveLength(1);
}

/** Comprueba que los eventos de login no contengan valores sensibles. */
async function pruebaAuditoriaSinSecretos(): Promise<void> {
  const { servicio, auditoria } = crearSujeto();
  await servicio.iniciarSesion('soporte_1', contrasenaValidaSintetica, 'req-login-unitario');

  expect(auditoria.eventos).toHaveLength(1);
  expect(auditoria.eventos[0]?.metadata).toEqual({
    requestId: 'req-login-unitario',
    actorRole: 'SUPPORT',
  });
  expect(JSON.stringify(auditoria.eventos[0])).not.toContain(contrasenaValidaSintetica);
  expect(JSON.stringify(auditoria.eventos[0])).not.toContain(cuentaActiva.passwordHash ?? '');
}

describe('servicio de autenticación', definirPruebasDeAutenticacion);
