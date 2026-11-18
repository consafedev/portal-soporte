import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { recoveryRequestSchema } from '../../../../packages/contracts/src/auth.js';
import type {
  EscritorAuditoriaAuth,
  EventoAuditoriaAuth,
  HasheadorContrasena,
  MensajeCorreoAuth,
  RelojAuth,
  ServicioCorreoAuth,
} from '../../../../packages/core/src/auth/ports.js';
import type {
  CambioConsumoTokenAuth,
  CuentaCredencialesAuth,
  EntradaTokenRecuperacionAuth,
  LimitadorIntentosAuth,
  RepositorioCredencialesAuth,
} from '../../../../packages/core/src/auth/recovery-ports.js';
import type { RolUsuario } from '../../../../packages/core/src/auth/models.js';
import { ErrorRepositorioUsuariosAdmin } from '../../../../packages/core/src/auth/admin-ports.js';
import {
  normalizarCorreo,
  validarNuevaContrasena,
} from '../../../../packages/core/src/auth/policies.js';
import { calcularDigestTokenOpaco, crearTokenOpaco, esTokenOpacoValido } from './token-service.js';
import { crearEnlaceCorreoAuth } from './mailer.js';
import type { ServicioSesion, SesionEmitida } from './session-service.js';

const MILISEGUNDOS_EXPIRACION_TOKEN = 30 * 60_000;

/** Configuración inyectada para recuperación sin importar detalles HTTP o PostgreSQL. */
export interface DependenciasRecuperacionAuth {
  /** Persistencia transaccional de cuentas, tokens, sesiones y auditoría. */
  readonly repositorio: RepositorioCredencialesAuth;
  /** Hash seguro para cambio voluntario, recuperación y activación. */
  readonly hasheador: HasheadorContrasena;
  /** Servicio que entrega enlaces sin registrar los mensajes. */
  readonly correo: ServicioCorreoAuth;
  /** Contador HMAC de intentos de login y recuperación. */
  readonly limitador: LimitadorIntentosAuth;
  /** Escritor de auditoría sin datos de identidad completos o secretos. */
  readonly auditoria: EscritorAuditoriaAuth;
  /** Servicio que crea la nueva sesión opaca después de cambiar contraseña. */
  readonly sesiones: Pick<ServicioSesion, 'crear'>;
  /** Reloj UTC sustituible para expiración y pruebas. */
  readonly reloj: RelojAuth;
  /** Origen canónico de enlaces, validado desde configuración del servidor. */
  readonly publicAppOrigin: string;
}

/** Error de credenciales estable, seguro para traducir a respuestas HTTP. */
export class ErrorCredencialesAuth extends Error {
  /** Construye un error fijo que no incorpora campos recibidos ni datos del repositorio. */
  public constructor(
    public readonly code: string,
    public readonly statusCode: 400 | 401 | 403 | 404 | 409 | 429 | 503,
  ) {
    super(code);
    this.name = 'ErrorCredencialesAuth';
  }
}

/** Orquesta recuperación, activación, cambio de correo y contraseñas propias. */
export class ServicioRecuperacionAuth {
  /** Construye el caso de uso con adaptadores explícitos y reloj inyectable. */
  public constructor(private readonly dependencias: DependenciasRecuperacionAuth) {}

  /** Atiende recuperación con respuesta idéntica para correo desconocido o no verificado. */
  public async solicitarRecuperacion(
    correo: string,
    direccionIp: string,
    requestId: string,
  ): Promise<'ACEPTADA' | 'LIMITADA'> {
    const email = normalizarCorreo(correo);
    this.validarCorreo(email);
    const ahora = this.dependencias.reloj.ahora();
    if (!(await this.admitirIntento(email, direccionIp, ahora, requestId))) {
      return 'LIMITADA';
    }

    const cuenta = await this.dependencias.repositorio.buscarCuentaPorCorreo(email);
    if (cuenta?.status === 'ACTIVE' && cuenta.emailVerifiedAt !== null) {
      await this.crearYEnviarToken(cuenta, 'PASSWORD_RECOVERY', null, null, requestId);
    }
    await this.dependencias.auditoria.registrar(
      this.crearEvento(null, null, 'AUTH_RECOVERY_REQUESTED', 'SUCCESS', { requestId }),
    );

    return 'ACEPTADA';
  }

  /** Restablece contraseña usando solo un token vigente de recuperación y revoca sesiones. */
  public completarRecuperacion(
    token: string,
    nuevaContrasena: string,
    direccionIp: string,
    requestId: string,
  ): Promise<void> {
    return this.completarTokenConContrasena(
      token,
      'PASSWORD_RECOVERY',
      nuevaContrasena,
      direccionIp,
      requestId,
    );
  }

