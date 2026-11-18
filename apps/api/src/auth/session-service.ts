import { randomUUID } from 'node:crypto';
import type {
  CuentaSesion,
  RepositorioSesiones,
  RenovacionSesion,
  RegistroSesionActual,
  RelojAuth,
  SesionPersistida,
} from '../../../../packages/core/src/auth/ports.js';
import { calcularDigestTokenOpaco, crearTokenOpaco, esTokenOpacoValido } from './token-service.js';

const MILISEGUNDOS_MINUTO = 60_000;
const MINUTOS_INACTIVIDAD_MAXIMA = 30;
const HORAS_DURACION_ABSOLUTA = 8;

/** Credencial de sesión que el adaptador HTTP debe emitir exclusivamente en cookie. */
export interface SesionEmitida {
  /** UUID interno usado para cierre y administración de sesiones. */
  readonly sessionId: string;
  /** Valor secreto que el adaptador HTTP envía en cookie segura, nunca en JSON. */
  readonly token: string;
  /** Expiración móvil por inactividad. */
  readonly idleExpiresAt: Date;
  /** Expiración absoluta no renovable. */
  readonly absoluteExpiresAt: Date;
}

/** Identidad pública vigente resuelta desde el backend para una petición. */
export interface SesionVigente {
  /** UUID de la sesión. */
  readonly sessionId: string;
  /** Cuenta y rol actuales leídos desde PostgreSQL. */
  readonly usuario: CuentaSesion;
  /** Límite inactivo actualizado tras la actividad validada. */
  readonly idleExpiresAt: Date;
  /** Límite absoluto original de la sesión. */
  readonly absoluteExpiresAt: Date;
}

/** Administra creación, renovación, comprobación y revocación de tokens opacos. */
export class ServicioSesion {
  /** Construye el servicio con los puertos de persistencia y reloj del núcleo. */
  public constructor(
    private readonly repositorio: RepositorioSesiones,
    private readonly reloj: RelojAuth,
  ) {}

  /** Crea una sesión con token aleatorio y persiste únicamente su digest SHA-256. */
  public async crear(userId: string): Promise<SesionEmitida> {
    const ahora = this.reloj.ahora();
    const absoluteExpiresAt = new Date(
      ahora.getTime() + HORAS_DURACION_ABSOLUTA * 60 * MILISEGUNDOS_MINUTO,
    );
    const idleExpiresAt = this.calcularVencimientoInactivo(ahora, absoluteExpiresAt);
    const token = crearTokenOpaco();
    const sessionId = randomUUID();
    const entrada: SesionPersistida = {
      id: sessionId,
      userId,
      tokenHash: token.digest,
      createdAt: ahora,
      lastUsedAt: ahora,
      idleExpiresAt,
      absoluteExpiresAt,
    };

    await this.repositorio.crear(entrada);

    return { sessionId, token: token.valor, idleExpiresAt, absoluteExpiresAt };
  }

  /** Resuelve y renueva una sesión solo si token, expiración, estado y rol siguen vigentes. */
  public async resolverVigente(token: string): Promise<SesionVigente | null> {
    if (!esTokenOpacoValido(token)) {
      return null;
    }

    const tokenHash = calcularDigestTokenOpaco(token);
    const registro = await this.repositorio.buscarPorHash(tokenHash);
    const ahora = this.reloj.ahora();
    if (!this.esRegistroVigente(registro, ahora)) {
      return null;
    }

    const venceInactivoEn = this.calcularVencimientoInactivo(
      ahora,
      registro.sesion.absoluteExpiresAt,
    );
    const renovacion: RenovacionSesion = {
      sessionId: registro.sesion.id,
      tokenHash,
      ahora,
      venceInactivoEn,
    };

    if (!(await this.repositorio.renovar(renovacion))) {
      return null;
    }

    const usuario: CuentaSesion = {
      id: registro.usuario.id,
      username: registro.usuario.username,
      displayName: registro.usuario.displayName,
      role: registro.usuario.role,
      status: registro.usuario.status,
    };

    return {
      sessionId: registro.sesion.id,
      usuario,
      idleExpiresAt: venceInactivoEn,
      absoluteExpiresAt: registro.sesion.absoluteExpiresAt,
    };
  }

  /** Revoca una sesión por digest y no revela si una credencial desconocida existía. */
  public async revocar(token: string): Promise<boolean> {
    if (!esTokenOpacoValido(token)) {
      return false;
    }

    return this.repositorio.revocarPorHash(calcularDigestTokenOpaco(token), this.reloj.ahora());
  }

  /** Revoca las demás sesiones de una cuenta y permite conservar una sesión autorizada. */
  public async revocarTodasMenos(userId: string, sessionId: string): Promise<number> {
    return this.repositorio.revocarSesionesDeUsuario(userId, sessionId, this.reloj.ahora());
  }

  /** Comprueba vigencia con expiraciones estrictas y el estado actual de la cuenta. */
  private esRegistroVigente(
    registro: RegistroSesionActual | null,
    ahora: Date,
  ): registro is RegistroSesionActual {
    if (
      registro === null ||
      registro.sesion.revokedAt !== null ||
      registro.usuario.status !== 'ACTIVE'
    ) {
      return false;
    }

    return registro.sesion.idleExpiresAt > ahora && registro.sesion.absoluteExpiresAt > ahora;
  }

  /** Calcula el límite móvil sin permitir que exceda las ocho horas absolutas. */
  private calcularVencimientoInactivo(ahora: Date, absoluteExpiresAt: Date): Date {
    const vencimientoSolicitado =
      ahora.getTime() + MINUTOS_INACTIVIDAD_MAXIMA * MILISEGUNDOS_MINUTO;

    return new Date(Math.min(vencimientoSolicitado, absoluteExpiresAt.getTime()));
  }
}
