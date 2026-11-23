import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type {
  AltaPerfilConexionPersistido,
  CambiosPerfilConexionPersistidos,
  EndpointConexionPersistido,
  GatewaySshPersistido,
  PerfilConexionCliente,
  PerfilConexionPersistido,
  RepositorioPerfilesConexion,
  ResultadoAltaPerfilConexion,
} from '../../../../packages/core/src/clients/connection-profile-ports.js';
import type { ActorAdministracionClientes } from '../../../../packages/core/src/clients/ports.js';
import type { ResultadoPruebaConexion } from '../../../../packages/core/src/clients/secret-custody-ports.js';
import type { BaseDatosAuth } from '../db/client.js';
import { auditEvents, clientConnectionProfiles } from '../db/schema.js';

/** Columnas de perfil que se pueden mapear sin cargar la credencial cifrada. */
type FilaPerfilConexionMapeable = Pick<
  typeof clientConnectionProfiles.$inferSelect,
  | 'id'
  | 'clientId'
  | 'displayName'
  | 'profileType'
  | 'environment'
  | 'destinationId'
  | 'destinationHostname'
  | 'destinationPort'
  | 'gatewayId'
  | 'gatewayHostname'
  | 'gatewayPort'
  | 'gatewayFingerprint'
  | 'databaseName'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
>;

/** Persiste perfiles MySQL, sobres cifrados y auditoría transaccional del Portal. */
export class RepositorioPerfilesConexionPostgres implements RepositorioPerfilesConexion {
  /** Recibe el cliente PostgreSQL limitado al esquema `portal`. */
  public constructor(private readonly database: BaseDatosAuth) {}

  /** Lista metadatos redactados por cliente, sin seleccionar sobres cifrados. */
  public async listar(clientId: string): Promise<readonly PerfilConexionCliente[]> {
    const filas = await this.database
      .select({
        id: clientConnectionProfiles.id,
        clientId: clientConnectionProfiles.clientId,
        displayName: clientConnectionProfiles.displayName,
        profileType: clientConnectionProfiles.profileType,
        environment: clientConnectionProfiles.environment,
        destinationId: clientConnectionProfiles.destinationId,
        destinationHostname: clientConnectionProfiles.destinationHostname,
        destinationPort: clientConnectionProfiles.destinationPort,
        gatewayId: clientConnectionProfiles.gatewayId,
        gatewayHostname: clientConnectionProfiles.gatewayHostname,
        gatewayPort: clientConnectionProfiles.gatewayPort,
        gatewayFingerprint: clientConnectionProfiles.gatewayFingerprint,
        databaseName: clientConnectionProfiles.databaseName,
        status: clientConnectionProfiles.status,
        createdAt: clientConnectionProfiles.createdAt,
        updatedAt: clientConnectionProfiles.updatedAt,
      })
      .from(clientConnectionProfiles)
      .where(eq(clientConnectionProfiles.clientId, clientId))
      .orderBy(
        asc(sql`lower(${clientConnectionProfiles.displayName})`),
        asc(clientConnectionProfiles.id),
      );

    return filas.map(mapearPerfilConexion);
  }

  /** Inserta el perfil y registra el alta sin material secreto en la misma transacción. */
  public async crear(
    entrada: AltaPerfilConexionPersistido,
    actor: ActorAdministracionClientes,
  ): Promise<ResultadoAltaPerfilConexion> {
    try {
      return await this.database.transaction(async (transaccion) => {
        const [fila] = await transaccion
          .insert(clientConnectionProfiles)
          .values({
            id: entrada.id,
            clientId: entrada.clientId,
            displayName: entrada.nombre,
            profileType: entrada.tipo,
            environment: entrada.entorno,
            destinationId: entrada.destinoMySqlId,
            destinationHostname: entrada.destinoMySql?.hostname ?? null,
            destinationPort: entrada.destinoMySql?.port ?? null,
            gatewayId: entrada.gatewaySshId,
            gatewayHostname: entrada.gatewaySsh?.hostname ?? null,
            gatewayPort: entrada.gatewaySsh?.port ?? null,
            gatewayFingerprint: entrada.gatewaySsh?.fingerprint ?? null,
            databaseName: entrada.baseDatos,
            secretEnvelope: entrada.sobre,
            status: 'ACTIVE',
            createdByUserId: actor.actorUserId,
            createdAt: entrada.createdAt,
            updatedAt: entrada.createdAt,
          })
          .returning();
        if (fila === undefined) {
          throw new Error('CLIENT_CONNECTION_PROFILE_CREATE_FAILED');
        }

        await registrarAuditoriaPerfil(transaccion, {
          actor,
          clientId: entrada.clientId,
          profileId: entrada.id,
          action: 'CLIENT_CONNECTION_PROFILE_CREATED',
          createdAt: entrada.createdAt,
        });
        return { kind: 'CREATED', perfil: mapearPerfilConexion(fila) };
      });
    } catch (error: unknown) {
      const codigo = obtenerCodigoPostgres(error);
      if (codigo === '23505') {
        return { kind: 'PROFILE_DUPLICATE' };
      }
      if (codigo === '23503') {
        return { kind: 'CLIENT_NOT_FOUND' };
      }
      throw error;
    }
  }

