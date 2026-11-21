import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import type {
  ActorAdministracionClientes,
  AmbienteSapCliente,
  AltaAmbienteSapPersistida,
  AltaClientePersistida,
  CambiosAmbienteSapPersistidos,
  CambiosClientePersistidos,
  ClientePortal,
  RepositorioClientes,
  ResultadoActualizacionAmbienteSap,
  ResultadoAltaAmbienteSap,
} from '../../../../packages/core/src/clients/ports.js';
import type { BaseDatosAuth } from '../db/client.js';
import { auditEvents, clientSapEnvironments, clients } from '../db/schema.js';

/** Persiste clientes y ambientes SAP con auditoría en la misma transacción. */
export class PostgresClientRepository implements RepositorioClientes {
  /** Recibe el cliente PostgreSQL limitado al esquema del Portal. */
  public constructor(private readonly database: BaseDatosAuth) {}

  /** Lista metadatos de cliente sin exponer perfiles ni credenciales. */
  public async listar(): Promise<readonly ClientePortal[]> {
    const filas = await this.database
      .select()
      .from(clients)
      .orderBy(asc(sql`lower(${clients.displayName})`), asc(clients.id));

    return filas.map(mapearClientePortal);
  }

  /** Crea un cliente y audita la acción sin incluir su nombre en metadatos. */
  public async crear(
    entrada: AltaClientePersistida,
    actor: ActorAdministracionClientes,
  ): Promise<ClientePortal> {
    return this.database.transaction(async (transaccion) => {
      const [fila] = await transaccion
        .insert(clients)
        .values({
          id: entrada.id,
          displayName: entrada.nombre,
          status: 'ACTIVE',
          createdByUserId: actor.actorUserId,
          createdAt: entrada.createdAt,
          updatedAt: entrada.createdAt,
        })
        .returning();
      if (fila === undefined) {
        throw new Error('CLIENT_CREATE_FAILED');
      }

      await registrarAuditoriaCliente(transaccion, {
        actor,
        clientId: fila.id,
        action: 'CLIENT_CREATED',
        createdAt: entrada.createdAt,
      });

      return mapearClientePortal(fila);
    });
  }

  /** Actualiza un cliente y su evento de auditoría sin borrado físico. */
  public async actualizar(
    id: string,
    cambios: CambiosClientePersistidos,
    actor: ActorAdministracionClientes,
  ): Promise<ClientePortal | null> {
    return this.database.transaction(async (transaccion) => {
      const [fila] = await transaccion
        .update(clients)
        .set({
          ...(cambios.nombre === undefined ? {} : { displayName: cambios.nombre }),
          ...(cambios.estado === undefined ? {} : { status: cambios.estado }),
          updatedAt: cambios.updatedAt,
        })
        .where(eq(clients.id, id))
        .returning();
      if (fila === undefined) {
        return null;
      }

      await registrarAuditoriaCliente(transaccion, {
        actor,
        clientId: fila.id,
        action: cambios.estado === 'DISABLED' ? 'CLIENT_DISABLED' : 'CLIENT_UPDATED',
        createdAt: cambios.updatedAt,
      });

      return mapearClientePortal(fila);
    });
  }

  /** Lista ambientes SAP sin consultar ni inferir ambientes del cliente externo. */
  public async listarAmbientesSap(clientId: string): Promise<readonly AmbienteSapCliente[]> {
    const filas = await this.database
      .select()
      .from(clientSapEnvironments)
      .where(eq(clientSapEnvironments.clientId, clientId))
      .orderBy(asc(clientSapEnvironments.code), asc(clientSapEnvironments.id));

    return filas.map(mapearAmbienteSapCliente);
  }

