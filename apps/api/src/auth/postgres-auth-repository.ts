import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type {
  CuentaAutenticacion,
  RepositorioAutenticacion,
  RenovacionSesion,
  RegistroSesionActual,
  SesionPersistida,
} from '../../../../packages/core/src/auth/ports.js';
import type { BaseDatosAuth } from '../db/client.js';
import { sessions, users } from '../db/schema.js';

/** Implementa la persistencia de credenciales y sesiones sobre PostgreSQL. */
export class PostgresAuthRepository implements RepositorioAutenticacion {
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
}
