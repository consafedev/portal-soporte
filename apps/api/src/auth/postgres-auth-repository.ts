import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type {
  CuentaAutenticacion,
  EscritorAuditoriaAuth,
  EventoAuditoriaAuth,
  RepositorioAutenticacion,
  RenovacionSesion,
  RegistroSesionActual,
  SesionPersistida,
} from '../../../../packages/core/src/auth/ports.js';
import type { RespuestaUsuarioAdmin } from '../../../../packages/core/src/auth/models.js';
import type {
  CambioConsumoTokenAuth,
  CuentaCredencialesAuth,
  EntradaTokenRecuperacionAuth,
  RepositorioCredencialesAuth,
} from '../../../../packages/core/src/auth/recovery-ports.js';
import type {
  CambiosUsuarioAdminPersistidos,
  EntradaBootstrapAdminPersistida,
  EntradaUsuarioAdminPersistida,
  RepositorioUsuariosAdmin,
} from '../../../../packages/core/src/auth/admin-ports.js';
import { ErrorRepositorioUsuariosAdmin } from '../../../../packages/core/src/auth/admin-ports.js';
import type { BaseDatosAuth } from '../db/client.js';
import { auditEvents, authInvariants, recoveryTokens, sessions, users } from '../db/schema.js';

const columnasUsuarioAdmin = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  role: users.role,
  email: users.email,
  emailVerifiedAt: users.emailVerifiedAt,
  status: users.status,
  createdAt: users.createdAt,
} as const;

const columnasCredenciales = {
  id: users.id,
  usernameNormalized: users.usernameNormalized,
  email: users.email,
  emailNormalized: users.emailNormalized,
  emailVerifiedAt: users.emailVerifiedAt,
  passwordHash: users.passwordHash,
  role: users.role,
  status: users.status,
} as const;

