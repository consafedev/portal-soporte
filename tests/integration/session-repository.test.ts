import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresAuthRepository } from '../../apps/api/src/auth/postgres-auth-repository.js';
import { ServicioSesion } from '../../apps/api/src/auth/session-service.js';
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';
import { auditEvents, recoveryTokens, sessions, users } from '../../apps/api/src/db/schema.js';
import type { RelojAuth } from '../../packages/core/src/auth/ports.js';

const baseUrl = process.env['TEST_DATABASE_URL'];
const database =
  baseUrl === undefined
    ? null
    : crearClienteBaseDatosAuth({ DATABASE_URL: baseUrl, NODE_ENV: 'test' });
const repositorio = database === null ? null : new PostgresAuthRepository(database);

/** Reloj fijo para comprobar expiraciones de sesión sin depender del host. */
class RelojIntegracion implements RelojAuth {
  private instante = new Date('2026-11-17T12:00:00.000Z');

  /** Devuelve el instante estable de las pruebas de integración. */
  ahora(): Date {
    return new Date(this.instante);
  }

  /** Cambia la hora del servidor simulada para comprobar extensión de inactividad. */
  fijar(instante: Date): void {
    this.instante = new Date(instante);
  }
}

const relojFijo = new RelojIntegracion();
const instanteInicial = new Date('2026-11-17T12:00:00.000Z');

/** Recupera el cliente de base de datos de la suite o falla con mensaje sin conexión. */
function exigirBaseDatos(): NonNullable<typeof database> {
  if (database === null) {
    throw new Error('La suite requiere PostgreSQL real aislado.');
  }

  return database;
}

/** Recupera el repositorio PostgreSQL de la suite o falla con un error controlado. */
function exigirRepositorio(): PostgresAuthRepository {
  if (repositorio === null) {
    throw new Error('La suite requiere el repositorio PostgreSQL.');
  }

  return repositorio;
}

/** Inserta una cuenta sintética activa que solo vive durante un caso de prueba. */
async function crearUsuarioIntegracion(): Promise<string> {
  const id = randomUUID();
  const sufijo = id.slice(0, 8);
  await exigirBaseDatos()
    .insert(users)
    .values({
      id,
      username: `test_${sufijo}`,
      usernameNormalized: `test_${sufijo}`,
      displayName: 'Cuenta Sintética',
      email: `test_${sufijo}@example.test`,
      emailNormalized: `test_${sufijo}@example.test`,
      passwordHash: 'hash-sintetico-de-integracion',
      role: 'SUPPORT',
      status: 'ACTIVE',
    });

  return id;
}

/** Elimina únicamente la cuenta sintética creada por el caso actual. */
async function borrarUsuarioIntegracion(userId: string): Promise<void> {
  await exigirBaseDatos().delete(users).where(eq(users.id, userId));
}

/** Cierra el pool de la suite al terminar los casos PostgreSQL. */
async function cerrarBaseIntegracion(): Promise<void> {
  await database?.$client.end({ timeout: 5 });
}

