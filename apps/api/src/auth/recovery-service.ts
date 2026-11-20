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
import type { ActorSesionAdmin } from '../../../../packages/core/src/auth/admin-ports.js';
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
  /** Indica si se permiten flujos que requieren entregar enlaces por correo. */
  readonly correoHabilitado: boolean;
  /** Contador HMAC de intentos de login y recuperación. */
  readonly limitador: LimitadorIntentosAuth;
  /** Escritor de auditoría sin datos de identidad completos o secretos. */
  readonly auditoria: EscritorAuditoriaAuth;
  /** Prepara la sesión opaca que se confirma con el cambio de contraseña. */
  readonly sesiones: Pick<ServicioSesion, 'preparar'>;
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

  /** Indica si las operaciones que requieren correo pueden ejecutarse en el runtime. */
  public get correoHabilitado(): boolean {
    return this.dependencias.correoHabilitado;
  }

  /** Atiende recuperación con respuesta idéntica para correo desconocido o no verificado. */
  public async solicitarRecuperacion(
    correo: string,
    direccionIp: string,
    requestId: string,
  ): Promise<'ACEPTADA' | 'LIMITADA'> {
    this.exigirCorreoHabilitado();
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
    this.exigirCorreoHabilitado();
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
    this.exigirCorreoHabilitado();
    return this.completarTokenConContrasena(
      token,
      'ACTIVATION',
      nuevaContrasena,
      direccionIp,
      requestId,
    );
  }

  /**
   * Reautentica a la persona y confirma conjuntamente contraseña y sesión de reemplazo.
   * @param userId Cuenta de la sesión autenticada.
   * @param contrasenaActual Credencial que autoriza el cambio.
   * @param nuevaContrasena Credencial que se valida y se hashea.
   * @param direccionIp Origen para la limitación de intentos.
   * @param requestId Identificador de correlación de auditoría.
   * @returns Credencial de la nueva sesión después del commit.
   * @throws ErrorCredencialesAuth cuando la credencial ya no coincide o no se admite la solicitud.
   */
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
    const { registro, credencial } = this.dependencias.sesiones.preparar(userId);
    const actualizado = await this.dependencias.repositorio.cambiarContrasena(
      registro,
      cuenta.passwordHash,
      passwordHash,
      this.crearEvento(userId, userId, 'AUTH_PASSWORD_CHANGE', 'SUCCESS', { requestId }),
    );
    if (!actualizado) {
      throw new ErrorCredencialesAuth('ACCOUNT_NOT_AVAILABLE', 401);
    }

    await this.dependencias.limitador.descontarReservaExitosa('RECOVERY', userId, direccionIp);

    return credencial;
  }

  /** Solicita cambio o verificación del correo después de validar la contraseña actual. */
  public async solicitarCambioCorreo(
    userId: string,
    contrasenaActual: string,
    correoNuevo: string,
    direccionIp: string,
    requestId: string,
  ): Promise<'ACEPTADA' | 'LIMITADA'> {
    this.exigirCorreoHabilitado();
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
      await this.registrarCambioCorreoNoEnumerativo(userId, userId, cuenta.role, requestId);
      return 'ACEPTADA';
    }

    try {
      await this.crearYEnviarToken(
        cuenta,
        esVerificacionActual ? 'EMAIL_VERIFICATION' : 'EMAIL_CHANGE',
        esVerificacionActual ? null : email,
        { userId, role: cuenta.role, propia: true },
        requestId,
      );
    } catch (error) {
      if (!esCorreoOcupado(error)) throw error;
      await this.registrarCambioCorreoNoEnumerativo(userId, userId, cuenta.role, requestId);
    }

    return 'ACEPTADA';
  }

  /** Completa cambio/verificación de correo aceptando solo ambos propósitos de correo. */
  public async completarCambioCorreo(
    token: string,
    direccionIp: string,
    requestId: string,
  ): Promise<void> {
    this.exigirCorreoHabilitado();
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
    actor: ActorSesionAdmin,
    direccionIp: string,
    requestId: string,
  ): Promise<'ACEPTADA' | 'LIMITADA' | 'DELIVERY_FAILED'> {
    this.exigirCorreoHabilitado();
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

    const entregada = await this.crearYEnviarToken(
      cuenta,
      'ACTIVATION',
      null,
      actor,
      requestId,
      true,
    );

    return entregada ? 'ACEPTADA' : 'DELIVERY_FAILED';
  }

  /** Envía al ADMIN un enlace de restablecimiento o de activación sin asignar credenciales. */
  public async solicitarRestablecimientoAdmin(
    userId: string,
    actor: ActorSesionAdmin,
    direccionIp: string,
    requestId: string,
  ): Promise<'ACEPTADA' | 'LIMITADA' | 'DELIVERY_FAILED'> {
    this.exigirCorreoHabilitado();
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
    const entregada = await this.crearYEnviarToken(
      cuenta,
      purpose,
      null,
      actor,
      requestId,
      purpose === 'ACTIVATION',
    );

    if (purpose === 'ACTIVATION' && !entregada) return 'DELIVERY_FAILED';

    return 'ACEPTADA';
  }

  /** Solicita correo nuevo por ADMIN sin cambiarlo antes de consumir el enlace. */
  public async solicitarCambioCorreoAdmin(
    userId: string,
    correoNuevo: string,
    actor: ActorSesionAdmin,
    direccionIp: string,
    requestId: string,
  ): Promise<'ACEPTADA' | 'LIMITADA'> {
    this.exigirCorreoHabilitado();
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
      await this.registrarCambioCorreoNoEnumerativo(actor.userId, userId, actor.role, requestId);
      return 'ACEPTADA';
    }

    try {
      await this.crearYEnviarToken(cuenta, 'EMAIL_CHANGE', email, actor, requestId);
    } catch (error) {
      if (!esCorreoOcupado(error)) throw error;
      await this.registrarCambioCorreoNoEnumerativo(actor.userId, userId, actor.role, requestId);
    }

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

    await this.dependencias.limitador.descontarReservaExitosa(
      'RECOVERY',
      calcularDigestTokenOpaco(token),
      direccionIp,
    );
  }

  /** Falla antes de consultar cuentas o guardar tokens si el runtime no envía correo. */
  private exigirCorreoHabilitado(): void {
    if (!this.dependencias.correoHabilitado) {
      throw new ErrorCredencialesAuth('EMAIL_DELIVERY_DISABLED', 503);
    }
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

  /**
   * Solicita la emisión con la cuenta observada y despacha correo después del commit.
   * @param cuenta Credenciales, estado y dirección que deben seguir vigentes.
   * @param purpose Flujo que se autoriza con el digest.
   * @param targetEmail Dirección pendiente exclusivamente para cambio de correo.
   * @param actor Identidad administrativa o propia cuando corresponda.
   * @param requestId Identificador de correlación sin datos de cuenta.
   * @remarks Una solicitud obsoleta no despacha ningún enlace.
   */
  private async crearYEnviarToken(
    cuenta: CuentaCredencialesAuth,
    purpose: EntradaTokenRecuperacionAuth['purpose'],
    targetEmail: string | null,
    actor:
      | ActorSesionAdmin
      | { readonly propia: true; readonly userId: string; readonly role: RolUsuario }
      | null,
    requestId: string,
    esperarEntrega = false,
  ): Promise<boolean> {
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
    let emitido: boolean;
    try {
      emitido = await this.dependencias.repositorio.crearToken(
        entrada,
        this.crearEvento(actor?.userId ?? null, cuenta.id, accion, 'SUCCESS', metadata),
        cuenta,
        actor === null || 'propia' in actor ? null : actor.sessionId,
      );
    } catch (error) {
      if (
        error instanceof ErrorRepositorioUsuariosAdmin &&
        (error.code === 'FORBIDDEN' || error.code === 'AUTH_REQUIRED')
      ) {
        throw new ErrorCredencialesAuth(error.code, error.code === 'FORBIDDEN' ? 403 : 401);
      }
      throw error;
    }
    if (!emitido) return false;
    const mensaje: MensajeCorreoAuth = {
      tipo: tipoCorreoToken(purpose),
      destinatario: purpose === 'EMAIL_CHANGE' ? (targetEmail ?? cuenta.email) : cuenta.email,
      enlace: crearEnlaceCorreoAuth(this.dependencias.publicAppOrigin, purpose, token.valor),
      venceEn: entrada.expiresAt,
    };
    if (!esperarEntrega) {
      this.enviarEnSegundoPlano(mensaje, cuenta.id, actor, requestId);
      return true;
    }

    try {
      await this.dependencias.correo.enviar(mensaje);
      return true;
    } catch {
      await this.registrarFalloEntrega(cuenta.id, actor, requestId);
      return false;
    }
  }

  /** Entrega correo sin bloquear la respuesta pública ni propagar error sensible del transporte. */
  private enviarEnSegundoPlano(
    mensaje: MensajeCorreoAuth,
    userId: string,
    actor: { readonly userId: string; readonly role: RolUsuario } | null,
    requestId: string,
  ): void {
    try {
      void this.dependencias.correo
        .enviar(mensaje)
        .catch(() => this.registrarFalloEntrega(userId, actor, requestId));
    } catch {
      void this.registrarFalloEntrega(userId, actor, requestId);
    }
  }

  /** Registra un fallo de entrega sin conservar destinatarios, URL, token o causa SMTP. */
  private async registrarFalloEntrega(
    userId: string,
    actor: { readonly userId: string; readonly role: RolUsuario } | null,
    requestId: string,
  ): Promise<void> {
    try {
      await this.dependencias.auditoria.registrar(
        this.crearEvento(
          actor?.userId ?? null,
          actor === null ? null : userId,
          'RECOVERY_DELIVERY_FAILED',
          'FAILURE',
          { requestId },
        ),
      );
    } catch {
      // El fallo de auditoría no debe convertir un error SMTP en un error con datos sensibles.
    }
  }

  /** Registra una solicitud de cambio suprimida con la misma forma de auditoría que una emitida. */
  private registrarCambioCorreoNoEnumerativo(
    actorUserId: string,
    userId: string,
    role: RolUsuario,
    requestId: string,
  ): Promise<void> {
    return this.dependencias.auditoria.registrar(
      this.crearEvento(actorUserId, userId, 'AUTH_EMAIL_CHANGE_REQUESTED', 'SUCCESS', {
        purpose: 'EMAIL_CHANGE',
        actorRole: role,
        requestId,
      }),
    );
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

/** Identifica únicamente conflictos de correo que deben recibir la respuesta genérica. */
function esCorreoOcupado(error: unknown): boolean {
  return error instanceof ErrorRepositorioUsuariosAdmin && error.code === 'EMAIL_TAKEN';
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
