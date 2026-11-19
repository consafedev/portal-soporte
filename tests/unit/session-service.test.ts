import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ServicioSesion } from '../../apps/api/src/auth/session-service.js';
import type {
  CuentaSesion,
  RepositorioSesiones,
  RenovacionSesion,
  RegistroSesionActual,
  SesionPersistida,
} from '../../packages/core/src/auth/ports.js';

const fechaInicial = new Date('2026-11-17T12:00:00.000Z');
const idUsuario = '00000000-0000-4000-8000-000000000101';

/** Reloj mutable que evita depender del tiempo real en las pruebas de expiración. */
class RelojDePrueba {
  private instante: Date = new Date(fechaInicial);

  /** Devuelve la fecha controlada por el caso de prueba. */
  public ahora(): Date {
    return new Date(this.instante);
  }

  /** Sustituye el instante actual con una fecha definida por el caso de prueba. */
  public fijar(fecha: Date): void {
    this.instante = new Date(fecha);
  }
}

/** Repositorio determinista para probar reglas puras del servicio de sesiones. */
class RepositorioSesionesMemoria implements RepositorioSesiones {
  /** Observa el digest, la correlación y el instante enviados al cierre transaccional. */
  public readonly cerrarSesion = vi
    .fn<RepositorioSesiones['cerrarSesion']>()
    .mockResolvedValue(undefined);
  private readonly registros = new Map<string, RegistroSesionActual>();
  private cuenta: CuentaSesion = {
    id: idUsuario,
    username: 'soporte_1',
    displayName: 'Cuenta Sintética',
    role: 'SUPPORT',
    status: 'ACTIVE',
  };

  /** Guarda una sesión simulada y asocia la cuenta vigente. */
  public async crear(entrada: SesionPersistida): Promise<void> {
    this.registros.set(entrada.tokenHash, {
      sesion: { ...entrada, revokedAt: null },
      usuario: { ...this.cuenta },
    });
  }

  /** Busca el hash simulado y adjunta la cuenta vigente en el momento de la consulta. */
  public async buscarPorHash(tokenHash: string): Promise<RegistroSesionActual | null> {
    const registro = this.registros.get(tokenHash);

    return registro === undefined ? null : { ...registro, usuario: { ...this.cuenta } };
  }

  /** Renueva solo una sesión existente, activa y todavía vigente. */
  public async renovar(entrada: RenovacionSesion): Promise<boolean> {
    const registro = [...this.registros.values()].find(
      (valor) =>
        valor.sesion.id === entrada.sessionId && valor.sesion.tokenHash === entrada.tokenHash,
    );
    if (
      registro === undefined ||
      registro.sesion.revokedAt !== null ||
      registro.sesion.idleExpiresAt <= entrada.ahora ||
      registro.sesion.absoluteExpiresAt <= entrada.ahora ||
      this.cuenta.status !== 'ACTIVE'
    ) {
      return false;
    }

    const registroActualizado: RegistroSesionActual = {
      ...registro,
      sesion: {
        ...registro.sesion,
        lastUsedAt: entrada.ahora,
        idleExpiresAt: entrada.venceInactivoEn,
      },
    };
    this.registros.set(entrada.tokenHash, registroActualizado);
    return true;
  }

  /** Revoca por hash sin revelar ni devolver el valor original del token. */
  public async revocarPorHash(tokenHash: string, revocadaEn: Date): Promise<boolean> {
    const registro = this.registros.get(tokenHash);
    if (registro === undefined || registro.sesion.revokedAt !== null) {
      return false;
    }

    this.registros.set(tokenHash, {
      ...registro,
      sesion: { ...registro.sesion, revokedAt: revocadaEn },
    });
    return true;
  }

