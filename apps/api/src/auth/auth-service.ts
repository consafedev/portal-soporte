import { randomBytes } from 'node:crypto';
import {
  esNombreUsuarioValido,
  normalizarUsuario,
} from '../../../../packages/core/src/auth/policies.js';
import type {
  EscritorAuditoriaAuth,
  EventoAuditoriaAuth,
  HasheadorContrasena,
  RepositorioAutenticacion,
  ResultadoInicioSesion,
  RelojAuth,
  ServicioAutenticacion,
} from '../../../../packages/core/src/auth/ports.js';
import type { CuentaAutenticacion } from '../../../../packages/core/src/auth/ports.js';
import { ServicioSesion } from './session-service.js';

const PREFIJO_HASH_ARGON2ID_APROBADO = '$argon2id$v=19$m=19456,p=1,t=2$';

/** Implementa login por username con error uniforme y sesión opaca. */
export class ServicioAutenticacionCore implements ServicioAutenticacion {
  private hashDummyEnProceso: Promise<string> | null = null;

  /** Construye el servicio con repositorio, criptografía, sesiones y auditoría. */
  public constructor(
    private readonly repositorio: RepositorioAutenticacion,
    private readonly hasheador: HasheadorContrasena,
    private readonly sesiones: ServicioSesion,
    private readonly auditoria: EscritorAuditoriaAuth,
    private readonly reloj: RelojAuth,
  ) {}

  /**
   * Precalienta Argon2 dummy para evitar una penalización de primera petición anónima.
   *
   * @returns Promesa que se resuelve cuando el hash aleatorio quedó en memoria.
   * @throws Error si el proveedor criptográfico no puede calcular Argon2id.
   */
  public async preparar(): Promise<void> {
    await this.resolverHashDummy();
  }

  /**
   * Compara la contraseña y confirma bajo bloqueo que la cuenta mantiene el hash verificado.
   * @param username Identificador presentado por la persona.
   * @param contrasena Contraseña exacta recibida por el adaptador.
   * @param requestId Identificador de correlación creado por el servidor HTTP.
   * @returns Credencial para la cookie tras confirmar sesión y auditoría, o rechazo uniforme.
   */
  public async iniciarSesion(
    username: string,
    contrasena: string,
    requestId: string,
  ): Promise<ResultadoInicioSesion> {
    const usernameValido = esNombreUsuarioValido(username);
    const usernameNormalizado = usernameValido ? normalizarUsuario(username) : '';
    const cuenta = usernameValido
      ? await this.repositorio.buscarCuentaPorUsuarioNormalizado(usernameNormalizado)
      : null;
    const hashComparacion = await this.resolverHashComparacion(cuenta);
    const contrasenaCoincide = await this.hasheador.verificar(hashComparacion, contrasena);

    if (
      !contrasenaCoincide ||
      cuenta?.status !== 'ACTIVE' ||
      hashComparacion !== cuenta.passwordHash
    ) {
      await this.auditarLoginFallido(requestId);

      return { autenticado: false, codigo: 'INVALID_CREDENTIALS' };
    }

    const { registro, credencial: sesion } = this.sesiones.preparar(cuenta.id);
    const evento: EventoAuditoriaAuth = {
      actorUserId: cuenta.id,
      action: 'AUTH_LOGIN',
      targetUserId: cuenta.id,
      outcome: 'SUCCESS',
      metadata: { requestId },
      createdAt: this.reloj.ahora(),
    };
    const usuario = await this.repositorio.confirmarLogin(
      registro,
      hashComparacion,
      usernameNormalizado,
      evento,
    );
    if (usuario === null) {
      await this.auditarLoginFallido(requestId);
      return { autenticado: false, codigo: 'INVALID_CREDENTIALS' };
    }

    return {
      autenticado: true,
      tokenSesion: sesion.token,
      sessionId: sesion.sessionId,
      usuario,
      idleExpiresAt: sesion.idleExpiresAt,
      absoluteExpiresAt: sesion.absoluteExpiresAt,
    };
  }

  /** Obtiene hash válido o calcula una credencial dummy una sola vez por proceso. */
  private async resolverHashComparacion(cuenta: CuentaAutenticacion | null): Promise<string> {
    if (cuenta?.passwordHash?.startsWith(PREFIJO_HASH_ARGON2ID_APROBADO) === true) {
      return cuenta.passwordHash;
    }

    return this.resolverHashDummy();
  }

  /** Crea una única credencial Argon2 aleatoria y la conserva solo en memoria del proceso. */
  private resolverHashDummy(): Promise<string> {
    this.hashDummyEnProceso ??= this.hasheador.hash(randomBytes(32).toString('base64url'));

    return this.hashDummyEnProceso;
  }

  /** Emite auditoría sin incluir username, contraseña, hash ni causa enumerable. */
  private async auditarLoginFallido(requestId: string): Promise<void> {
    const evento: EventoAuditoriaAuth = {
      actorUserId: null,
      action: 'AUTH_LOGIN',
      targetUserId: null,
      outcome: 'FAILURE',
      metadata: { requestId },
      createdAt: this.reloj.ahora(),
    };
    await this.auditoria.registrar(evento);
  }
}