/** Agrupa casos de persistencia real de sesiones opacas y consulta de rol vigente. */
function definirPruebasDeRepositorioSesion(): void {
  it('guarda solo el digest y resuelve cuenta y rol actuales', pruebaDigestYRolVigente);
  it('deniega sesión revocada y sesión de cuenta desactivada', pruebaRevocacionYDesactivacion);
  it('renueva el límite inactivo sin mover la expiración absoluta', pruebaRenovacionPostgres);
  it('exige el hash vigente para confirmar el login y su auditoría', async () => {
    const repositorio = exigirRepositorio();
    const userId = await crearUsuarioIntegracion();
    try {
      const sesion = sesionSintetica(userId);
      const evento = eventoSintetico(userId);
      const usuario = await repositorio.confirmarLogin(
        sesion,
        'hash-anterior',
        `test_${userId.slice(0, 8)}`,
        evento,
      );
      expect(usuario).toBeNull();
      expect(
        await exigirBaseDatos()
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.userId, userId)),
      ).toHaveLength(0);
    } finally {
      await borrarUsuarioIntegracion(userId);
    }
  });
  it('descarta un cambio voluntario basado en un hash anterior', async () => {
    const userId = await crearUsuarioIntegracion();
    try {
      const actualizado = await exigirRepositorio().cambiarContrasena(
        sesionSintetica(userId),
        'hash-anterior',
        'hash-nuevo',
        eventoSintetico(userId),
      );
      expect(actualizado).toBe(false);
      expect((await exigirRepositorio().buscarCuentaPorId(userId))?.passwordHash).toBe(
        'hash-sintetico-de-integracion',
      );
    } finally {
      await borrarUsuarioIntegracion(userId);
    }
  });
  it('descarta la emisión cuando cambió el correo leído', async () => {
    const repositorio = exigirRepositorio();
    const userId = await crearUsuarioIntegracion();
    try {
      const cuenta = await repositorio.buscarCuentaPorId(userId);
      if (!cuenta) throw new Error('Falta la cuenta sintética.');
      const token = {
        id: randomUUID(),
        userId,
        tokenHash: 'b'.repeat(64),
        targetEmail: null,
        purpose: 'EMAIL_VERIFICATION' as const,
        createdAt: instanteInicial,
        expiresAt: new Date(instanteInicial.getTime() + 60_000),
      };
      const emitido = await repositorio.crearToken(
        token,
        eventoSintetico(userId),
        {
          ...cuenta,
          emailNormalized: 'anterior@example.test',
        },
        null,
      );
      expect(emitido).toBe(false);
      expect(
        await exigirBaseDatos()
          .select({ id: recoveryTokens.id })
          .from(recoveryTokens)
          .where(eq(recoveryTokens.userId, userId)),
      ).toHaveLength(0);
    } finally {
      await borrarUsuarioIntegracion(userId);
    }
  });
  it('conserva un único token vigente tras dos emisiones del mismo propósito', async () => {
    const repositorio = exigirRepositorio();
    const userId = await crearUsuarioIntegracion();
    try {
      const cuenta = await repositorio.buscarCuentaPorId(userId);
      if (!cuenta) throw new Error('Falta la cuenta sintética.');
      const resultados = await Promise.all(
        ['c', 'd'].map((letra) =>
          repositorio.crearToken(
            {
              id: randomUUID(),
              userId,
              tokenHash: letra.repeat(64),
              purpose: 'EMAIL_VERIFICATION',
              targetEmail: null,
              createdAt: instanteInicial,
              expiresAt: new Date(instanteInicial.getTime() + 60_000),
            },
            eventoSintetico(userId),
            cuenta,
            null,
          ),
        ),
      );
      expect(resultados).toEqual([true, true]);
      expect(
        await exigirBaseDatos()
          .select({ id: recoveryTokens.id })
          .from(recoveryTokens)
          .where(and(eq(recoveryTokens.userId, userId), isNull(recoveryTokens.usedAt))),
      ).toHaveLength(1);
    } finally {
      await borrarUsuarioIntegracion(userId);
    }
  });
  it('revierte hash, sesiones y auditoría si falla la inserción de la sesión rotada', async () => {
    const base = exigirBaseDatos();
    const repositorio = exigirRepositorio();
    const userId = await crearUsuarioIntegracion();
    try {
      const sesion = sesionSintetica(userId);
      await repositorio.crear(sesion);
      await expect(
        repositorio.cambiarContrasena(
          sesion,
          'hash-sintetico-de-integracion',
          'hash-nuevo',
          eventoSintetico(userId),
        ),
      ).rejects.toThrow();
      expect((await repositorio.buscarCuentaPorId(userId))?.passwordHash).toBe(
        'hash-sintetico-de-integracion',
      );
      expect((await repositorio.buscarPorHash(sesion.tokenHash))?.sesion.revokedAt).toBeNull();
      expect(
        await base
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(eq(auditEvents.targetUserId, userId)),
      ).toHaveLength(0);
    } finally {
      await borrarUsuarioIntegracion(userId);
    }
  });
}

