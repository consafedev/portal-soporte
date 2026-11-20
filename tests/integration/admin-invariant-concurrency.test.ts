import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicioUsuariosAdmin } from '../../apps/api/src/auth/admin-user-service.js';
import { Argon2PasswordHasher } from '../../apps/api/src/auth/argon2-password-hasher.js';
import {
  crearAdministradorInicial,
  type TerminalBootstrapAdmin,
} from '../../apps/api/src/auth/bootstrap-admin.js';
import { PostgresAuthRepository } from '../../apps/api/src/auth/postgres-auth-repository.js';
import { ServicioSesion } from '../../apps/api/src/auth/session-service.js';
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';
import { auditEvents, users, sessions } from '../../apps/api/src/db/schema.js';
import { crearClienteMigradorPruebas } from '../support/test-database-clients.js';
import type { RelojAuth } from '../../packages/core/src/auth/ports.js';

const urlBase = process.env['TEST_DATABASE_URL'];
const database =
  urlBase === undefined
    ? null
    : crearClienteBaseDatosAuth({ DATABASE_URL: urlBase, NODE_ENV: 'test' });
const databaseMigrador = crearClienteMigradorPruebas();
const idsAdministradores = [randomUUID(), randomUUID()] as const;
let idsBootstrapCreados: string[] = [];
const sufijo = randomUUID().slice(0, 8);
const passwordSintetico = 'Bootstrap de prueba local segura ñ';
const ahora = new Date();
const relojFijo: RelojAuth = {
  /** Devuelve una copia del instante fijado para la integración concurrente. */
  ahora(): Date {
    return new Date(ahora);
  },
};

/** Asegura que las carreras se prueben contra el PostgreSQL efímero del harness. */
function exigirBasePrueba(): NonNullable<typeof database> {
  if (database === null) {
    throw new Error('La prueba de concurrencia requiere PostgreSQL real aislado.');
  }

  return database;
}

/** Crea un terminal no interactivo en UI, pero interactivo al invocarse en TTY real. */
function crearTerminalPrueba(): TerminalBootstrapAdmin {
  return {
    esInteractiva: () => true,
    async leerContrasenaSinEco() {
      return passwordSintetico;
    },
  };
}

/** Prepara dos administradores activos para competir por el último lugar. */
async function prepararAdministradores(): Promise<void> {
  const hasheador = new Argon2PasswordHasher();
  const hash = await hasheador.hash(passwordSintetico);
  await exigirBasePrueba()
    .insert(users)
    .values(
      idsAdministradores.map((id, indice) => {
        const username = `admin_race_${indice}_${sufijo}`;
        const correo = `${username}@example.test`;

        return {
          id,
          username,
          usernameNormalized: username,
          displayName: `Admin de carrera ${indice}`,
          email: correo,
          emailNormalized: correo,
          emailVerifiedAt: new Date(ahora),
          passwordHash: hash,
          role: 'ADMIN' as const,
          status: 'ACTIVE' as const,
        };
      }),
    );
}

/** Elimina solo los usuarios sintéticos que la suite de concurrencia creó. */
async function limpiarAdministradores(): Promise<void> {
  const idsTemporales = [...idsAdministradores, ...idsBootstrapCreados];
  const migrador = exigirBaseMigrador();
  await migrador
    .delete(auditEvents)
    .where(
      and(inArray(auditEvents.actorUserId, idsTemporales), eq(auditEvents.outcome, 'SUCCESS')),
    );
  await migrador.delete(auditEvents).where(inArray(auditEvents.targetUserId, idsTemporales));
  await migrador.delete(users).where(inArray(users.id, idsTemporales));
  await databaseMigrador?.$client.end({ timeout: 5 });
  await exigirBasePrueba().$client.end({ timeout: 5 });
}

/** Recupera el cliente migrador reservado para preparar y limpiar fixtures sintéticos. */
function exigirBaseMigrador(): NonNullable<typeof databaseMigrador> {
  if (databaseMigrador === null) {
    throw new Error('La limpieza requiere el rol migrador de PostgreSQL de prueba.');
  }

  return databaseMigrador;
}