  /** Revoca todas las sesiones de una cuenta excepto la que conserva la persona. */
  public async revocarSesionesDeUsuario(
    userId: string,
    conservarSesionId: string | null,
    revocadaEn: Date,
  ): Promise<number> {
    let total = 0;
    for (const [hash, registro] of this.registros) {
      if (
        registro.sesion.userId === userId &&
        registro.sesion.id !== conservarSesionId &&
        registro.sesion.revokedAt === null
      ) {
        this.registros.set(hash, {
          ...registro,
          sesion: { ...registro.sesion, revokedAt: revocadaEn },
        });
        total += 1;
      }
    }

    return total;
  }

  /** Cambia el rol vigente para comprobar que el servicio no cachea el valor anterior. */
  public cambiarRol(role: CuentaSesion['role']): void {
    this.cuenta = { ...this.cuenta, role };
  }

  /** Cambia el estado vigente de la cuenta para comprobar la invalidación. */
  public cambiarEstado(status: CuentaSesion['status']): void {
    this.cuenta = { ...this.cuenta, status };
  }

  /** Devuelve el registro almacenado por hash para inspeccionar que no haya token en claro. */
  public obtenerPorHash(hash: string): RegistroSesionActual | undefined {
    return this.registros.get(hash);
  }
}

/** Construye las dependencias del servicio con tiempo y persistencia controlados. */
function crearSujetoSesion(): {
  reloj: RelojDePrueba;
  repositorio: RepositorioSesionesMemoria;
  servicio: ServicioSesion;
} {
  const reloj = new RelojDePrueba();
  const repositorio = new RepositorioSesionesMemoria();

  return { reloj, repositorio, servicio: new ServicioSesion(repositorio, reloj) };
}

/** Agrupa pruebas de creación, validación, extensión y revocación de sesiones. */
function definirPruebasDeSesion(): void {
  it('crea sesión opaca con expiraciones de 30 minutos y 8 horas', pruebaCreaConExpiraciones);
  it('persiste únicamente el hash de la credencial opaca', pruebaNoPersisteTokenClaro);
  it('extiende la expiración inactiva durante uso vigente', pruebaExtiendeInactividad);
  it('deniega sesión vencida por inactividad o plazo absoluto', pruebaExpiracionesDeniegan);
  it('deniega sesión revocada o cuenta desactivada', pruebaRevocacionYDesactivacion);
  it('usa el rol vigente de la cuenta en cada resolución', pruebaRolVigente);
  it('revoca todas las demás sesiones de una cuenta', pruebaRevocaOtrasSesiones);
  it('no consulta el repositorio ante una credencial malformada', pruebaTokenMalformado);
  it('entrega solo el digest o null al cierre auditado', pruebaCierreConDigest);
}

/** Comprueba que el logout preserve la correlación y no entregue el secreto al repositorio. */
async function pruebaCierreConDigest(): Promise<void> {
  const { servicio, repositorio } = crearSujetoSesion();
  const sesion = await servicio.crear(idUsuario);
  await servicio.cerrarSesion(sesion.token, 'solicitud-valida');
  await servicio.cerrarSesion('malformada', 'solicitud-anonima');
  expect(repositorio.cerrarSesion.mock.calls).toEqual([
    [createHash('sha256').update(sesion.token).digest('hex'), 'solicitud-valida', fechaInicial],
    [null, 'solicitud-anonima', fechaInicial],
  ]);
}

/** Comprueba los plazos aprobados en la sesión recién creada. */
async function pruebaCreaConExpiraciones(): Promise<void> {
  const { servicio } = crearSujetoSesion();
  const sesion = await servicio.crear(idUsuario);

  expect(sesion.idleExpiresAt).toEqual(new Date(fechaInicial.getTime() + 30 * 60_000));
  expect(sesion.absoluteExpiresAt).toEqual(new Date(fechaInicial.getTime() + 8 * 60 * 60_000));
}

/** Comprueba que el repositorio solo recibe el digest SHA-256 de la credencial. */
async function pruebaNoPersisteTokenClaro(): Promise<void> {
  const { repositorio, servicio } = crearSujetoSesion();
  const sesion = await servicio.crear(idUsuario);
  const digest = createHash('sha256').update(sesion.token).digest('hex');
  const guardada = repositorio.obtenerPorHash(digest);

  expect(guardada?.sesion.tokenHash).toBe(digest);
  expect(guardada?.sesion.tokenHash).not.toBe(sesion.token);
}