  /** Activa invitación vigente, fija credencial y marca correo verificado dentro de una transacción. */
  public completarActivacion(
    token: string,
    nuevaContrasena: string,
    direccionIp: string,
    requestId: string,
  ): Promise<void> {
    return this.completarTokenConContrasena(
      token,
      'ACTIVATION',
      nuevaContrasena,
      direccionIp,
      requestId,
    );
  }

  /** Cambia la contraseña propia tras verificar la actual y rota todas las sesiones. */
  public async cambiarContrasena(
    userId: string,
    contrasenaActual: string,
    nuevaContrasena: string,
    direccionIp: string,
    requestId: string,
  ): Promise<SesionEmitida> {
    const cuenta = await this.exigirCuentaActiva(userId);
    this.validarContrasenaNueva(nuevaContrasena);
    const ahora = this.dependencias.reloj.ahora();
    if (!(await this.admitirIntento(userId, direccionIp, ahora, requestId))) {
      throw new ErrorCredencialesAuth('RATE_LIMITED', 429);
    }

    if (
      cuenta.passwordHash === null ||
      !(await this.dependencias.hasheador.verificar(cuenta.passwordHash, contrasenaActual))
    ) {
      await this.dependencias.auditoria.registrar(
        this.crearEvento(userId, userId, 'AUTH_PASSWORD_CHANGE', 'FAILURE', { requestId }),
      );
      throw new ErrorCredencialesAuth('CURRENT_PASSWORD_INVALID', 401);
    }

    const passwordHash = await this.dependencias.hasheador.hash(nuevaContrasena);
    const actualizado = await this.dependencias.repositorio.cambiarContrasena(
      userId,
      passwordHash,
      ahora,
      this.crearEvento(userId, userId, 'AUTH_PASSWORD_CHANGE', 'SUCCESS', { requestId }),
    );
    if (!actualizado) {
      throw new ErrorCredencialesAuth('ACCOUNT_NOT_AVAILABLE', 401);
    }

    await this.dependencias.limitador.reiniciarIntentos('RECOVERY', userId, direccionIp);

    return this.dependencias.sesiones.crear(userId);
  }

  /** Solicita cambio o verificación del correo después de validar la contraseña actual. */
  public async solicitarCambioCorreo(
    userId: string,
    contrasenaActual: string,
    correoNuevo: string,
    direccionIp: string,
    requestId: string,
  ): Promise<'ACEPTADA' | 'LIMITADA'> {
    const email = normalizarCorreo(correoNuevo);
    this.validarCorreo(email);
    const cuenta = await this.exigirCuentaActiva(userId);
    const ahora = this.dependencias.reloj.ahora();
    if (!(await this.admitirIntento(email, direccionIp, ahora, requestId))) {
      return 'LIMITADA';
    }
    await this.verificarContrasenaActual(cuenta, contrasenaActual, requestId, 'AUTH_EMAIL_CHANGE');

    const esVerificacionActual =
      email === cuenta.emailNormalized && cuenta.emailVerifiedAt === null;
    if (email === cuenta.emailNormalized && !esVerificacionActual) {
      throw new ErrorCredencialesAuth('EMAIL_ALREADY_VERIFIED', 409);
    }
    const existente = await this.dependencias.repositorio.buscarCuentaPorCorreo(email);
    if (existente !== null && existente.id !== userId) {
      throw new ErrorCredencialesAuth('EMAIL_TAKEN', 409);
    }

    await this.crearYEnviarToken(
      cuenta,
      esVerificacionActual ? 'EMAIL_VERIFICATION' : 'EMAIL_CHANGE',
      esVerificacionActual ? null : email,
      { userId, role: cuenta.role },
      requestId,
    );

    return 'ACEPTADA';
  }

  /** Completa cambio/verificación de correo aceptando solo ambos propósitos de correo. */
  public async completarCambioCorreo(
    token: string,
    direccionIp: string,
    requestId: string,
  ): Promise<void> {
    const tokenHash = await this.exigirTokenYLimite(token, direccionIp, requestId);
    const propositos = ['EMAIL_CHANGE', 'EMAIL_VERIFICATION'] as const;
    for (const purpose of propositos) {
      const evento = this.crearEvento(null, null, 'AUTH_EMAIL_CHANGE_COMPLETED', 'SUCCESS', {
        purpose,
        requestId,
      });
      try {
        if (
          await this.dependencias.repositorio.consumirToken(
            tokenHash,
            { purpose },
            this.dependencias.reloj.ahora(),
            evento,
          )
        ) {
          return;
        }
      } catch (error) {
        throw traducirErrorFinalizacionCorreo(error);
      }
    }

    await this.registrarTokenRechazado('AUTH_EMAIL_CHANGE_COMPLETED', requestId);
    throw new ErrorCredencialesAuth('TOKEN_INVALID_OR_EXPIRED', 400);
  }