  /** Actualiza metadatos y audita sin consultar ni reemplazar el sobre de secretos. */
  public async actualizar(
    clientId: string,
    profileId: string,
    cambios: CambiosPerfilConexionPersistidos,
    actor: ActorAdministracionClientes,
  ): Promise<PerfilConexionCliente | null> {
    return this.database.transaction(async (transaccion) => {
      const [fila] = await transaccion
        .update(clientConnectionProfiles)
        .set({
          ...(cambios.nombre === undefined ? {} : { displayName: cambios.nombre }),
          ...(cambios.entorno === undefined ? {} : { environment: cambios.entorno }),
          ...(cambios.destinoMySqlId === undefined
            ? {}
            : { destinationId: cambios.destinoMySqlId }),
          ...(cambios.destinoMySql === undefined
            ? {}
            : {
                destinationHostname: cambios.destinoMySql?.hostname ?? null,
                destinationPort: cambios.destinoMySql?.port ?? null,
              }),
          ...(cambios.gatewaySshId === undefined ? {} : { gatewayId: cambios.gatewaySshId }),
          ...(cambios.gatewaySsh === undefined
            ? {}
            : {
                gatewayHostname: cambios.gatewaySsh?.hostname ?? null,
                gatewayPort: cambios.gatewaySsh?.port ?? null,
                gatewayFingerprint: cambios.gatewaySsh?.fingerprint ?? null,
              }),
          ...(cambios.baseDatos === undefined ? {} : { databaseName: cambios.baseDatos }),
          ...(cambios.estado === undefined ? {} : { status: cambios.estado }),
          updatedAt: cambios.updatedAt,
        })
        .where(
          and(
            eq(clientConnectionProfiles.clientId, clientId),
            eq(clientConnectionProfiles.id, profileId),
          ),
        )
        .returning();
      if (fila === undefined) {
        return null;
      }

      await registrarAuditoriaPerfil(transaccion, {
        actor,
        clientId,
        profileId,
        action:
          cambios.estado === 'DISABLED'
            ? 'CLIENT_CONNECTION_PROFILE_DISABLED'
            : 'CLIENT_CONNECTION_PROFILE_UPDATED',
        createdAt: cambios.updatedAt,
      });
      return mapearPerfilConexion(fila);
    });
  }

  /** Sustituye el sobre de secretos y audita solo el identificador del perfil. */
  public async reemplazarSobre(
    clientId: string,
    profileId: string,
    sobre: PerfilConexionPersistido['sobre'],
    updatedAt: Date,
    actor: ActorAdministracionClientes,
  ): Promise<PerfilConexionCliente | null> {
    return this.database.transaction(async (transaccion) => {
      const [fila] = await transaccion
        .update(clientConnectionProfiles)
        .set({ secretEnvelope: sobre, updatedAt })
        .where(
          and(
            eq(clientConnectionProfiles.clientId, clientId),
            eq(clientConnectionProfiles.id, profileId),
          ),
        )
        .returning({
          id: clientConnectionProfiles.id,
          clientId: clientConnectionProfiles.clientId,
          displayName: clientConnectionProfiles.displayName,
          profileType: clientConnectionProfiles.profileType,
          environment: clientConnectionProfiles.environment,
          destinationId: clientConnectionProfiles.destinationId,
          destinationHostname: clientConnectionProfiles.destinationHostname,
          destinationPort: clientConnectionProfiles.destinationPort,
          gatewayId: clientConnectionProfiles.gatewayId,
          gatewayHostname: clientConnectionProfiles.gatewayHostname,
          gatewayPort: clientConnectionProfiles.gatewayPort,
          gatewayFingerprint: clientConnectionProfiles.gatewayFingerprint,
          databaseName: clientConnectionProfiles.databaseName,
          status: clientConnectionProfiles.status,
          createdAt: clientConnectionProfiles.createdAt,
          updatedAt: clientConnectionProfiles.updatedAt,
        });
      if (fila === undefined) {
        return null;
      }

      await registrarAuditoriaPerfil(transaccion, {
        actor,
        clientId,
        profileId,
        action: 'CLIENT_CONNECTION_CREDENTIALS_REPLACED',
        createdAt: updatedAt,
      });
      return mapearPerfilConexion(fila);
    });
  }