/** Comprueba que la actividad renueve solo el límite inactivo. */
async function pruebaExtiendeInactividad(): Promise<void> {
  const { reloj, servicio } = crearSujetoSesion();
  const sesion = await servicio.crear(idUsuario);
  reloj.fijar(new Date(fechaInicial.getTime() + 10 * 60_000));

  const vigente = await servicio.resolverVigente(sesion.token);

  expect(vigente?.idleExpiresAt).toEqual(new Date(fechaInicial.getTime() + 40 * 60_000));
  expect(vigente?.absoluteExpiresAt).toEqual(sesion.absoluteExpiresAt);
}

/** Comprueba que ambos plazos invaliden una sesión aunque su token siga presente. */
async function pruebaExpiracionesDeniegan(): Promise<void> {
  const porInactividad = crearSujetoSesion();
  const sesionInactiva = await porInactividad.servicio.crear(idUsuario);
  porInactividad.reloj.fijar(sesionInactiva.idleExpiresAt);
  await expect(porInactividad.servicio.resolverVigente(sesionInactiva.token)).resolves.toBeNull();

  const porAbsoluto = crearSujetoSesion();
  const sesionAbsoluta = await porAbsoluto.servicio.crear(idUsuario);
  porAbsoluto.reloj.fijar(sesionAbsoluta.absoluteExpiresAt);
  await expect(porAbsoluto.servicio.resolverVigente(sesionAbsoluta.token)).resolves.toBeNull();
}

/** Comprueba que la revocación y desactivación impidan resolver la sesión. */
async function pruebaRevocacionYDesactivacion(): Promise<void> {
  const revocada = crearSujetoSesion();
  const sesionRevocada = await revocada.servicio.crear(idUsuario);
  await revocada.servicio.revocar(sesionRevocada.token);
  await expect(revocada.servicio.resolverVigente(sesionRevocada.token)).resolves.toBeNull();

  const desactivada = crearSujetoSesion();
  const sesionDesactivada = await desactivada.servicio.crear(idUsuario);
  desactivada.repositorio.cambiarEstado('DISABLED');
  await expect(desactivada.servicio.resolverVigente(sesionDesactivada.token)).resolves.toBeNull();
}

/** Comprueba que los cambios de rol se reflejen sin recrear la sesión. */
async function pruebaRolVigente(): Promise<void> {
  const { repositorio, servicio } = crearSujetoSesion();
  const sesion = await servicio.crear(idUsuario);
  repositorio.cambiarRol('ADMIN');

  await expect(servicio.resolverVigente(sesion.token)).resolves.toMatchObject({
    usuario: { id: idUsuario, role: 'ADMIN' },
  });
}

/** Comprueba el cierre de las sesiones antiguas y conserva la sesión indicada. */
async function pruebaRevocaOtrasSesiones(): Promise<void> {
  const { servicio } = crearSujetoSesion();
  const actual = await servicio.crear(idUsuario);
  const otra = await servicio.crear(idUsuario);

  await expect(servicio.revocarTodasMenos(idUsuario, actual.sessionId)).resolves.toBe(1);
  await expect(servicio.resolverVigente(actual.token)).resolves.not.toBeNull();
  await expect(servicio.resolverVigente(otra.token)).resolves.toBeNull();
}

/** Comprueba que una cadena que no sea token opaco no consulte persistencia. */
async function pruebaTokenMalformado(): Promise<void> {
  const { repositorio, servicio } = crearSujetoSesion();

  await expect(servicio.resolverVigente('valor-invalido')).resolves.toBeNull();
  expect(repositorio.obtenerPorHash('')).toBeUndefined();
}

describe('servicio de sesiones opacas', definirPruebasDeSesion);