/** Implementa la persistencia de credenciales y sesiones sobre PostgreSQL. */
export class PostgresAuthRepository
  implements
    RepositorioAutenticacion,
    RepositorioUsuariosAdmin,
    RepositorioCredencialesAuth,
    EscritorAuditoriaAuth
{
  /** Construye el repositorio con la conexión limitada del núcleo de autenticación. */
  public constructor(private readonly database: BaseDatosAuth) {}

  /** Busca por username canónico y devuelve el hash solo al servicio de autenticación. */
  public async buscarCuentaPorUsuarioNormalizado(
    username: string,
  ): Promise<CuentaAutenticacion | null> {
    const [cuenta] = await this.database
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        status: users.status,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.usernameNormalized, username))
      .limit(1);

    return cuenta ?? null;
  }

  /** Inserta solo el digest de una sesión y sus límites de expiración. */
  public async crear(entrada: SesionPersistida): Promise<void> {
    await this.database.insert(sessions).values({
      id: entrada.id,
      userId: entrada.userId,
      tokenHash: entrada.tokenHash,
      createdAt: entrada.createdAt,
      lastUsedAt: entrada.lastUsedAt,
      idleExpiresAt: entrada.idleExpiresAt,
      absoluteExpiresAt: entrada.absoluteExpiresAt,
    });
  }

  /** Resuelve el digest junto con el rol y estado actuales de la cuenta. */
  public async buscarPorHash(tokenHash: string): Promise<RegistroSesionActual | null> {
    const [registro] = await this.database
      .select({
        sesion: {
          id: sessions.id,
          userId: sessions.userId,
          tokenHash: sessions.tokenHash,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
          idleExpiresAt: sessions.idleExpiresAt,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
          revokedAt: sessions.revokedAt,
        },
        usuario: {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          role: users.role,
          status: users.status,
        },
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    return registro ?? null;
  }

  /** Renueva actividad de forma atómica si sesión y cuenta aún autorizan. */
  public async renovar(entrada: RenovacionSesion): Promise<boolean> {
    const filas = await this.database
      .update(sessions)
      .set({
        lastUsedAt: entrada.ahora,
        idleExpiresAt: entrada.venceInactivoEn,
      })
      .where(
        and(
          eq(sessions.id, entrada.sessionId),
          eq(sessions.tokenHash, entrada.tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.idleExpiresAt, entrada.ahora),
          gt(sessions.absoluteExpiresAt, entrada.ahora),
          sql`EXISTS (
            SELECT 1 FROM ${users}
            WHERE ${users.id} = ${sessions.userId}
              AND ${users.status} = 'ACTIVE'
          )`,
        ),
      )
      .returning({ id: sessions.id });

    return filas.length === 1;
  }

  /** Marca como revocada una sesión todavía activa identificada por su digest. */
  public async revocarPorHash(tokenHash: string, revocadaEn: Date): Promise<boolean> {
    const filas = await this.database
      .update(sessions)
      .set({ revokedAt: revocadaEn })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });

    return filas.length === 1;
  }

  /** Revoca sesiones activas del usuario conservando opcionalmente la sesión actual. */
  public async revocarSesionesDeUsuario(
    userId: string,
    conservarSesionId: string | null,
    revocadaEn: Date,
  ): Promise<number> {
    const condiciones = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
    if (conservarSesionId !== null) {
      condiciones.push(ne(sessions.id, conservarSesionId));
    }

    const filas = await this.database
      .update(sessions)
      .set({ revokedAt: revocadaEn })
      .where(and(...condiciones))
      .returning({ id: sessions.id });

    return filas.length;
  }

  /** Inserta un evento de autenticación autónomo sin incluir datos de cuenta en logs. */
  public async registrar(evento: EventoAuditoriaAuth): Promise<void> {
    await this.database.insert(auditEvents).values(crearFilaAuditoria(evento));
  }

  /** Lista usuarios administrativos limitando columnas a las permitidas por el contrato. */
  public listarUsuarios(): Promise<readonly RespuestaUsuarioAdmin[]> {
    return this.database.select(columnasUsuarioAdmin).from(users).orderBy(users.usernameNormalized);
  }

  /** Busca una cuenta por correo canónico sin filtrar su estado al servicio de dominio. */
  public async buscarCuentaPorCorreo(
    emailNormalizado: string,
  ): Promise<CuentaCredencialesAuth | null> {
    const [cuenta] = await this.database
      .select(columnasCredenciales)
      .from(users)
      .where(eq(users.emailNormalized, emailNormalizado))
      .limit(1);

    return cuenta ?? null;
  }

  /** Busca campos mínimos de recuperación por UUID sin seleccionar datos de auditoría. */
  public async buscarCuentaPorId(userId: string): Promise<CuentaCredencialesAuth | null> {
    const [cuenta] = await this.database
      .select(columnasCredenciales)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return cuenta ?? null;
  }

  /** Reemplaza tokens previos del propósito, guarda digest y evento en una transacción. */
  public async crearToken(
    entrada: EntradaTokenRecuperacionAuth,
    evento: EventoAuditoriaAuth,
  ): Promise<void> {
    await this.database.transaction(async (transaccion) => {
      await transaccion
        .update(recoveryTokens)
        .set({ usedAt: entrada.createdAt })
        .where(
          and(
            eq(recoveryTokens.userId, entrada.userId),
            eq(recoveryTokens.purpose, entrada.purpose),
            isNull(recoveryTokens.usedAt),
          ),
        );
      await transaccion.insert(recoveryTokens).values(entrada);
      await transaccion.insert(auditEvents).values(crearFilaAuditoria(evento));
    });
  }

  /** Consume un solo token de propósito exacto y confirma usuario, sesiones y auditoría. */
  public async consumirToken(
    tokenHash: string,
    cambio: CambioConsumoTokenAuth,
    ahora: Date,
    evento: EventoAuditoriaAuth,
  ): Promise<boolean> {
    try {
      return await this.database.transaction(
        async (transaccion) => {
          await bloquearInvarianteAdministradores(transaccion);
          const [token] = await transaccion
            .select({
              id: recoveryTokens.id,
              userId: recoveryTokens.userId,
              targetEmail: recoveryTokens.targetEmail,
            })
            .from(recoveryTokens)
            .where(
              and(
                eq(recoveryTokens.tokenHash, tokenHash),
                eq(recoveryTokens.purpose, cambio.purpose),
                isNull(recoveryTokens.usedAt),
                gt(recoveryTokens.expiresAt, ahora),
              ),
            )
            .for('update')
            .limit(1);
          if (token === undefined) {
            return false;
          }

          const [cuenta] = await transaccion
            .select(columnasCredenciales)
            .from(users)
            .where(eq(users.id, token.userId))
            .for('update')
            .limit(1);
          if (cuenta === undefined || !puedeConsumirToken(cuenta, token.targetEmail, cambio)) {
            return false;
          }

          if (cambio.purpose === 'ACTIVATION' && cuenta.role === 'ADMIN') {
            await contarAdministradoresActivos(transaccion);
          }

          await aplicarCambioToken(transaccion, cuenta, token.targetEmail, cambio, ahora);
          await transaccion
            .update(recoveryTokens)
            .set({ usedAt: ahora })
            .where(and(eq(recoveryTokens.userId, cuenta.id), isNull(recoveryTokens.usedAt)));
          if (cambio.purpose === 'PASSWORD_RECOVERY') {
            await transaccion
              .update(sessions)
              .set({ revokedAt: ahora })
              .where(and(eq(sessions.userId, cuenta.id), isNull(sessions.revokedAt)));
          }
          await transaccion
            .insert(auditEvents)
            .values(crearFilaAuditoria({ ...evento, targetUserId: cuenta.id }));

          return true;
        },
        { isolationLevel: 'read committed' },
      );
    } catch (error) {
      traducirErrorUnicidad(error);
    }
  }

  /** Cambia hash, invalida sesiones/tokens y audita sin permitir una ventana parcial. */
  public async cambiarContrasena(
    userId: string,
    passwordHash: string,
    ahora: Date,
    evento: EventoAuditoriaAuth,
  ): Promise<boolean> {
    return this.database.transaction(async (transaccion) => {
      const [cuenta] = await transaccion
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.id, userId))
        .for('update')
        .limit(1);
      if (cuenta === undefined || cuenta.status !== 'ACTIVE') {
        return false;
      }

      await transaccion
        .update(users)
        .set({ passwordHash, updatedAt: ahora })
        .where(eq(users.id, userId));
      await transaccion
        .update(sessions)
        .set({ revokedAt: ahora })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      await transaccion
        .update(recoveryTokens)
        .set({ usedAt: ahora })
        .where(and(eq(recoveryTokens.userId, userId), isNull(recoveryTokens.usedAt)));
      await transaccion.insert(auditEvents).values(crearFilaAuditoria(evento));

      return true;
    });
  }

  /** Inserta una invitación y audita la operación dentro de READ COMMITTED. */
  public async crearUsuario(
    entrada: EntradaUsuarioAdminPersistida,
    evento: EventoAuditoriaAuth,
  ): Promise<RespuestaUsuarioAdmin> {
    try {
      return await this.database.transaction(
        async (transaccion) => {
          if (entrada.role === 'ADMIN') {
            await bloquearInvarianteAdministradores(transaccion);
            await contarAdministradoresActivos(transaccion);
          }

          const [usuario] = await transaccion
            .insert(users)
            .values(entrada)
            .returning(columnasUsuarioAdmin);
          if (usuario === undefined) {
            throw new Error('La inserción de usuario no devolvió una fila.');
          }

          await transaccion.insert(auditEvents).values(crearFilaAuditoria(evento));

          return usuario;
        },
        { isolationLevel: 'read committed' },
      );
    } catch (error) {
      traducirErrorUnicidad(error);
    }
  }

  /** Actualiza identidad y roles, protege al último ADMIN y revoca sesiones en la misma transacción. */
  public async actualizarUsuario(
    idUsuario: string,
    cambios: CambiosUsuarioAdminPersistidos,
    evento: EventoAuditoriaAuth,
  ): Promise<RespuestaUsuarioAdmin | null> {
    try {
      return await this.database.transaction(
        async (transaccion) => {
          await bloquearInvarianteAdministradores(transaccion);
          const [anterior] = await transaccion
            .select({
              role: users.role,
              status: users.status,
              passwordHash: users.passwordHash,
            })
            .from(users)
            .where(eq(users.id, idUsuario))
            .limit(1);
          if (anterior === undefined) {
            return null;
          }

          const cantidadAdministradores = await contarAdministradoresActivos(transaccion);
          const roleNuevo = cambios.role ?? anterior.role;
          const statusNuevo = cambios.status ?? anterior.status;
          const sigueActivoAdmin = roleNuevo === 'ADMIN' && statusNuevo === 'ACTIVE';
          if (
            anterior.role === 'ADMIN' &&
            anterior.status === 'ACTIVE' &&
            !sigueActivoAdmin &&
            cantidadAdministradores <= 1
          ) {
            throw new ErrorRepositorioUsuariosAdmin('LAST_ADMIN_REQUIRED');
          }
          if (
            statusNuevo !== anterior.status &&
            (anterior.status === 'PENDING_ACTIVATION' || anterior.passwordHash === null)
          ) {
            throw new ErrorRepositorioUsuariosAdmin('ACTIVATION_REQUIRED');
          }
          if (statusNuevo === 'PENDING_ACTIVATION' && anterior.passwordHash !== null) {
            throw new ErrorRepositorioUsuariosAdmin('ACTIVATION_REQUIRED');
          }

          const [usuario] = await transaccion
            .update(users)
            .set(cambios)
            .where(eq(users.id, idUsuario))
            .returning(columnasUsuarioAdmin);
          if (usuario === undefined) {
            return null;
          }

          const cambióMembresia =
            (cambios.role !== undefined && cambios.role !== anterior.role) ||
            (cambios.status !== undefined && cambios.status !== anterior.status);
          if (cambióMembresia) {
            await revocarCredencialesPendientes(transaccion, idUsuario, cambios.updatedAt);
          }

          await transaccion.insert(auditEvents).values(crearFilaAuditoria(evento));

          return usuario;
        },
        { isolationLevel: 'read committed' },
      );
    } catch (error) {
      traducirErrorUnicidad(error);
    }
  }

  /** Revoca todas las sesiones del objetivo y audita el recuento en una transacción. */
  public async revocarSesionesAdmin(
    idUsuario: string,
    revocadasEn: Date,
    evento: EventoAuditoriaAuth,
  ): Promise<number | null> {
    return this.database.transaction(
      async (transaccion) => {
        const [cuenta] = await transaccion
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, idUsuario))
          .limit(1);
        if (cuenta === undefined) {
          return null;
        }

        const revocadas = await transaccion
          .update(sessions)
          .set({ revokedAt: revocadasEn })
          .where(and(eq(sessions.userId, idUsuario), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        await revocarCredencialesPendientes(transaccion, idUsuario, revocadasEn);
        await transaccion.insert(auditEvents).values(
          crearFilaAuditoria({
            ...evento,
            metadata: { ...evento.metadata, revokedSessions: revocadas.length },
          }),
        );

        return revocadas.length;
      },
      { isolationLevel: 'read committed' },
    );
  }

  /** Crea el primer ADMIN solo tras bloquear y recontar la membresía en PostgreSQL. */
  public async crearAdministradorInicial(
    entrada: EntradaBootstrapAdminPersistida,
    evento: EventoAuditoriaAuth,
  ): Promise<RespuestaUsuarioAdmin> {
    try {
      return await this.database.transaction(
        async (transaccion) => {
          await bloquearInvarianteAdministradores(transaccion);
          if ((await contarAdministradoresActivos(transaccion)) > 0) {
            throw new ErrorRepositorioUsuariosAdmin('ADMIN_ALREADY_EXISTS');
          }

          const [usuario] = await transaccion
            .insert(users)
            .values(entrada)
            .returning(columnasUsuarioAdmin);
          if (usuario === undefined) {
            throw new Error('La inserción inicial no devolvió una cuenta.');
          }
          await transaccion.insert(auditEvents).values(crearFilaAuditoria(evento));

          return usuario;
        },
        { isolationLevel: 'read committed' },
      );
    } catch (error) {
      traducirErrorUnicidad(error);
    }
  }
}

