import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { RelojAuth } from '../../../packages/core/src/auth/ports.js';
import {
  cargarClaveHmacIntentos,
  cargarConfiguracionAuth,
  cargarConfiguracionSmtpAuth,
  cargarConfiguracionInsercionRf1,
} from './config.js';
import { ServicioCorreoNoConfigurado, crearAdaptadorCorreoSmtp } from './auth/mailer.js';
import { Argon2PasswordHasher } from './auth/argon2-password-hasher.js';
import { LimitadorIntentosPostgres } from './auth/attempt-limiter.js';
import { ServicioAutenticacionCore } from './auth/auth-service.js';
import { ServicioRecuperacionAuth } from './auth/recovery-service.js';
import { ServicioSesion } from './auth/session-service.js';
import { ServicioUsuariosAdmin } from './auth/admin-user-service.js';
import { ServicioPreferenciasUsuario } from '../../../packages/core/src/preferences/service.js';
import { PostgresAuthRepository } from './auth/postgres-auth-repository.js';
import { crearClienteBaseDatosAuth } from './db/client.js';
import { RepositorioPreferenciasUsuarioPostgres } from './preferences/postgres-user-preferences-repository.js';
import { crearServidorAuth } from './server.js';
import { ServicioClientesPortal } from './clients/client-management-service.js';
import { PostgresClientRepository } from './clients/postgres-client-repository.js';
import { ServicioPerfilesConexion } from './clients/connection-profile-service.js';
import { RepositorioPerfilesConexionPostgres } from './clients/postgres-connection-profile-repository.js';
import { cargarRuntimePerfilesConexion } from './clients/connection-runtime-config.js';
import { ServicioAccesoCliente } from './clients/client-access-service.js';
import { PostgresClientAccessRepository } from './clients/postgres-client-access-repository.js';
import { ServicioVistaPreviaRf1 } from './clients/rf1-preview-service.js';
import { ServicioInsercionRf1 } from './clients/rf1-insertion-service.js';

/** Runtime compuesto que expone HTTP privado y un cierre coordinado de recursos. */
export interface RuntimeAuth {
  /** Fastify listo, con rutas, guards y servicios PostgreSQL registrados. */
  readonly servidor: FastifyInstance;
  /** Detiene Fastify y libera el pool PostgreSQL de forma idempotente. */
  cerrar(): Promise<void>;
}

/** Fuente de tiempo UTC del proceso, sustituible por reloj falso en las pruebas. */
class RelojSistemaAuth implements RelojAuth {
  /** Devuelve la hora actual sin depender de valores enviados por el cliente. */
  public ahora(): Date {
    return new Date();
  }
}

/**
 * Compone Fastify con autenticación, sesiones, administración y recuperación.
 *
 * @param variables - Configuración explícita de proceso sin copiar secretos a logs.
 * @returns Runtime conectado a la base del portal y preparado para escuchar internamente.
 * @throws Error si falta configuración segura o no se puede preparar Fastify/Argon2id.
 */