  /** Emite un enlace de activación para una invitación pendiente o para reenviarla. */
  public async solicitarInvitacion(
    userId: string,
    actor: { readonly userId: string; readonly role: RolUsuario } | null,
    direccionIp: string,
    requestId: string,
  ): Promise<'ACEPTADA' | 'LIMITADA'> {
    const cuenta = await this.dependencias.repositorio.buscarCuentaPorId(userId);
    if (cuenta === null) {
      throw new ErrorCredencialesAuth('USER_NOT_FOUND', 404);
    }
    if (cuenta.status !== 'PENDING_ACTIVATION' || cuenta.passwordHash !== null) {
      throw new ErrorCredencialesAuth('ACTIVATION_NOT_AVAILABLE', 409);
    }
    const ahora = this.dependencias.reloj.ahora();
    if (!(await this.admitirIntento(cuenta.emailNormalized, direccionIp, ahora, requestId))) {
      return 'LIMITADA';
    }

    await this.crearYEnviarToken(cuenta, 'ACTIVATION', null, actor, requestId);

    return 'ACEPTADA';
  }

  /** Envía al ADMIN un enlace de restablecimiento o de activación sin asignar credenciales. */
  public async solicitarRestablecimientoAdmin(
    userId: string,
    actor: { readonly userId: string; readonly role: RolUsuario },
    direccionIp: string,
    requestId: string,
  ): Promise<'ACEPTADA' | 'LIMITADA'> {
    const cuenta = await this.dependencias.repositorio.buscarCuentaPorId(userId);
    if (cuenta === null) {
      throw new ErrorCredencialesAuth('USER_NOT_FOUND', 404);
    }
    const ahora = this.dependencias.reloj.ahora();
    if (!(await this.admitirIntento(cuenta.emailNormalized, direccionIp, ahora, requestId))) {
      return 'LIMITADA';
    }

    const purpose = cuenta.status === 'PENDING_ACTIVATION' ? 'ACTIVATION' : 'PASSWORD_RECOVERY';
    if (
      purpose === 'PASSWORD_RECOVERY' &&
      (cuenta.status !== 'ACTIVE' || cuenta.emailVerifiedAt === null)
    ) {
      return 'ACEPTADA';
    }
    await this.crearYEnviarToken(cuenta, purpose, null, actor, requestId);

    return 'ACEPTADA';
  }

  /** Solicita correo nuevo por ADMIN sin cambiarlo antes de consumir el enlace. */
  public async solicitarCambioCorreoAdmin(
    userId: string,
    correoNuevo: string,
    actor: { readonly userId: string; readonly role: RolUsuario },
    direccionIp: string,
    requestId: string,
  ): Promise<'ACEPTADA' | 'LIMITADA'> {
    const email = normalizarCorreo(correoNuevo);
    this.validarCorreo(email);
    const cuenta = await this.exigirCuentaActiva(userId);
    const ahora = this.dependencias.reloj.ahora();
    if (!(await this.admitirIntento(email, direccionIp, ahora, requestId))) {
      return 'LIMITADA';
    }
    if (email === cuenta.emailNormalized) {
      throw new ErrorCredencialesAuth('EMAIL_UNCHANGED', 409);
    }
    const existente = await this.dependencias.repositorio.buscarCuentaPorCorreo(email);
    if (existente !== null && existente.id !== userId) {
      throw new ErrorCredencialesAuth('EMAIL_TAKEN', 409);
    }

    await this.crearYEnviarToken(cuenta, 'EMAIL_CHANGE', email, actor, requestId);

    return 'ACEPTADA';
  }

