import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresAuthRepository } from '../../apps/api/src/auth/postgres-auth-repository.js';
import { ServicioSesion } from '../../apps/api/src/auth/session-service.js';
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';
import { sessions, users } from '../../apps/api/src/db/schema.js';
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