  /** Recupera el sobre en memoria solo de un perfil activo y del cliente indicado. */
  public async obtenerParaPrueba(
    clientId: string,
    profileId: string,
  ): Promise<PerfilConexionPersistido | null> {
    const [fila] = await this.database
      .select()
      .from(clientConnectionProfiles)
      .where(
        and(
          eq(clientConnectionProfiles.clientId, clientId),
          eq(clientConnectionProfiles.id, profileId),
          eq(clientConnectionProfiles.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return fila === undefined ? null : mapearPerfilPersistido(fila);
  }

  /** Registra un resultado sanitizado aun si el conector rechazó o agotó su tiempo. */
  public async registrarPrueba(
    clientId: string,
    profileId: string,
    resultado: ResultadoPruebaConexion,
    actor: ActorAdministracionClientes,
  ): Promise<void> {
    await this.database.transaction(async (transaccion) => {
      await registrarAuditoriaPerfil(transaccion, {
        actor,
        clientId,
        profileId,
        action: 'CLIENT_CONNECTION_TESTED',
        outcome: resultado.code === 'CONNECTED' ? 'SUCCESS' : 'FAILURE',
        createdAt: resultado.completedAt,
        codigoResultado: resultado.code,
      });
    });
  }
}

/** Convierte una fila seleccionada sin secretos a un DTO serializable para ADMIN. */
function mapearPerfilConexion(fila: FilaPerfilConexionMapeable): PerfilConexionCliente {
  return {
    id: fila.id,
    clientId: fila.clientId,
    nombre: fila.displayName,
    tipo: fila.profileType,
    entorno: fila.environment,
    destinoMySqlId: fila.destinationId,
    gatewaySshId: fila.gatewayId,
    destinoMySql: mapearEndpointPersistido(fila.destinationHostname, fila.destinationPort),
    gatewaySsh: mapearGatewayPersistido(
      fila.gatewayHostname,
      fila.gatewayPort,
      fila.gatewayFingerprint,
    ),
    baseDatos: fila.databaseName,
    estado: fila.status,
    createdAt: fila.createdAt,
    updatedAt: fila.updatedAt,
  };
}

/** Convierte la fila con sobre para uso interno exclusivo del servicio de conexiones. */
function mapearPerfilPersistido(
  fila: typeof clientConnectionProfiles.$inferSelect,
): PerfilConexionPersistido {
  return {
    ...mapearPerfilConexion(fila),
    sobre: fila.secretEnvelope,
    destinoMySql: mapearEndpointPersistido(fila.destinationHostname, fila.destinationPort),
    gatewaySsh: mapearGatewayPersistido(
      fila.gatewayHostname,
      fila.gatewayPort,
      fila.gatewayFingerprint,
    ),
  };
}

/** Convierte hostname y puerto nullable en un endpoint interno o falla ante una fila parcial. */
function mapearEndpointPersistido(
  hostname: string | null,
  puerto: number | null,
): EndpointConexionPersistido | null {
  if (hostname === null && puerto === null) {
    return null;
  }
  if (hostname === null || puerto === null || !Number.isInteger(puerto)) {
    throw new Error('CONNECTION_PROFILE_DESTINATION_INCOMPLETE');
  }
  return { hostname, port: puerto };
}

/** Convierte el gateway nullable en un endpoint SSH completo y verifica su fingerprint presente. */
function mapearGatewayPersistido(
  hostname: string | null,
  puerto: number | null,
  fingerprint: string | null,
): GatewaySshPersistido | null {
  if (hostname === null && puerto === null && fingerprint === null) {
    return null;
  }
  if (hostname === null || puerto === null || fingerprint === null || !Number.isInteger(puerto)) {
    throw new Error('CONNECTION_PROFILE_GATEWAY_INCOMPLETE');
  }
  return { hostname, port: puerto, fingerprint };
}

/** Registra metadatos auditables sin nombres, usuarios, hosts ni valores secretos. */
async function registrarAuditoriaPerfil(
  transaccion: Parameters<Parameters<BaseDatosAuth['transaction']>[0]>[0],
  evento: {
    readonly actor: ActorAdministracionClientes;
    readonly clientId: string;
    readonly profileId: string;
    readonly action: string;
    readonly outcome?: 'SUCCESS' | 'FAILURE';
    readonly createdAt: Date;
    readonly codigoResultado?: string;
  },
): Promise<void> {
  await transaccion.insert(auditEvents).values({
    id: randomUUID(),
    actorUserId: evento.actor.actorUserId,
    targetUserId: null,
    action: evento.action,
    outcome: evento.outcome ?? 'SUCCESS',
    metadata: {
      clientId: evento.clientId,
      profileId: evento.profileId,
      requestId: evento.actor.requestId,
      ...(evento.codigoResultado === undefined ? {} : { resultCode: evento.codigoResultado }),
    },
    createdAt: evento.createdAt,
  });
}

/** Obtiene solo el código SQLSTATE para convertir conflictos sin filtrar SQL o valores. */
function obtenerCodigoPostgres(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}