  /** Hashea y consume un token exacto con auditoría y revocación transaccional en el repositorio. */
  private async completarTokenConContrasena(
    token: string,
    purpose: 'ACTIVATION' | 'PASSWORD_RECOVERY',
    nuevaContrasena: string,
    direccionIp: string,
    requestId: string,
  ): Promise<void> {
    const tokenHash = await this.exigirTokenYLimite(token, direccionIp, requestId);
    this.validarContrasenaNueva(nuevaContrasena);
    const passwordHash = await this.dependencias.hasheador.hash(nuevaContrasena);
    const cambios: CambioConsumoTokenAuth = { purpose, passwordHash };
    const ahora = this.dependencias.reloj.ahora();
    const accion =
      purpose === 'ACTIVATION' ? 'AUTH_INVITATION_ACTIVATED' : 'AUTH_RECOVERY_COMPLETED';
    const consumido = await this.dependencias.repositorio.consumirToken(
      tokenHash,
      cambios,
      ahora,
      this.crearEvento(null, null, accion, 'SUCCESS', { purpose, requestId }),
    );
    if (!consumido) {
      await this.registrarTokenRechazado(accion, requestId);
      throw new ErrorCredencialesAuth('TOKEN_INVALID_OR_EXPIRED', 400);
    }

    await this.dependencias.limitador.reiniciarIntentos(
      'RECOVERY',
      calcularDigestTokenOpaco(token),
      direccionIp,
    );
  }

  /** Verifica contraseña actual sin permitir que usuarios pendientes o desactivados muten. */
  private async verificarContrasenaActual(
    cuenta: CuentaCredencialesAuth,
    contrasenaActual: string,
    requestId: string,
    accion: string,
  ): Promise<void> {
    if (
      cuenta.passwordHash === null ||
      !(await this.dependencias.hasheador.verificar(cuenta.passwordHash, contrasenaActual))
    ) {
      await this.dependencias.auditoria.registrar(
        this.crearEvento(cuenta.id, cuenta.id, accion, 'FAILURE', { requestId }),
      );
      throw new ErrorCredencialesAuth('CURRENT_PASSWORD_INVALID', 401);
    }
  }

  /** Comprueba y consume el límite antes de verificar un token de un solo uso. */
  private async exigirTokenYLimite(
    token: string,
    direccionIp: string,
    requestId: string,
  ): Promise<string> {
    if (!esTokenOpacoValido(token)) {
      throw new ErrorCredencialesAuth('TOKEN_INVALID_OR_EXPIRED', 400);
    }
    const digest = calcularDigestTokenOpaco(token);
    if (
      !(await this.admitirIntento(digest, direccionIp, this.dependencias.reloj.ahora(), requestId))
    ) {
      throw new ErrorCredencialesAuth('RATE_LIMITED', 429);
    }

    return digest;
  }

  /** Busca una cuenta activa sin devolver correo o hash a los controladores HTTP. */
  private async exigirCuentaActiva(userId: string): Promise<CuentaCredencialesAuth> {
    const cuenta = await this.dependencias.repositorio.buscarCuentaPorId(userId);
    if (cuenta === null || cuenta.status !== 'ACTIVE') {
      throw new ErrorCredencialesAuth('ACCOUNT_NOT_AVAILABLE', 401);
    }

    return cuenta;
  }

  /** Valida política de correo y devuelve solo fallos estables sin eco de la entrada. */
  private validarCorreo(email: string): void {
    if (!Value.Check(recoveryRequestSchema, { email })) {
      throw new ErrorCredencialesAuth('INVALID_EMAIL', 400);
    }
  }

  /** Aplica la longitud Unicode aprobada sin recortar ni transformar la contraseña. */
  private validarContrasenaNueva(password: string): void {
    const resultado = validarNuevaContrasena(password);
    if (!resultado.valida) {
      throw new ErrorCredencialesAuth(resultado.codigo, 400);
    }
  }

  /** Registra el intento antes de realizar búsqueda, comparación o envío. */
  private async admitirIntento(
    identificador: string,
    direccionIp: string,
    ahora: Date,
    requestId: string,
  ): Promise<boolean> {
    const permitido = await this.dependencias.limitador.registrarIntento(
      'RECOVERY',
      identificador,
      direccionIp,
      ahora,
    );
    if (!permitido) {
      await this.dependencias.auditoria.registrar(
        this.crearEvento(null, null, 'AUTH_ATTEMPT_LIMITED', 'DENIED', { requestId }),
      );
    }

    return permitido;
  }

  /** Audita el rechazo de un token sin conservar su valor, digest o propósito secreto. */
  private registrarTokenRechazado(action: string, requestId: string): Promise<void> {
    return this.dependencias.auditoria.registrar(
      this.crearEvento(null, null, action, 'FAILURE', { requestId }),
    );
  }

