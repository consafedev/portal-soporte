import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, exists, isNull, sql } from 'drizzle-orm';
import type {
  AsignacionClienteUsuario,
  CapacidadCliente,
  ClienteAccesible,
  EstadoAutorizacionCliente,
  EstadoCapacidadCliente,
  RepositorioAccesoCliente,
  ResultadoConcesionAccesoCliente,
  UsuarioAccesoCliente,
} from '../../../../packages/core/src/clients/client-access-ports.js';
import type { ActorAdministracionClientes } from '../../../../packages/core/src/clients/ports.js';
import type { BaseDatosAuth } from '../db/client.js';
import {
  auditEvents,
  clientCapabilities,
  clientUserAssignments,
  clients,
  users,
} from '../db/schema.js';

/** Persiste autorizaciones por cliente y audita cambios en la misma transacción. */
export class PostgresClientAccessRepository implements RepositorioAccesoCliente {
  /** Recibe el pool limitado al esquema portal de la instancia PostgreSQL. */
  public constructor(private readonly database: BaseDatosAuth) {}

  /** Consulta solo rol y estado actual; nunca selecciona hash o correo de autenticación. */
  public async buscarUsuarioActual(userId: string): Promise<UsuarioAccesoCliente | null> {
    const [usuario] = await this.database
      .select({ role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return usuario ?? null;
  }

  /** Lista clientes activos con rf-1:read solo para una cuenta ADMIN aún activa. */
  public async listarClientesGlobales(actorUserId: string): Promise<readonly ClienteAccesible[]> {
    const filas = await this.database
      .select({ id: clients.id, nombre: clients.displayName, estado: clients.status })
      .from(clients)
      .innerJoin(
        clientCapabilities,
        and(
          eq(clientCapabilities.clientId, clients.id),
          eq(clientCapabilities.capabilityId, 'rf-1:read'),
          eq(clientCapabilities.enabled, true),
        ),
      )
      .where(
        and(
          eq(clients.status, 'ACTIVE'),
          exists(
            this.database
              .select({ id: users.id })
              .from(users)
              .where(
                and(eq(users.id, actorUserId), eq(users.role, 'ADMIN'), eq(users.status, 'ACTIVE')),
              ),
          ),
        ),
      )
      .orderBy(asc(sql`lower(${clients.displayName})`), asc(clients.id));
    return filas;
  }

  /** Lista clientes activos asignados con rf-1:read para un SUPPORT todavía activo. */
  public async listarClientesAsignados(userId: string): Promise<readonly ClienteAccesible[]> {
    const filas = await this.database
      .select({ id: clients.id, nombre: clients.displayName, estado: clients.status })
      .from(clients)
      .innerJoin(
        clientUserAssignments,
        and(
          eq(clientUserAssignments.clientId, clients.id),
          eq(clientUserAssignments.userId, userId),
          isNull(clientUserAssignments.revokedAt),
        ),
      )
      .innerJoin(
        clientCapabilities,
        and(
          eq(clientCapabilities.clientId, clients.id),
          eq(clientCapabilities.capabilityId, 'rf-1:read'),
          eq(clientCapabilities.enabled, true),
        ),
      )
      .where(
        and(
          eq(clients.status, 'ACTIVE'),
          exists(
            this.database
              .select({ id: users.id })
              .from(users)
              .where(
                and(eq(users.id, userId), eq(users.role, 'SUPPORT'), eq(users.status, 'ACTIVE')),
              ),
          ),
        ),
      )
      .orderBy(asc(sql`lower(${clients.displayName})`), asc(clients.id));
    return filas;
  }

  /** Lista historial de asignaciones con identidad visible y fechas, sin correo ni actores. */
  public async listarAsignaciones(clientId: string): Promise<readonly AsignacionClienteUsuario[]> {
    const filas = await this.database
      .select({
        userId: users.id,
        displayName: users.displayName,
        userStatus: users.status,
        grantedAt: clientUserAssignments.grantedAt,
        revokedAt: clientUserAssignments.revokedAt,
      })
      .from(clientUserAssignments)
      .innerJoin(users, eq(users.id, clientUserAssignments.userId))
      .where(eq(clientUserAssignments.clientId, clientId))
      .orderBy(asc(sql`lower(${users.displayName})`), desc(clientUserAssignments.grantedAt));
    return filas;
  }

  /** Devuelve ambas capacidades conocidas; una fila ausente equivale a apagada sin fecha. */
  public async listarCapacidades(clientId: string): Promise<readonly EstadoCapacidadCliente[]> {
    const filas = await this.database
      .select({
        capabilityId: clientCapabilities.capabilityId,
        enabled: clientCapabilities.enabled,
        changedAt: clientCapabilities.changedAt,
      })
      .from(clientCapabilities)
      .where(eq(clientCapabilities.clientId, clientId));
    const porId = new Map(filas.map((fila) => [fila.capabilityId, fila]));

    return (['rf-1:read', 'rf-1:execute'] as const).map((capabilityId) => {
      const fila = porId.get(capabilityId);
      return {
        clientId,
        capabilityId,
        enabled: fila?.enabled ?? false,
        changedAt: fila?.changedAt ?? null,
      };
    });
  }

  /** Concede o reactiva acceso con candados de actor, cliente y usuario y auditoría atómica. */
  public async conceder(
    clientId: string,
    userId: string,
    actor: ActorAdministracionClientes,
  ): Promise<ResultadoConcesionAccesoCliente> {
    return this.database.transaction(async (transaccion) => {
      const administrador = await bloquearUsuario(transaccion, actor.actorUserId);
      if (administrador?.role !== 'ADMIN' || administrador.status !== 'ACTIVE') {
        return 'ACTOR_FORBIDDEN';
      }
      const [cliente] = await transaccion
        .select({ status: clients.status })
        .from(clients)
        .where(eq(clients.id, clientId))
        .for('update')
        .limit(1);
      if (cliente === undefined) {
        return 'CLIENT_NOT_FOUND';
      }
      if (cliente.status !== 'ACTIVE') {
        return 'CLIENT_INACTIVE';
      }
      const soporte = await bloquearUsuario(transaccion, userId);
      if (soporte === null) {
        return 'USER_NOT_FOUND';
      }
      if (soporte.role !== 'SUPPORT') {
        return 'USER_NOT_SUPPORT';
      }
      if (soporte.status !== 'ACTIVE') {
        return 'USER_INACTIVE';
      }

      const [fila] = await transaccion
        .insert(clientUserAssignments)
        .values({
          id: randomUUID(),
          clientId,
          userId,
          grantedByUserId: actor.actorUserId,
          grantedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: clientUserAssignments.id });
      if (fila === undefined) {
        return 'ALREADY_ACTIVE';
      }

      await registrarAuditoriaAcceso(transaccion, {
        actor,
        clientId,
        targetUserId: userId,
        action: 'CLIENT_ACCESS_GRANTED',
      });
      return 'CREATED';
    });
  }

  /** Revoca solo una concesión activa y confirma su auditoría en la misma transacción. */
  public async revocar(
    clientId: string,
    userId: string,
    actor: ActorAdministracionClientes,
  ): Promise<'REVOKED' | 'NOT_FOUND' | 'ACTOR_FORBIDDEN'> {
    return this.database.transaction(async (transaccion) => {
      const administrador = await bloquearUsuario(transaccion, actor.actorUserId);
      if (administrador?.role !== 'ADMIN' || administrador.status !== 'ACTIVE') {
        return 'ACTOR_FORBIDDEN';
      }
      await transaccion
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, clientId))
        .for('update')
        .limit(1);
      const revocadoEn = new Date();
      const [fila] = await transaccion
        .update(clientUserAssignments)
        .set({ revokedByUserId: actor.actorUserId, revokedAt: revocadoEn })
        .where(
          and(
            eq(clientUserAssignments.clientId, clientId),
            eq(clientUserAssignments.userId, userId),
            isNull(clientUserAssignments.revokedAt),
          ),
        )
        .returning({ id: clientUserAssignments.id });
      if (fila === undefined) {
        return 'NOT_FOUND';
      }

      await registrarAuditoriaAcceso(transaccion, {
        actor,
        clientId,
        targetUserId: userId,
        action: 'CLIENT_ACCESS_REVOKED',
      });
      return 'REVOKED';
    });
  }