/** Exige la fila singleton como primer paso de cualquier transacción de membresía ADMIN. */
async function bloquearInvarianteAdministradores(
  transaccion: Parameters<Parameters<BaseDatosAuth['transaction']>[0]>[0],
): Promise<void> {
  const [fila] = await transaccion
    .select({ id: authInvariants.id })
    .from(authInvariants)
    .where(eq(authInvariants.id, 1))
    .for('update')
    .limit(1);
  if (fila === undefined) {
    throw new ErrorRepositorioUsuariosAdmin('AUTH_INVARIANT_UNAVAILABLE');
  }
}

/** Confirma que el estado actual de la cuenta admite el propósito de token solicitado. */
function puedeConsumirToken(
  cuenta: CuentaCredencialesAuth,
  targetEmail: string | null,
  cambio: CambioConsumoTokenAuth,
): boolean {
  if (cambio.purpose === 'ACTIVATION') {
    return (
      targetEmail === null && cuenta.status === 'PENDING_ACTIVATION' && cuenta.passwordHash === null
    );
  }
  if (cambio.purpose === 'PASSWORD_RECOVERY') {
    return (
      targetEmail === null &&
      cuenta.status === 'ACTIVE' &&
      cuenta.emailVerifiedAt !== null &&
      cuenta.passwordHash !== null
    );
  }
  if (cambio.purpose === 'EMAIL_CHANGE') {
    return targetEmail !== null && cuenta.status === 'ACTIVE';
  }

  return targetEmail === null && cuenta.status === 'ACTIVE' && cuenta.emailVerifiedAt === null;
}