export async function crearRuntimeAuth(
  variables: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeAuth> {
  const configuracion = cargarConfiguracionAuth(variables);
  const insercionRf1Habilitada = cargarConfiguracionInsercionRf1(variables);
  const runtimePerfiles = cargarRuntimePerfilesConexion(variables);
  const database = crearClienteBaseDatosAuth(variables);

  try {
    const repositorio = new PostgresAuthRepository(database);
    const reloj = new RelojSistemaAuth();
    const hasheador = new Argon2PasswordHasher();
    const sesiones = new ServicioSesion(repositorio, reloj);
    const limitador = new LimitadorIntentosPostgres(database, cargarClaveHmacIntentos(variables));
    const smtp = cargarConfiguracionSmtpAuth(variables);
    const correo =
      smtp === null ? new ServicioCorreoNoConfigurado() : crearAdaptadorCorreoSmtp(smtp);
    const autenticacion = new ServicioAutenticacionCore(
      repositorio,
      hasheador,
      sesiones,
      repositorio,
      reloj,
    );
    const recuperacion = new ServicioRecuperacionAuth({
      repositorio,
      hasheador,
      correo,
      correoHabilitado: smtp !== null,
      limitador,
      auditoria: repositorio,
      sesiones,
      reloj,
      publicAppOrigin: configuracion.publicAppOrigin,
    });
    const usuariosAdmin = new ServicioUsuariosAdmin(repositorio, reloj, hasheador);
    const clientes = new ServicioClientesPortal(new PostgresClientRepository(database), reloj);
    const accesoClientes = new ServicioAccesoCliente(new PostgresClientAccessRepository(database));
    const perfilesConexion = new ServicioPerfilesConexion(
      new RepositorioPerfilesConexionPostgres(database),
      runtimePerfiles.custodia,
      runtimePerfiles.broker,
      runtimePerfiles.politica,
      reloj,
    );
    const vistaPreviaRf1 = new ServicioVistaPreviaRf1(
      accesoClientes,
      perfilesConexion,
      repositorio,
      reloj,
    );
    const insercionRf1 = new ServicioInsercionRf1(
      accesoClientes,
      perfilesConexion,
      vistaPreviaRf1,
      repositorio,
      reloj,
      insercionRf1Habilitada,
    );
    const preferencias = new ServicioPreferenciasUsuario(
      new RepositorioPreferenciasUsuarioPostgres(database),
    );
    const generarIdSolicitud = crearGeneradorIdSolicitudPrueba(variables);
    const servidor = await crearServidorAuth({
      configuracion,
      autenticacion,
      sesiones,
      auditoria: repositorio,
      reloj,
      limitador,
      recuperacion,
      usuariosAdmin,
      clientes,
      perfilesConexion,
      accesoClientes,
      vistaPreviaRf1,
      insercionRf1,
      preferencias,
      ...(generarIdSolicitud === undefined ? {} : { generarIdSolicitud }),
    });

    return crearRuntime(servidor, database);
  } catch (error: unknown) {
    await database.$client.end({ timeout: 5 }).catch(() => undefined);
    throw error;
  }
}

/**
 * Crea IDs de solicitud prefijados solo para el arnés de pruebas E2E aislado.
 * @param variables Configuración del proceso que compone el runtime de autenticación.
 * @returns Generador sintético o undefined para ejecuciones distintas de E2E.
 * @throws Error cuando un prefijo no pertenece al arnés de pruebas aprobado.
 * @effects Solo produce identificadores UUID no secretos y no consulta servicios externos.
 */
function crearGeneradorIdSolicitudPrueba(variables: NodeJS.ProcessEnv): (() => string) | undefined {
  const prefijo = variables['PORTAL_TEST_REQUEST_ID_PREFIX'];
  if (prefijo === undefined) return undefined;
  if (
    variables['NODE_ENV'] !== 'test' ||
    variables['PORTAL_TEST_HARNESS_VERIFIED'] !== '1' ||
    !/^ps003-test-[0-9a-f]{32}-$/u.test(prefijo)
  ) {
    throw new Error('El prefijo de solicitud solo se admite desde el arnés aislado de pruebas.');
  }
  return () => `${prefijo}${randomUUID()}`;
}

/**
 * Mantiene el cierre compartido para llamadas simultáneas y señales repetidas.
 *
 * @param servidor - Instancia Fastify cerrada antes del pool.
 * @param database - Cliente PostgreSQL del runtime autenticado.
 * @returns Runtime con cierre idempotente y ordenado.
 */
function crearRuntime(
  servidor: FastifyInstance,
  database: ReturnType<typeof crearClienteBaseDatosAuth>,
): RuntimeAuth {
  let cierreEnCurso: Promise<void> | null = null;

  /** Cierra el servidor antes de liberar PostgreSQL incluso si el cierre HTTP falla. */
  async function cerrar(): Promise<void> {
    cierreEnCurso ??= (async (): Promise<void> => {
      try {
        await servidor.close();
      } finally {
        await database.$client.end({ timeout: 5 });
      }
    })();

    return cierreEnCurso;
  }

  return { servidor, cerrar };
}
