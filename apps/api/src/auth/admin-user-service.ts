import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import {
  recoveryRequestSchema,
  type SolicitudAltaUsuarioAdmin,
  type SolicitudModificacionUsuarioAdmin,
} from '../../../../packages/contracts/src/auth.js';
import {
  normalizarCorreo,
  normalizarUsuario,
  esNombreUsuarioValido,
} from '../../../../packages/core/src/auth/policies.js';
import type {
  CambiosUsuarioAdminPersistidos,
  EntradaUsuarioAdminPersistida,
  RepositorioUsuariosAdmin,
} from '../../../../packages/core/src/auth/admin-ports.js';
import { ErrorRepositorioUsuariosAdmin } from '../../../../packages/core/src/auth/admin-ports.js';
import type {
  RespuestaUsuarioAdmin,
  RolUsuario,
} from '../../../../packages/core/src/auth/models.js';
import type { RelojAuth } from '../../../../packages/core/src/auth/ports.js';

export type {
  EntradaBootstrapAdminPersistida,
  RepositorioBootstrapAdmin,
} from '../../../../packages/core/src/auth/admin-ports.js';

/** Rol e identidad autenticada que autorizó una operación administrativa. */
export interface ActorUsuarioAdmin {
  /** UUID del actor verificado por el prehandler de sesión. */
  readonly userId: string;
  /** Rol actual obtenido desde PostgreSQL para esta petición. */
  readonly role: RolUsuario;
  /** Identificador de solicitud no secreto para correlación de auditoría. */
  readonly requestId: string;
}

/** Error estable de una operación administrativa, apto para traducir a HTTP. */
export class ErrorUsuarioAdmin extends Error {
  /** Construye un error sin valores de entrada, SQL, contraseñas o metadatos internos. */
  public constructor(
    public readonly code: string,
    public readonly statusCode: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'ErrorUsuarioAdmin';
  }
}

/** Administra cuentas del portal sin conceder autoridad a los datos del cliente. */
export class ServicioUsuariosAdmin {
  /** Construye el caso de uso con un repositorio transaccional y reloj sustituible. */
  public constructor(
    private readonly repositorio: RepositorioUsuariosAdmin,
    private readonly reloj: RelojAuth,
  ) {}

  /** Lista DTOs administrativos acotados; nunca obtiene hashes o secretos. */
  public listar(): Promise<readonly RespuestaUsuarioAdmin[]> {
    return this.repositorio.listarUsuarios();
  }

  /** Crea una cuenta pendiente sin asignar contraseña ni marcar correo verificado. */
  public async crear(
    solicitud: SolicitudAltaUsuarioAdmin,
    actor: ActorUsuarioAdmin,
  ): Promise<RespuestaUsuarioAdmin> {
    const username = normalizarUsuario(solicitud.username);
    const email = normalizarCorreo(solicitud.email);
    const displayName = solicitud.displayName.trim();
    if (!esNombreUsuarioValido(solicitud.username)) {
      throw new ErrorUsuarioAdmin('INVALID_USERNAME', 400);
    }
    if (!Value.Check(recoveryRequestSchema, { email })) {
      throw new ErrorUsuarioAdmin('INVALID_EMAIL', 400);
    }
    if (displayName.length === 0 || Array.from(displayName).length > 120) {
      throw new ErrorUsuarioAdmin('INVALID_DISPLAY_NAME', 400);
    }

    const ahora = this.reloj.ahora();
    const entrada: EntradaUsuarioAdminPersistida = {
      id: randomUUID(),
      username,
      usernameNormalized: username,
      displayName,
      email,
      emailNormalized: email,
      emailVerifiedAt: null,
      passwordHash: null,
      role: solicitud.role,
      status: 'PENDING_ACTIVATION',
      createdAt: ahora,
      updatedAt: ahora,
    };

    try {
      return await this.repositorio.crearUsuario(
        entrada,
        this.crearEvento(actor, 'ADMIN_USER_CREATED', entrada.id, {
          role: solicitud.role,
        }),
      );
    } catch (error) {
      throw traducirErrorRepositorio(error);
    }
  }