/** Aplica el cambio autorizado por token mientras la fila de usuario está bloqueada. */
async function aplicarCambioToken(
  transaccion: Parameters<Parameters<BaseDatosAuth['transaction']>[0]>[0],
  cuenta: CuentaCredencialesAuth,
  targetEmail: string | null,
  cambio: CambioConsumoTokenAuth,
  ahora: Date,
): Promise<void> {
  if (cambio.purpose === 'ACTIVATION') {
    await transaccion
      .update(users)
      .set({
        passwordHash: cambio.passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: ahora,
        updatedAt: ahora,
      })
      .where(eq(users.id, cuenta.id));
    return;
  }
  if (cambio.purpose === 'PASSWORD_RECOVERY') {
    await transaccion
      .update(users)
      .set({ passwordHash: cambio.passwordHash, updatedAt: ahora })
      .where(eq(users.id, cuenta.id));
    return;
  }
  if (cambio.purpose === 'EMAIL_CHANGE') {
    if (targetEmail === null) {
      throw new Error('El token de cambio de correo no tiene destino persistido.');
    }
    await transaccion
      .update(users)
      .set({
        email: targetEmail,
        emailNormalized: targetEmail,
        emailVerifiedAt: ahora,
        updatedAt: ahora,
      })
      .where(eq(users.id, cuenta.id));
    return;
  }

  await transaccion
    .update(users)
    .set({ emailVerifiedAt: ahora, updatedAt: ahora })
    .where(eq(users.id, cuenta.id));
}