/** Ejecuta carreras reales entre transacciones independientes de PostgreSQL. */
function definirPruebasDeInvariantes(): void {
  it('exige que la sesión pertenezca al actor y que la cuenta siga activa con rol ADMIN', async () => {
    const base = exigirBasePrueba();
    const repositorio = new PostgresAuthRepository(base);
    const servicio = new ServicioUsuariosAdmin(repositorio, relojFijo, new Argon2PasswordHasher());
    const [idActor, destino] = idsAdministradores;
    const { sessionId } = await new ServicioSesion(repositorio, relojFijo).crear(idActor);
    const actor = { userId: idActor, sessionId, role: 'ADMIN' as const, requestId: 'membresia' };
    try {
      await expect(
        servicio.revocarSesiones(destino, { ...actor, userId: destino }),
      ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
      await base.update(users).set({ role: 'SUPPORT' }).where(eq(users.id, idActor));
      await expect(servicio.revocarSesiones(destino, actor)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await base
        .update(users)
        .set({ role: 'ADMIN', status: 'DISABLED' })
        .where(eq(users.id, idActor));
      await expect(servicio.revocarSesiones(destino, actor)).rejects.toMatchObject({
        code: 'AUTH_REQUIRED',
      });
    } finally {
      await base
        .update(users)
        .set({ role: 'ADMIN', status: 'ACTIVE' })
        .where(eq(users.id, idActor));
    }
  });
  it('deniega alta, edición, revocación y emisión con la sesión del actor vencida', async () => {
    const base = exigirBasePrueba();
    const repositorio = new PostgresAuthRepository(base);
    const servicio = new ServicioUsuariosAdmin(repositorio, relojFijo, new Argon2PasswordHasher());
    const gestorSesiones = new ServicioSesion(repositorio, relojFijo);
    const { sessionId } = await gestorSesiones.crear(idsAdministradores[0]);
    await gestorSesiones.crear(idsAdministradores[0]);
    await base
      .update(sessions)
      .set({ idleExpiresAt: new Date(0) })
      .where(eq(sessions.id, sessionId));
    const actor = {
      userId: idsAdministradores[0],
      sessionId,
      role: 'ADMIN' as const,
      requestId: 'vigencia',
    };
    const destino = idsAdministradores[1];
    const cuenta = await repositorio.buscarCuentaPorId(destino);
    if (!cuenta) throw new Error('Falta la cuenta sintética.');
    const alta = {
      username: `alta_${sufijo}`,
      email: `alta_${sufijo}@example.test`,
      displayName: 'Alta sintética',
      role: 'SUPPORT' as const,
    };
    try {
      await expect(servicio.crear(alta, actor)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
      await expect(
        servicio.actualizar(destino, { displayName: 'Cambio sintético' }, actor),
      ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
      await expect(servicio.revocarSesiones(destino, actor)).rejects.toMatchObject({
        code: 'AUTH_REQUIRED',
      });
      await expect(
        repositorio.crearToken(
          {
            id: randomUUID(),
            userId: destino,
            purpose: 'PASSWORD_RECOVERY',
            targetEmail: null,
            tokenHash: 'e'.repeat(64),
            createdAt: ahora,
            expiresAt: new Date(ahora.getTime() + 60_000),
          },
          {
            actorUserId: actor.userId,
            targetUserId: destino,
            action: 'AUTH_RECOVERY_TOKEN_ISSUED',
            outcome: 'SUCCESS',
            metadata: { requestId: actor.requestId },
            createdAt: ahora,
          },
          cuenta,
          actor.sessionId,
        ),
      ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    } finally {
      const [usuarioTemporal] = await base
        .select({ id: users.id })
        .from(users)
        .where(eq(users.usernameNormalized, alta.username));
      if (usuarioTemporal !== undefined) {
        const migrador = exigirBaseMigrador();
        await migrador.delete(auditEvents).where(eq(auditEvents.actorUserId, usuarioTemporal.id));
        await migrador.delete(auditEvents).where(eq(auditEvents.targetUserId, usuarioTemporal.id));
        await migrador.delete(users).where(eq(users.id, usuarioTemporal.id));
      }
    }
  });
  it('revalida la sesión exacta tras serializar dos cambios de rol concurrentes', async () => {
    const base = exigirBasePrueba();
    const repositorio = new PostgresAuthRepository(base);
    const administracion = new ServicioUsuariosAdmin(
      repositorio,
      relojFijo,
      new Argon2PasswordHasher(),
    );
    const sesiones = new ServicioSesion(repositorio, relojFijo);
    const [primera, segunda] = await Promise.all(
      idsAdministradores.map((id) => sesiones.crear(id)),
    );
    if (!primera || !segunda) throw new Error('Faltan sesiones sintéticas.');
    try {
      const resultados = await Promise.allSettled([
        administracion.actualizar(
          idsAdministradores[1],
          { role: 'SUPPORT' },
          {
            userId: idsAdministradores[0],
            role: 'ADMIN',
            sessionId: primera.sessionId,
            requestId: 'admin-a',
          },
        ),
        administracion.actualizar(
          idsAdministradores[0],
          { role: 'SUPPORT' },
          {
            userId: idsAdministradores[1],
            role: 'ADMIN',
            sessionId: segunda.sessionId,
            requestId: 'admin-b',
          },
        ),
      ]);
      expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(1);
      expect(resultados.find((resultado) => resultado.status === 'rejected')).toMatchObject({
        reason: { code: 'AUTH_REQUIRED' },
      });
    } finally {
      await base
        .update(users)
        .set({ role: 'ADMIN' })
        .where(inArray(users.id, [...idsAdministradores]));
    }
  });
  it('serializa la democión de dos administradores y conserva uno activo', async () => {
    const base = exigirBasePrueba();
    const servicioA = new ServicioUsuariosAdmin(
      new PostgresAuthRepository(base),
      relojFijo,
      new Argon2PasswordHasher(),
    );
    const servicioB = new ServicioUsuariosAdmin(
      new PostgresAuthRepository(base),
      relojFijo,
      new Argon2PasswordHasher(),
    );
    const sesiones = new ServicioSesion(new PostgresAuthRepository(base), relojFijo);
    const sesionA = await sesiones.crear(idsAdministradores[0]);
    const sesionB = await sesiones.crear(idsAdministradores[1]);
    const resultados = await Promise.allSettled([
      servicioA.actualizar(
        idsAdministradores[0],
        { role: 'SUPPORT' },
        {
          userId: idsAdministradores[0],
          sessionId: sesionA.sessionId,
          role: 'ADMIN',
          requestId: 'race-demotion-a',
        },
      ),
      servicioB.actualizar(
        idsAdministradores[1],
        { status: 'DISABLED' },
        {
          userId: idsAdministradores[1],
          sessionId: sesionB.sessionId,
          role: 'ADMIN',
          requestId: 'race-demotion-b',
        },
      ),
    ]);
    const activos = await base
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'ACTIVE')));

    expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((resultado) => resultado.status === 'rejected')).toHaveLength(1);
    expect(activos).toHaveLength(1);
  });

  it('permite como máximo un bootstrap entre dos solicitudes concurrentes', async () => {
    const base = exigirBasePrueba();
    const migrador = exigirBaseMigrador();
    await migrador
      .delete(auditEvents)
      .where(inArray(auditEvents.actorUserId, [...idsAdministradores]));
    await migrador
      .delete(auditEvents)
      .where(inArray(auditEvents.targetUserId, [...idsAdministradores]));
    await migrador.delete(users).where(inArray(users.id, [...idsAdministradores]));
    const repositorio = new PostgresAuthRepository(base);
    const resultados = await Promise.allSettled(
      [0, 1].map((indice) =>
        crearAdministradorInicial(
          {
            username: `bootstrap_${indice}_${sufijo}`,
            email: `bootstrap_${indice}_${sufijo}@example.test`,
            displayName: `Bootstrap sintético ${indice}`,
          },
          crearTerminalPrueba(),
          repositorio,
        ),
      ),
    );
    const exitos = resultados.flatMap((resultado) =>
      resultado.status === 'fulfilled' ? [resultado.value.id] : [],
    );
    idsBootstrapCreados = exitos;
    const activos = await base
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'ACTIVE')));

    expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((resultado) => resultado.status === 'rejected')).toHaveLength(1);
    expect(activos.filter((usuario) => exitos.includes(usuario.id))).toHaveLength(1);
  });
}

describe('invariantes administrativos con PostgreSQL real', definirPruebasDeInvariantes);
beforeAll(prepararAdministradores);
afterAll(limpiarAdministradores);