  /** Modifica campos permitidos y exige el flujo de verificación para cualquier correo. */
  public async actualizar(
    idUsuario: string,
    solicitud: SolicitudModificacionUsuarioAdmin,
    actor: ActorUsuarioAdmin,
  ): Promise<RespuestaUsuarioAdmin> {
    if (solicitud.email !== undefined) {
      throw new ErrorUsuarioAdmin('EMAIL_VERIFICATION_REQUIRED', 409);
    }

    const cambios: Omit<CambiosUsuarioAdminPersistidos, 'updatedAt'> = {};
    const camposModificados: string[] = [];

    if (solicitud.username !== undefined) {
      if (!esNombreUsuarioValido(solicitud.username)) {
        throw new ErrorUsuarioAdmin('INVALID_USERNAME', 400);
      }
      const username = normalizarUsuario(solicitud.username);
      Object.assign(cambios, { username, usernameNormalized: username });
      camposModificados.push('username');
    }
    if (solicitud.displayName !== undefined) {
      const displayName = solicitud.displayName.trim();
      if (displayName.length === 0 || Array.from(displayName).length > 120) {
        throw new ErrorUsuarioAdmin('INVALID_DISPLAY_NAME', 400);
      }
      Object.assign(cambios, { displayName });
      camposModificados.push('displayName');
    }
    if (solicitud.role !== undefined) {
      Object.assign(cambios, { role: solicitud.role });
      camposModificados.push('role');
    }
    if (solicitud.status !== undefined) {
      Object.assign(cambios, { status: solicitud.status });
      camposModificados.push('status');
    }

    const ahora = this.reloj.ahora();
    const entrada: CambiosUsuarioAdminPersistidos = { ...cambios, updatedAt: ahora };
    try {
      const usuario = await this.repositorio.actualizarUsuario(
        idUsuario,
        entrada,
        this.crearEvento(actor, 'ADMIN_USER_UPDATED', idUsuario, {
          changedFields: camposModificados.join(','),
        }),
      );
      if (usuario === null) {
        throw new ErrorUsuarioAdmin('USER_NOT_FOUND', 404);
      }

      return usuario;
    } catch (error) {
      throw traducirErrorRepositorio(error);
    }
  }

  /** Revoca en bloque sesiones del objetivo y entrega únicamente la cantidad revocada. */
  public async revocarSesiones(idUsuario: string, actor: ActorUsuarioAdmin): Promise<number> {
    try {
      const cantidad = await this.repositorio.revocarSesionesAdmin(
        idUsuario,
        this.reloj.ahora(),
        this.crearEvento(actor, 'ADMIN_USER_SESSIONS_REVOKED', idUsuario, {}),
      );
      if (cantidad === null) {
        throw new ErrorUsuarioAdmin('USER_NOT_FOUND', 404);
      }

      return cantidad;
    } catch (error) {
      throw traducirErrorRepositorio(error);
    }
  }

  /** Crea un evento de auditoría allowlistado y correlacionado con la solicitud. */
  private crearEvento(
    actor: ActorUsuarioAdmin,
    action: string,
    targetUserId: string | null,
    metadata: Readonly<Record<string, string | number | boolean | null>>,
  ) {
    return {
      actorUserId: actor.userId,
      action,
      targetUserId,
      outcome: 'SUCCESS' as const,
      metadata: { ...metadata, actorRole: actor.role, requestId: actor.requestId },
      createdAt: this.reloj.ahora(),
    };
  }
}

/** Convierte errores de persistencia a códigos HTTP estables sin incluir detalles internos. */
function traducirErrorRepositorio(error: unknown): ErrorUsuarioAdmin {
  if (!(error instanceof ErrorRepositorioUsuariosAdmin)) {
    if (error instanceof ErrorUsuarioAdmin) {
      return error;
    }

    return new ErrorUsuarioAdmin('ADMIN_OPERATION_FAILED', 503);
  }

  const estadosHttp: Record<typeof error.code, 404 | 409 | 503> = {
    ADMIN_ALREADY_EXISTS: 409,
    LAST_ADMIN_REQUIRED: 409,
    AUTH_INVARIANT_UNAVAILABLE: 503,
    USER_NOT_FOUND: 404,
    USERNAME_TAKEN: 409,
    EMAIL_TAKEN: 409,
    ACTIVATION_REQUIRED: 409,
  };

  return new ErrorUsuarioAdmin(error.code, estadosHttp[error.code]);
}