  /** Inserta un ambiente con conflicto de código y FK traducidos a resultados cerrados. */
  public async crearAmbienteSap(
    clientId: string,
    entrada: AltaAmbienteSapPersistida,
    actor: ActorAdministracionClientes,
  ): Promise<ResultadoAltaAmbienteSap> {
    try {
      return await this.database.transaction(async (transaccion) => {
        const [fila] = await transaccion
          .insert(clientSapEnvironments)
          .values({
            id: entrada.id,
            clientId,
            code: entrada.codigo,
            displayName: entrada.nombre,
            status: 'ACTIVE',
            createdAt: entrada.createdAt,
            updatedAt: entrada.createdAt,
          })
          .onConflictDoNothing({
            target: [clientSapEnvironments.clientId, clientSapEnvironments.code],
          })
          .returning();
        if (fila === undefined) {
          return { kind: 'DUPLICATE' };
        }

        await registrarAuditoriaCliente(transaccion, {
          actor,
          clientId,
          environmentId: fila.id,
          action: 'CLIENT_SAP_ENVIRONMENT_CREATED',
          createdAt: entrada.createdAt,
        });

        return { kind: 'CREATED', ambiente: mapearAmbienteSapCliente(fila) };
      });
    } catch (error: unknown) {
      if (obtenerCodigoPostgres(error) === '23503') {
        return { kind: 'CLIENT_NOT_FOUND' };
      }
      throw error;
    }
  }

  /** Actualiza un ambiente dentro de su cliente y conserva conflicto único bajo concurrencia. */
  public async actualizarAmbienteSap(
    clientId: string,
    ambienteId: string,
    cambios: CambiosAmbienteSapPersistidos,
    actor: ActorAdministracionClientes,
  ): Promise<ResultadoActualizacionAmbienteSap> {
    try {
      return await this.database.transaction(async (transaccion) => {
        const [fila] = await transaccion
          .update(clientSapEnvironments)
          .set({
            ...(cambios.codigo === undefined ? {} : { code: cambios.codigo }),
            ...(cambios.nombre === undefined ? {} : { displayName: cambios.nombre }),
            ...(cambios.estado === undefined ? {} : { status: cambios.estado }),
            updatedAt: cambios.updatedAt,
          })
          .where(
            sql`${clientSapEnvironments.id} = ${ambienteId} AND ${clientSapEnvironments.clientId} = ${clientId}`,
          )
          .returning();
        if (fila === undefined) {
          return { kind: 'NOT_FOUND' };
        }

        await registrarAuditoriaCliente(transaccion, {
          actor,
          clientId,
          environmentId: fila.id,
          action:
            cambios.estado === 'DISABLED'
              ? 'CLIENT_SAP_ENVIRONMENT_DISABLED'
              : 'CLIENT_SAP_ENVIRONMENT_UPDATED',
          createdAt: cambios.updatedAt,
        });

        return { kind: 'UPDATED', ambiente: mapearAmbienteSapCliente(fila) };
      });
    } catch (error: unknown) {
      if (obtenerCodigoPostgres(error) === '23505') {
        return { kind: 'DUPLICATE' };
      }
      throw error;
    }
  }
}

/** Convierte una fila persistida a DTO de cliente sin añadir columnas internas. */
function mapearClientePortal(fila: typeof clients.$inferSelect): ClientePortal {
  return {
    id: fila.id,
    nombre: fila.displayName,
    estado: fila.status,
    createdAt: fila.createdAt,
    updatedAt: fila.updatedAt,
  };
}

/** Convierte una fila persistida a DTO de ambiente SAP sin campos de conexión. */
function mapearAmbienteSapCliente(
  fila: typeof clientSapEnvironments.$inferSelect,
): AmbienteSapCliente {
  return {
    id: fila.id,
    clientId: fila.clientId,
    codigo: fila.code,
    nombre: fila.displayName,
    estado: fila.status,
    createdAt: fila.createdAt,
    updatedAt: fila.updatedAt,
  };
}

/** Registra el cambio con identificadores y estado, sin nombres ni material sensible. */
async function registrarAuditoriaCliente(
  transaccion: Parameters<Parameters<BaseDatosAuth['transaction']>[0]>[0],
  evento: {
    readonly actor: ActorAdministracionClientes;
    readonly clientId: string;
    readonly environmentId?: string;
    readonly action: string;
    readonly createdAt: Date;
  },
): Promise<void> {
  await transaccion.insert(auditEvents).values({
    id: randomUUID(),
    actorUserId: evento.actor.actorUserId,
    targetUserId: null,
    action: evento.action,
    outcome: 'SUCCESS',
    metadata: {
      clientId: evento.clientId,
      ...(evento.environmentId === undefined ? {} : { environmentId: evento.environmentId }),
      requestId: evento.actor.requestId,
    },
    createdAt: evento.createdAt,
  });
}

/** Obtiene solo el código PostgreSQL para traducir conflictos esperados. */
function obtenerCodigoPostgres(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}