/** Devuelve un registro de sesión sintético para comprobar transacciones del repositorio. */
function sesionSintetica(userId: string) {
  return {
    id: randomUUID(),
    userId,
    tokenHash: 'a'.repeat(64),
    createdAt: instanteInicial,
    lastUsedAt: instanteInicial,
    idleExpiresAt: new Date(instanteInicial.getTime() + 60_000),
    absoluteExpiresAt: new Date(instanteInicial.getTime() + 120_000),
  };
}

/** Genera un evento sintético dirigido a la cuenta aislada del caso. */
function eventoSintetico(userId: string) {
  return {
    actorUserId: userId,
    targetUserId: userId,
    action: 'AUTH_TEST',
    outcome: 'SUCCESS' as const,
    metadata: {},
    createdAt: instanteInicial,
  };
}

/** Comprueba almacenamiento exclusivo del digest y lectura de la identidad actual. */
async function pruebaDigestYRolVigente(): Promise<void> {
  const base = exigirBaseDatos();
  const userId = await crearUsuarioIntegracion();

  try {
    const servicio = new ServicioSesion(exigirRepositorio(), relojFijo);
    const credencial = await servicio.crear(userId);
    const filas = await base
      .select({ tokenHash: sessions.tokenHash })
      .from(sessions)
      .where(eq(sessions.id, credencial.sessionId));
    const vigente = await servicio.resolverVigente(credencial.token);

    expect(filas).toHaveLength(1);
    expect(filas[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(filas[0]?.tokenHash).not.toBe(credencial.token);
    expect(vigente?.usuario).toMatchObject({ id: userId, role: 'SUPPORT', status: 'ACTIVE' });

    await base.update(users).set({ role: 'ADMIN' }).where(eq(users.id, userId));
    await expect(servicio.resolverVigente(credencial.token)).resolves.toMatchObject({
      usuario: { role: 'ADMIN' },
    });
  } finally {
    await borrarUsuarioIntegracion(userId);
  }
}

/** Comprueba que revocar o desactivar invalide la siguiente resolución PostgreSQL. */
async function pruebaRevocacionYDesactivacion(): Promise<void> {
  const base = exigirBaseDatos();
  const userId = await crearUsuarioIntegracion();

  try {
    const servicio = new ServicioSesion(exigirRepositorio(), relojFijo);
    const credencialRevocada = await servicio.crear(userId);
    await servicio.revocar(credencialRevocada.token);
    await expect(servicio.resolverVigente(credencialRevocada.token)).resolves.toBeNull();

    const credencialDesactivada = await servicio.crear(userId);
    await base.update(users).set({ status: 'DISABLED' }).where(eq(users.id, userId));
    await expect(servicio.resolverVigente(credencialDesactivada.token)).resolves.toBeNull();
  } finally {
    await borrarUsuarioIntegracion(userId);
  }
}

/** Comprueba contra PostgreSQL el avance de actividad sin extender el plazo absoluto. */
async function pruebaRenovacionPostgres(): Promise<void> {
  const base = exigirBaseDatos();
  const userId = await crearUsuarioIntegracion();

  try {
    relojFijo.fijar(instanteInicial);
    const servicio = new ServicioSesion(exigirRepositorio(), relojFijo);
    const credencial = await servicio.crear(userId);
    const antes = await base
      .select({ absoluteExpiresAt: sessions.absoluteExpiresAt })
      .from(sessions)
      .where(eq(sessions.id, credencial.sessionId));
    relojFijo.fijar(new Date(instanteInicial.getTime() + 10 * 60_000));
    const vigente = await servicio.resolverVigente(credencial.token);
    const despues = await base
      .select({ absoluteExpiresAt: sessions.absoluteExpiresAt })
      .from(sessions)
      .where(eq(sessions.id, credencial.sessionId));

    expect(vigente?.idleExpiresAt).toEqual(new Date(instanteInicial.getTime() + 40 * 60_000));
    expect(despues[0]?.absoluteExpiresAt).toEqual(antes[0]?.absoluteExpiresAt);
  } finally {
    relojFijo.fijar(instanteInicial);
    await borrarUsuarioIntegracion(userId);
  }
}

describe('repositorio de sesiones PostgreSQL', definirPruebasDeRepositorioSesion);
afterAll(cerrarBaseIntegracion);