  /** Upsert atómico de una capacidad con validación de ADMIN y auditoría transaccional. */
  public async establecerCapacidad(
    clientId: string,
    capacidad: CapacidadCliente,
    habilitada: boolean,
    actor: ActorAdministracionClientes,
  ): Promise<'UPDATED' | 'CLIENT_NOT_FOUND' | 'ACTOR_FORBIDDEN'> {
    return this.database.transaction(async (transaccion) => {
      const administrador = await bloquearUsuario(transaccion, actor.actorUserId);
      if (administrador?.role !== 'ADMIN' || administrador.status !== 'ACTIVE') {
        return 'ACTOR_FORBIDDEN';
      }
      const [cliente] = await transaccion
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, clientId))
        .for('update')
        .limit(1);
      if (cliente === undefined) {
        return 'CLIENT_NOT_FOUND';
      }

      await transaccion
        .insert(clientCapabilities)
        .values({
          clientId,
          capabilityId: capacidad,
          enabled: habilitada,
          changedByUserId: actor.actorUserId,
          changedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [clientCapabilities.clientId, clientCapabilities.capabilityId],
          set: {
            enabled: habilitada,
            changedByUserId: actor.actorUserId,
            changedAt: new Date(),
          },
        });
      await registrarAuditoriaAcceso(transaccion, {
        actor,
        clientId,
        action: 'CLIENT_CAPABILITY_UPDATED',
        capabilityId: capacidad,
        enabled: habilitada,
      });
      return 'UPDATED';
    });
  }

  /** Lee identidad, pertenencia, asignación y capacidad en una consulta sin caché. */
  public async consultarEstadoAutorizacion(
    userId: string,
    clientId: string,
    capacidad: CapacidadCliente,
  ): Promise<EstadoAutorizacionCliente> {
    const [fila] = await this.database
      .select({
        usuarioId: users.id,
        role: users.role,
        status: users.status,
        estadoCliente: clients.status,
        capacidadHabilitada: clientCapabilities.enabled,
        asignacionId: clientUserAssignments.id,
      })
      .from(users)
      .leftJoin(clients, eq(clients.id, clientId))
      .leftJoin(
        clientCapabilities,
        and(
          eq(clientCapabilities.clientId, clients.id),
          eq(clientCapabilities.capabilityId, capacidad),
        ),
      )
      .leftJoin(
        clientUserAssignments,
        and(
          eq(clientUserAssignments.clientId, clients.id),
          eq(clientUserAssignments.userId, users.id),
          isNull(clientUserAssignments.revokedAt),
        ),
      )
      .where(eq(users.id, userId))
      .limit(1);
    if (fila === undefined) {
      return {
        usuario: null,
        estadoCliente: null,
        capacidadHabilitada: false,
        asignacionVigente: false,
      };
    }

    return {
      usuario: { role: fila.role, status: fila.status },
      estadoCliente: fila.estadoCliente,
      capacidadHabilitada: fila.capacidadHabilitada ?? false,
      asignacionVigente: fila.asignacionId !== null,
    };
  }
}

