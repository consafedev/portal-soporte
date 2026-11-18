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
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';
import { auditEvents, users } from '../../apps/api/src/db/schema.js';
import type { RelojAuth } from '../../packages/core/src/auth/ports.js';

const urlBase = process.env['TEST_DATABASE_URL'];
const database =
  urlBase === undefined
    ? null
    : crearClienteBaseDatosAuth({ DATABASE_URL: urlBase, NODE_ENV: 'test' });
const idsAdministradores = [randomUUID(), randomUUID()] as const;
let idsBootstrapCreados: string[] = [];
const sufijo = randomUUID().slice(0, 8);
const passwordSintetico = 'Bootstrap de prueba local segura ñ';
const ahora = new Date('2026-11-17T14:00:00.000Z');
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
  await exigirBasePrueba()
    .delete(auditEvents)
    .where(
      and(inArray(auditEvents.actorUserId, idsTemporales), eq(auditEvents.outcome, 'SUCCESS')),
    );
  await exigirBasePrueba()
    .delete(auditEvents)
    .where(inArray(auditEvents.targetUserId, idsTemporales));
  await exigirBasePrueba().delete(users).where(inArray(users.id, idsTemporales));
  await exigirBasePrueba().$client.end({ timeout: 5 });
}

/** Ejecuta carreras reales entre transacciones independientes de PostgreSQL. */
function definirPruebasDeInvariantes(): void {
  it('serializa la democión de dos administradores y conserva uno activo', async () => {
    const base = exigirBasePrueba();
    const servicioA = new ServicioUsuariosAdmin(new PostgresAuthRepository(base), relojFijo);
    const servicioB = new ServicioUsuariosAdmin(new PostgresAuthRepository(base), relojFijo);
    const resultados = await Promise.allSettled([
      servicioA.actualizar(
        idsAdministradores[0],
        { role: 'SUPPORT' },
        {
          userId: idsAdministradores[0],
          role: 'ADMIN',
          requestId: 'race-demotion-a',
        },
      ),
      servicioB.actualizar(
        idsAdministradores[1],
        { status: 'DISABLED' },
        {
          userId: idsAdministradores[1],
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
    await base.delete(users).where(inArray(users.id, [...idsAdministradores]));
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