/** Cuenta ADMIN activos en una sentencia posterior al bloqueo singleton. */
async function contarAdministradoresActivos(
  transaccion: Parameters<Parameters<BaseDatosAuth['transaction']>[0]>[0],
): Promise<number> {
  const [resultado] = await transaccion
    .select({ cantidad: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'ACTIVE')));

  return Number(resultado?.cantidad ?? 0);
}

/** Revoca sesiones y tokens pendientes cuando cambian rol, estado o acceso administrativo. */
async function revocarCredencialesPendientes(
  transaccion: Parameters<Parameters<BaseDatosAuth['transaction']>[0]>[0],
  idUsuario: string,
  instante: Date,
): Promise<void> {
  await transaccion
    .update(sessions)
    .set({ revokedAt: instante })
    .where(and(eq(sessions.userId, idUsuario), isNull(sessions.revokedAt)));
  await transaccion
    .update(recoveryTokens)
    .set({ usedAt: instante })
    .where(and(eq(recoveryTokens.userId, idUsuario), isNull(recoveryTokens.usedAt)));
}

/** Convierte un evento de auditoría en una fila persistible con UUID de servidor. */
function crearFilaAuditoria(evento: EventoAuditoriaAuth) {
  return {
    id: randomUUID(),
    actorUserId: evento.actorUserId,
    targetUserId: evento.targetUserId,
    action: evento.action,
    outcome: evento.outcome,
    metadata: evento.metadata,
    createdAt: evento.createdAt,
  };
}

/** Traduce solo constraints de unicidad conocidas sin conservar el mensaje SQL del proveedor. */
function traducirErrorUnicidad(error: unknown): never {
  const errorPostgres = encontrarErrorPostgres(error);
  if (errorPostgres?.code !== '23505') {
    throw error;
  }

  const constraint = errorPostgres.constraint_name;
  if (constraint === 'users_username_normalized_unique') {
    throw new ErrorRepositorioUsuariosAdmin('USERNAME_TAKEN');
  }
  if (constraint === 'users_email_normalized_unique') {
    throw new ErrorRepositorioUsuariosAdmin('EMAIL_TAKEN');
  }

  throw error;
}

/** Busca en causas limitadas el SQLSTATE y constraint sin leer mensajes ni parámetros SQL. */
function encontrarErrorPostgres(
  error: unknown,
  visitados = new Set<object>(),
  profundidad = 0,
): { code: unknown; constraint_name: unknown } | null {
  if (typeof error !== 'object' || error === null || visitados.has(error) || profundidad > 3) {
    return null;
  }

  visitados.add(error);
  if ('code' in error && error.code === '23505') {
    return {
      code: error.code,
      constraint_name: 'constraint_name' in error ? error.constraint_name : undefined,
    };
  }

  return 'cause' in error ? encontrarErrorPostgres(error.cause, visitados, profundidad + 1) : null;
}