/** Bloquea la cuenta y devuelve únicamente su rol y estado vigentes. */
async function bloquearUsuario(
  transaccion: Parameters<Parameters<BaseDatosAuth['transaction']>[0]>[0],
  userId: string,
): Promise<UsuarioAccesoCliente | null> {
  const [usuario] = await transaccion
    .select({ role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
    .limit(1);
  return usuario ?? null;
}

/** Registra solo identificadores y valores allowlisted, dentro de la transacción mutante. */
async function registrarAuditoriaAcceso(
  transaccion: Parameters<Parameters<BaseDatosAuth['transaction']>[0]>[0],
  evento: {
    readonly actor: ActorAdministracionClientes;
    readonly clientId: string;
    readonly targetUserId?: string;
    readonly action:
      'CLIENT_ACCESS_GRANTED' | 'CLIENT_ACCESS_REVOKED' | 'CLIENT_CAPABILITY_UPDATED';
    readonly capabilityId?: CapacidadCliente;
    readonly enabled?: boolean;
  },
): Promise<void> {
  await transaccion.insert(auditEvents).values({
    id: randomUUID(),
    actorUserId: evento.actor.actorUserId,
    targetUserId: evento.targetUserId ?? null,
    action: evento.action,
    outcome: 'SUCCESS',
    metadata: {
      clientId: evento.clientId,
      requestId: evento.actor.requestId,
      ...(evento.capabilityId === undefined ? {} : { capabilityId: evento.capabilityId }),
      ...(evento.enabled === undefined ? {} : { enabled: evento.enabled }),
    },
    createdAt: new Date(),
  });
}