  /** Persiste digest/auditoría antes del correo y solo guarda el enlace en memoria. */
  private async crearYEnviarToken(
    cuenta: CuentaCredencialesAuth,
    purpose: EntradaTokenRecuperacionAuth['purpose'],
    targetEmail: string | null,
    actor: { readonly userId: string; readonly role: RolUsuario } | null,
    requestId: string,
  ): Promise<void> {
    const ahora = this.dependencias.reloj.ahora();
    const token = crearTokenOpaco();
    const entrada: EntradaTokenRecuperacionAuth = {
      id: randomUUID(),
      userId: cuenta.id,
      tokenHash: token.digest,
      purpose,
      targetEmail,
      createdAt: ahora,
      expiresAt: new Date(ahora.getTime() + MILISEGUNDOS_EXPIRACION_TOKEN),
    };
    const accion = accionSolicitudToken(purpose);
    const metadata = {
      purpose,
      requestId,
      ...(actor === null ? {} : { actorRole: actor.role }),
    };
    await this.dependencias.repositorio.crearToken(
      entrada,
      this.crearEvento(actor?.userId ?? null, cuenta.id, accion, 'SUCCESS', metadata),
    );
    const mensaje: MensajeCorreoAuth = {
      tipo: tipoCorreoToken(purpose),
      destinatario: purpose === 'EMAIL_CHANGE' ? (targetEmail ?? cuenta.email) : cuenta.email,
      enlace: crearEnlaceCorreoAuth(this.dependencias.publicAppOrigin, purpose, token.valor),
      venceEn: entrada.expiresAt,
    };
    this.enviarEnSegundoPlano(mensaje, actor, requestId);
  }

  /** Entrega correo sin bloquear la respuesta pública ni propagar error sensible del transporte. */
  private enviarEnSegundoPlano(
    mensaje: MensajeCorreoAuth,
    actor: { readonly userId: string; readonly role: RolUsuario } | null,
    requestId: string,
  ): void {
    const registrarFallo = async (): Promise<void> => {
      await this.dependencias.auditoria.registrar(
        this.crearEvento(
          actor?.userId ?? null,
          actor === null ? null : undefined,
          'RECOVERY_DELIVERY_FAILED',
          'FAILURE',
          { requestId },
        ),
      );
    };

    try {
      void this.dependencias.correo
        .enviar(mensaje)
        .catch(() => registrarFallo().catch(() => undefined));
    } catch {
      void registrarFallo().catch(() => undefined);
    }
  }

  /** Construye evento de auditoría fijo sin correo, IP, contraseña, URL ni token. */
  private crearEvento(
    actorUserId: string | null,
    targetUserId: string | null | undefined,
    action: string,
    outcome: EventoAuditoriaAuth['outcome'],
    metadata: Readonly<Record<string, string | number | boolean | null>>,
  ): EventoAuditoriaAuth {
    return {
      actorUserId,
      action,
      targetUserId: targetUserId ?? null,
      outcome,
      metadata,
      createdAt: this.dependencias.reloj.ahora(),
    };
  }
}

/** Traduce solo conflictos de correo confirmados sin adjuntar errores SQL ni su causa. */
function traducirErrorFinalizacionCorreo(error: unknown): Error {
  if (error instanceof ErrorRepositorioUsuariosAdmin && error.code === 'EMAIL_TAKEN') {
    return new ErrorCredencialesAuth('EMAIL_TAKEN', 409);
  }

  return error instanceof Error ? error : new Error('AUTH_CREDENTIAL_OPERATION_FAILED');
}

/** Mapea el propósito a una acción fija y apta para auditoría. */
function accionSolicitudToken(purpose: EntradaTokenRecuperacionAuth['purpose']): string {
  const acciones: Record<EntradaTokenRecuperacionAuth['purpose'], string> = {
    ACTIVATION: 'AUTH_INVITATION_SENT',
    PASSWORD_RECOVERY: 'AUTH_RECOVERY_TOKEN_ISSUED',
    EMAIL_CHANGE: 'AUTH_EMAIL_CHANGE_REQUESTED',
    EMAIL_VERIFICATION: 'AUTH_EMAIL_VERIFICATION_REQUESTED',
  };

  return acciones[purpose];
}

/** Traduce un propósito interno al tipo de correo transaccional aprobado. */
function tipoCorreoToken(
  purpose: EntradaTokenRecuperacionAuth['purpose'],
): MensajeCorreoAuth['tipo'] {
  const tipos: Record<EntradaTokenRecuperacionAuth['purpose'], MensajeCorreoAuth['tipo']> = {
    ACTIVATION: 'ACTIVACION',
    PASSWORD_RECOVERY: 'RECUPERACION',
    EMAIL_CHANGE: 'CAMBIO_CORREO',
    EMAIL_VERIFICATION: 'VERIFICACION_CORREO',
  };

  return tipos[purpose];
}
