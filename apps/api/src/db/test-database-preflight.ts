import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { cargarConfiguracionBasePrueba } from '../runtime-config.js';

/** Roles permitidos en la base persistente y aislada de pruebas del Portal. */
export type RolBasePrueba = 'portal_test_app' | 'portal_test_migrator';

/** Metadatos no sensibles usados para comprobar la identidad y privilegios de PostgreSQL. */
export interface IdentidadPostgresPrueba {
  /** Nombre de la base a la que respondió la conexión. */
  readonly nombreBase: string;
  /** Rol autenticado en PostgreSQL. */
  readonly rol: string;
  /** Dirección local de la instancia PostgreSQL detrás del túnel. */
  readonly direccionServidor: string | null;
  /** Puerto de escucha de PostgreSQL, no el puerto local del túnel. */
  readonly puertoServidor: number;
  /** Versión numérica del servidor PostgreSQL. */
  readonly versionServidor: number;
  /** Inicio del proceso PostgreSQL para comparar ambas credenciales. */
  readonly inicioServidor: string;
  /** Indica privilegio SUPERUSER. */
  readonly esSuperusuario: boolean;
  /** Indica privilegio global CREATEDB. */
  readonly puedeCrearBases: boolean;
  /** Indica privilegio global CREATEROLE. */
  readonly puedeCrearRoles: boolean;
  /** Indica privilegio REPLICATION. */
  readonly puedeReplicar: boolean;
  /** Indica privilegio BYPASSRLS. */
  readonly puedeOmitirRls: boolean;
  /** Indica permiso CREATE concedido en esta base específica. */
  readonly puedeCrearEsquemas: boolean;
  /** Indica permiso CONNECT en esta base específica. */
  readonly puedeConectar: boolean;
  /** Indica permiso TEMP/TEMPORARY para crear tablas temporales en esta base. */
  readonly puedeCrearTemporales: boolean;
  /** Indica que el rol no participa como miembro ni como rol concedido. */
  readonly sinMembresias: boolean;
  /** Indica si el rol hereda privilegios de membresías. */
  readonly heredaRoles: boolean;
  /** Indica si la cuenta está habilitada para autenticarse. */
  readonly puedeIniciarSesion: boolean;
  /** Límite efectivo de conexiones simultáneas del rol. */
  readonly limiteConexiones: number;
  /** Indica permiso USAGE sobre el esquema compartido public. */
  readonly puedeUsarEsquemaPublico: boolean;
  /** Indica permiso CREATE sobre el esquema compartido public. */
  readonly puedeCrearEnEsquemaPublico: boolean;
  /** Indica permiso USAGE sobre el esquema aislado portal. */
  readonly puedeUsarEsquemaPortal: boolean;
  /** Indica permiso CREATE sobre el esquema aislado portal. */
  readonly puedeCrearEnEsquemaPortal: boolean;
  /** Indica que PUBLIC conserva solo CONNECT/TEMPORARY y USAGE en public. */
  readonly aclPublicoLimpio: boolean;
  /** Indica que el rol de ejecución tiene exactamente el DML previsto. */
  readonly permisosDmlExactos: boolean;
  /** Indica que no hay privilegios efectivos sobre objetos fuera de portal. */
  readonly sinAccesoObjetosFueraPortal: boolean;
  /** Indica que el esquema y todos sus objetos pertenecen al rol migrador. */
  readonly objetosPropiedadMigrador: boolean;
}

/** Estado mínimo que permite migrar o repetir pruebas sin tocar datos previos. */
export interface EstadoEsquemaBasePrueba {
  /** Esquemas de usuario presentes en la base, sin esquemas internos de PostgreSQL. */
  readonly esquemas: readonly string[];
  /** Tablas o vistas reportadas dentro de `public` y `portal`. */
  readonly tablas: readonly {
    readonly esquema: string;
    readonly nombre: string;
    readonly tipo: string;
  }[];
  /** Secuencias reportadas dentro de `public` y `portal`. */
  readonly secuencias: readonly {
    readonly esquema: string;
    readonly nombre: string;
  }[];
  /** Relaciones e índices admitidos en el estado vacío o migrado. */
  readonly relaciones: readonly {
    readonly esquema: string;
    readonly nombre: string;
    readonly tipo: string;
  }[];
  /** Restricciones CHECK, FK, PK, UNIQUE y EXCLUDE esperadas dentro de portal. */
  readonly restricciones: readonly {
    readonly esquema: string;
    readonly tabla: string;
    readonly nombre: string;
    readonly tipo: string;
  }[];
  /** Hashes ordenados que aparecen en el ledger Drizzle del esquema Portal. */
  readonly hashesMigraciones: readonly string[];
  /** Objetos que deben permanecer ausentes del espacio de nombres del Portal. */
  readonly objetosAdicionales: {
    readonly rutinas: number;
    readonly disparadores: number;
    readonly politicas: number;
    readonly tiposPersonalizados: number;
    readonly reglas: number;
    readonly objetosGrandes: number;
    readonly extensiones: readonly { readonly nombre: string; readonly esquema: string }[];
  };
  /** Conteos sintéticos del estado persistente de autenticación. */
  readonly filas: {
    readonly usuarios: number;
    readonly sesiones: number;
    readonly tokens: number;
    readonly limitadores: number;
    readonly auditoria: number;
    readonly invariantes: number;
    /** Filas sintéticas de clientes creadas exclusivamente por las pruebas. */
    readonly clientes: number;
    /** Filas sintéticas de ambientes SAP creadas exclusivamente por las pruebas. */
    readonly ambientesSap: number;
    /** Filas sintéticas de perfiles cifrados creadas exclusivamente por las pruebas. */
    readonly perfilesConexion: number;
    /** Filas de asignaciones de clientes creadas exclusivamente por las pruebas. */
    readonly asignacionesCliente: number;
    /** Filas de capacidades de clientes creadas exclusivamente por las pruebas. */
    readonly capacidadesCliente: number;
  };
}

const nombresTablasAplicacion = [
  'audit_events',
  'auth_invariants',
  'auth_throttle_windows',
  'client_capabilities',
  'client_sap_environments',
  'client_connection_profiles',
  'client_user_assignments',
  'clients',
  'recovery_tokens',
  'sessions',
  'users',
] as const;

const relacionesMigradasEsperadas = [
  ['__drizzle_migrations', 'r'],
  ['__drizzle_migrations_id_seq', 'S'],
  ['__drizzle_migrations_pkey', 'i'],
  ['audit_events', 'r'],
  ['audit_events_actor_created_idx', 'i'],
  ['audit_events_created_at_idx', 'i'],
  ['audit_events_pkey', 'i'],
  ['audit_events_target_created_idx', 'i'],
  ['auth_invariants', 'r'],
  ['auth_invariants_pkey', 'i'],
  ['auth_throttle_expires_at_idx', 'i'],
  ['auth_throttle_windows', 'r'],
  ['auth_throttle_windows_pkey', 'i'],
  ['client_capabilities', 'r'],
  ['client_capabilities_pkey', 'i'],
  ['client_sap_environments', 'r'],
  ['client_sap_environments_client_code_unique', 'i'],
  ['client_sap_environments_client_id_idx', 'i'],
  ['client_sap_environments_pkey', 'i'],
  ['client_sap_environments_status_idx', 'i'],
  ['client_connection_profiles', 'r'],
  ['client_connection_profiles_client_name_unique', 'i'],
  ['client_connection_profiles_client_id_idx', 'i'],
  ['client_connection_profiles_pkey', 'i'],
  ['client_connection_profiles_status_idx', 'i'],
  ['client_user_assignments', 'r'],
  ['client_user_assignments_active_pair_unique', 'i'],
  ['client_user_assignments_pkey', 'i'],
  ['client_user_assignments_user_id_idx', 'i'],
  ['clients', 'r'],
  ['clients_display_name_idx', 'i'],
  ['clients_pkey', 'i'],
  ['clients_status_idx', 'i'],
  ['recovery_tokens', 'r'],
  ['recovery_tokens_expires_at_idx', 'i'],
  ['recovery_tokens_pkey', 'i'],
  ['recovery_tokens_token_hash_unique', 'i'],
  ['recovery_tokens_user_id_idx', 'i'],
  ['sessions', 'r'],
  ['sessions_absolute_expires_at_idx', 'i'],
  ['sessions_idle_expires_at_idx', 'i'],
  ['sessions_pkey', 'i'],
  ['sessions_token_hash_unique', 'i'],
  ['sessions_user_id_idx', 'i'],
  ['users', 'r'],
  ['users_email_normalized_unique', 'i'],
  ['users_pkey', 'i'],
  ['users_username_normalized_unique', 'i'],
].map(([nombre, tipo]) => ({ esquema: 'portal', nombre: nombre!, tipo: tipo! }));

const restriccionesMigradasEsperadas = [
  ['__drizzle_migrations', '__drizzle_migrations_pkey', 'p'],
  ['audit_events', 'audit_events_actor_user_id_users_id_fk', 'f'],
  ['audit_events', 'audit_events_outcome_check', 'c'],
  ['audit_events', 'audit_events_pkey', 'p'],
  ['audit_events', 'audit_events_target_user_id_users_id_fk', 'f'],
  ['auth_invariants', 'auth_invariants_pkey', 'p'],
  ['auth_invariants', 'auth_invariants_singleton_check', 'c'],
  ['auth_throttle_windows', 'auth_throttle_attempt_count_check', 'c'],
  ['auth_throttle_windows', 'auth_throttle_expiration_check', 'c'],
  ['auth_throttle_windows', 'auth_throttle_scope_check', 'c'],
  ['auth_throttle_windows', 'auth_throttle_windows_pkey', 'p'],
  ['client_capabilities', 'client_capabilities_changed_by_user_id_users_id_fk', 'f'],
  ['client_capabilities', 'client_capabilities_client_id_clients_id_fk', 'f'],
  ['client_capabilities', 'client_capabilities_id_check', 'c'],
  ['client_capabilities', 'client_capabilities_pkey', 'p'],
  ['client_sap_environments', 'client_sap_environments_client_id_clients_id_fk', 'f'],
  ['client_sap_environments', 'client_sap_environments_code_check', 'c'],
  ['client_sap_environments', 'client_sap_environments_name_check', 'c'],
  ['client_sap_environments', 'client_sap_environments_pkey', 'p'],
  ['client_sap_environments', 'client_sap_environments_status_check', 'c'],
  ['client_connection_profiles', 'client_connection_profiles_client_id_clients_id_fk', 'f'],
  ['client_connection_profiles', 'client_connection_profiles_created_by_user_id_users_id_fk', 'f'],
  ['client_connection_profiles', 'client_connection_profiles_pkey', 'p'],
  ['client_connection_profiles', 'client_connection_profiles_type_check', 'c'],
  ['client_connection_profiles', 'client_connection_profiles_environment_check', 'c'],
  ['client_connection_profiles', 'client_connection_profiles_status_check', 'c'],
  ['client_connection_profiles', 'client_connection_profiles_name_check', 'c'],
  ['client_connection_profiles', 'client_connection_profiles_destination_check', 'c'],
  ['client_connection_profiles', 'client_connection_profiles_database_check', 'c'],
  ['client_connection_profiles', 'client_connection_profiles_gateway_check', 'c'],
  ['client_user_assignments', 'client_user_assignments_client_id_clients_id_fk', 'f'],
  ['client_user_assignments', 'client_user_assignments_granted_by_user_id_users_id_fk', 'f'],
  ['client_user_assignments', 'client_user_assignments_pkey', 'p'],
  ['client_user_assignments', 'client_user_assignments_revocation_metadata_check', 'c'],
  ['client_user_assignments', 'client_user_assignments_revoked_by_user_id_users_id_fk', 'f'],
  ['client_user_assignments', 'client_user_assignments_user_id_users_id_fk', 'f'],
  ['clients', 'clients_created_by_user_id_users_id_fk', 'f'],
  ['clients', 'clients_name_check', 'c'],
  ['clients', 'clients_pkey', 'p'],
  ['clients', 'clients_status_check', 'c'],
  ['recovery_tokens', 'recovery_tokens_expiration_check', 'c'],
  ['recovery_tokens', 'recovery_tokens_pkey', 'p'],
  ['recovery_tokens', 'recovery_tokens_purpose_check', 'c'],
  ['recovery_tokens', 'recovery_tokens_target_email_check', 'c'],
  ['recovery_tokens', 'recovery_tokens_token_hash_unique', 'u'],
  ['recovery_tokens', 'recovery_tokens_user_id_users_id_fk', 'f'],
  ['sessions', 'sessions_pkey', 'p'],
  ['sessions', 'sessions_token_hash_unique', 'u'],
  ['sessions', 'sessions_user_id_users_id_fk', 'f'],
  ['users', 'users_credential_state_check', 'c'],
  ['users', 'users_pkey', 'p'],
  ['users', 'users_role_check', 'c'],
  ['users', 'users_status_check', 'c'],
  ['users', 'users_theme_preference_check', 'c'],
].map(([tabla, nombre, tipo]) => ({
  esquema: 'portal',
  tabla: tabla!,
  nombre: nombre!,
  tipo: tipo!,
}));

/** Estado exacto de 0007 justo antes de retirar la restricción de execute en 0008. */
const restriccionesPreviasRf1ExecuteEsperadas = [
  ...restriccionesMigradasEsperadas,
  {
    esquema: 'portal',
    tabla: 'client_capabilities',
    nombre: 'client_capabilities_execute_disabled_check',
    tipo: 'c',
  },
].sort(compararRestricciones);

/**
 * Consulta y valida en modo read-only la identidad del rol PostgreSQL de pruebas.
 * @param url URL validada por la configuración de pruebas para el rol solicitado.
 * @param rolEsperado Rol de runner o migrador que debe autenticar la conexión.
 * @returns Metadatos sanitizados de base, servidor y privilegios efectivos.
 * @throws Error si la URL, identidad, permisos o consulta no cumplen el preflight.
 * @effects Abre una conexión con transacciones read-only y la cierra al terminar.
 */
export async function verificarIdentidadBasePrueba(
  url: string,
  rolEsperado: RolBasePrueba,
): Promise<IdentidadPostgresPrueba> {
  const configuracion = cargarConfiguracionBasePrueba(process.env);
  const destinoEsperado =
    rolEsperado === 'portal_test_app'
      ? configuracion.TEST_DATABASE_URL
      : configuracion.TEST_MIGRATOR_DATABASE_URL;
  if (configuracion.modo !== 'ssh-tunnel' || url !== destinoEsperado) {
    throw new Error('La identidad PostgreSQL no coincide con el rol y el destino de pruebas.');
  }

  const conexion = postgres(url, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
    queue_timeout: 5,
    query_timeout: 5,
    connection: {
      application_name: 'portal-ps003-test-preflight',
      default_transaction_read_only: true,
      statement_timeout: 5_000,
      lock_timeout: 2_000,
      idle_in_transaction_session_timeout: 5_000,
    },
  });

  try {
    const [fila] = await conexion<IdentidadPostgresPrueba[]>`
      SELECT
        current_database() AS "nombreBase",
        current_user AS "rol",
        host(inet_server_addr()) AS "direccionServidor",
        inet_server_port() AS "puertoServidor",
        current_setting('server_version_num')::integer AS "versionServidor",
        pg_postmaster_start_time()::text AS "inicioServidor",
        rol.rolsuper AS "esSuperusuario",
        rol.rolcreatedb AS "puedeCrearBases",
        rol.rolcreaterole AS "puedeCrearRoles",
        rol.rolreplication AS "puedeReplicar",
        rol.rolbypassrls AS "puedeOmitirRls",
        rol.rolinherit AS "heredaRoles",
        rol.rolcanlogin AS "puedeIniciarSesion",
        rol.rolconnlimit AS "limiteConexiones",
        has_database_privilege(current_user, current_database(), 'CREATE') AS "puedeCrearEsquemas",
        has_database_privilege(current_user, current_database(), 'CONNECT') AS "puedeConectar",
        has_database_privilege(current_user, current_database(), 'TEMP') AS "puedeCrearTemporales",
        NOT EXISTS (
          SELECT 1 FROM pg_auth_members AS membresia
          WHERE membresia.member = rol.oid OR membresia.roleid = rol.oid
        ) AS "sinMembresias",
        has_schema_privilege(current_user, 'public', 'USAGE') AS "puedeUsarEsquemaPublico",
        has_schema_privilege(current_user, 'public', 'CREATE') AS "puedeCrearEnEsquemaPublico",
        has_schema_privilege(current_user, 'portal', 'USAGE') AS "puedeUsarEsquemaPortal",
        has_schema_privilege(current_user, 'portal', 'CREATE') AS "puedeCrearEnEsquemaPortal",
        (
          EXISTS (
            SELECT 1 FROM pg_database AS db
            CROSS JOIN LATERAL aclexplode(COALESCE(db.datacl, acldefault('d', db.datdba))) AS acl
            WHERE db.datname = current_database() AND acl.grantee = 0 AND acl.privilege_type = 'CONNECT'
          )
          AND EXISTS (
            SELECT 1 FROM pg_database AS db
            CROSS JOIN LATERAL aclexplode(COALESCE(db.datacl, acldefault('d', db.datdba))) AS acl
            WHERE db.datname = current_database() AND acl.grantee = 0 AND acl.privilege_type = 'TEMPORARY'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_database AS db
            CROSS JOIN LATERAL aclexplode(COALESCE(db.datacl, acldefault('d', db.datdba))) AS acl
            WHERE db.datname = current_database() AND acl.grantee = 0
              AND acl.privilege_type NOT IN ('CONNECT', 'TEMPORARY')
          )
          AND EXISTS (
            SELECT 1 FROM pg_namespace AS esquema
            CROSS JOIN LATERAL aclexplode(COALESCE(esquema.nspacl, acldefault('n', esquema.nspowner))) AS acl
            WHERE esquema.nspname = 'public' AND acl.grantee = 0 AND acl.privilege_type = 'USAGE'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_namespace AS esquema
            CROSS JOIN LATERAL aclexplode(COALESCE(esquema.nspacl, acldefault('n', esquema.nspowner))) AS acl
            WHERE esquema.nspname = 'public' AND acl.grantee = 0 AND acl.privilege_type <> 'USAGE'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_namespace AS esquema
            CROSS JOIN LATERAL aclexplode(COALESCE(esquema.nspacl, acldefault('n', esquema.nspowner))) AS acl
            WHERE esquema.nspname = 'portal' AND acl.grantee = 0
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_class AS relacion
            JOIN pg_namespace AS esquema ON esquema.oid = relacion.relnamespace
            CROSS JOIN LATERAL aclexplode(COALESCE(relacion.relacl, acldefault('r', relacion.relowner))) AS acl
            WHERE esquema.nspname IN ('public', 'portal')
              AND relacion.relkind IN ('r', 'p', 'v', 'm', 'f') AND acl.grantee = 0
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_class AS secuencia
            JOIN pg_namespace AS esquema ON esquema.oid = secuencia.relnamespace
            CROSS JOIN LATERAL aclexplode(COALESCE(secuencia.relacl, acldefault('s', secuencia.relowner))) AS acl
            WHERE esquema.nspname IN ('public', 'portal')
              AND secuencia.relkind = 'S' AND acl.grantee = 0
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_proc AS rutina
            JOIN pg_namespace AS esquema ON esquema.oid = rutina.pronamespace
            CROSS JOIN LATERAL aclexplode(COALESCE(rutina.proacl, acldefault('f', rutina.proowner))) AS acl
            WHERE esquema.nspname IN ('public', 'portal') AND acl.grantee = 0
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_largeobject_metadata AS objeto
            CROSS JOIN LATERAL aclexplode(COALESCE(objeto.lomacl, acldefault('L', objeto.lomowner))) AS acl
            WHERE acl.grantee = 0
          )
        ) AS "aclPublicoLimpio",
        (
          current_user <> 'portal_test_app'
          OR (
            (
              SELECT count(*) FROM pg_class AS tabla
              JOIN pg_namespace AS esquema ON esquema.oid = tabla.relnamespace
              WHERE esquema.nspname = 'portal'
                AND tabla.relkind IN ('r', 'p', 'v', 'm', 'f')
                AND tabla.relname = ANY(ARRAY['audit_events', 'auth_invariants', 'auth_throttle_windows', 'client_capabilities', 'client_connection_profiles', 'client_sap_environments', 'client_user_assignments', 'clients', 'recovery_tokens', 'sessions', 'users'])
            ) IN (0, 6, 8, 9, 11)
            AND NOT EXISTS (
              SELECT 1
              FROM (VALUES
                ('audit_events', false, true, false, false),
                ('auth_invariants', true, false, true, false),
                ('auth_throttle_windows', true, true, true, true),
                ('client_capabilities', true, true, true, false),
                ('client_connection_profiles', true, true, true, false),
                ('client_sap_environments', true, true, true, false),
                ('client_user_assignments', true, true, true, false),
                ('clients', true, true, true, false),
                ('recovery_tokens', true, true, true, false),
                ('sessions', true, true, true, false),
                ('users', true, true, true, false)
              ) AS esperado(nombre, permite_select, permite_insert, permite_update, permite_delete)
              JOIN pg_class AS tabla ON tabla.relname = esperado.nombre
              JOIN pg_namespace AS esquema ON esquema.oid = tabla.relnamespace
              WHERE esquema.nspname = 'portal'
                AND tabla.relkind IN ('r', 'p', 'v', 'm', 'f')
                AND (
                  has_table_privilege(current_user, tabla.oid, 'SELECT') IS DISTINCT FROM esperado.permite_select
                  OR has_table_privilege(current_user, tabla.oid, 'INSERT') IS DISTINCT FROM esperado.permite_insert
                  OR has_table_privilege(current_user, tabla.oid, 'UPDATE') IS DISTINCT FROM esperado.permite_update
                  OR has_table_privilege(current_user, tabla.oid, 'DELETE') IS DISTINCT FROM esperado.permite_delete
                  OR has_table_privilege(current_user, tabla.oid, 'TRUNCATE')
                  OR has_table_privilege(current_user, tabla.oid, 'REFERENCES')
                  OR has_table_privilege(current_user, tabla.oid, 'TRIGGER')
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM pg_class AS tabla
              JOIN pg_namespace AS esquema ON esquema.oid = tabla.relnamespace
              WHERE esquema.nspname IN ('public', 'portal')
                AND tabla.relkind IN ('r', 'p', 'v', 'm', 'f')
                AND NOT (esquema.nspname = 'portal' AND tabla.relname = ANY(ARRAY['audit_events', 'auth_invariants', 'auth_throttle_windows', 'client_capabilities', 'client_connection_profiles', 'client_sap_environments', 'client_user_assignments', 'clients', 'recovery_tokens', 'sessions', 'users']))
                AND (
                  has_table_privilege(current_user, tabla.oid, 'SELECT')
                  OR has_table_privilege(current_user, tabla.oid, 'INSERT')
                  OR has_table_privilege(current_user, tabla.oid, 'UPDATE')
                  OR has_table_privilege(current_user, tabla.oid, 'DELETE')
                  OR has_table_privilege(current_user, tabla.oid, 'TRUNCATE')
                  OR has_table_privilege(current_user, tabla.oid, 'REFERENCES')
                  OR has_table_privilege(current_user, tabla.oid, 'TRIGGER')
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM pg_class AS secuencia
              WHERE secuencia.relkind = 'S'
                AND (
                  has_sequence_privilege(current_user, secuencia.oid, 'USAGE')
                  OR has_sequence_privilege(current_user, secuencia.oid, 'SELECT')
                  OR has_sequence_privilege(current_user, secuencia.oid, 'UPDATE')
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM pg_class AS tabla
              JOIN pg_namespace AS esquema ON esquema.oid = tabla.relnamespace
              CROSS JOIN LATERAL aclexplode(COALESCE(tabla.relacl, acldefault('r', tabla.relowner))) AS acl
              WHERE esquema.nspname = 'portal'
                AND tabla.relname = ANY(ARRAY['audit_events', 'auth_invariants', 'auth_throttle_windows', 'client_capabilities', 'client_connection_profiles', 'client_sap_environments', 'client_user_assignments', 'clients', 'recovery_tokens', 'sessions', 'users'])
                AND acl.grantee = rol.oid
                AND acl.is_grantable
            )
          )
        ) AS "permisosDmlExactos",
        NOT EXISTS (
          SELECT 1
          FROM pg_class AS relacion
          JOIN pg_namespace AS esquema ON esquema.oid = relacion.relnamespace
          WHERE esquema.nspname !~ '^pg_'
            AND esquema.nspname <> 'information_schema'
            AND esquema.nspname <> 'portal'
            AND relacion.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND (
              has_table_privilege(current_user, relacion.oid, 'SELECT')
              OR has_table_privilege(current_user, relacion.oid, 'INSERT')
              OR has_table_privilege(current_user, relacion.oid, 'UPDATE')
              OR has_table_privilege(current_user, relacion.oid, 'DELETE')
              OR has_table_privilege(current_user, relacion.oid, 'TRUNCATE')
              OR has_table_privilege(current_user, relacion.oid, 'REFERENCES')
              OR has_table_privilege(current_user, relacion.oid, 'TRIGGER')
            )
        ) AS "sinAccesoObjetosFueraPortal",
        (
          EXISTS (
            SELECT 1 FROM pg_namespace AS esquema
            WHERE esquema.nspname = 'portal'
              AND esquema.nspowner = (SELECT oid FROM pg_roles WHERE rolname = 'portal_test_migrator')
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_class AS relacion
            JOIN pg_namespace AS esquema ON esquema.oid = relacion.relnamespace
            WHERE esquema.nspname = 'portal'
              AND relacion.relowner <> (SELECT oid FROM pg_roles WHERE rolname = 'portal_test_migrator')
          )
        ) AS "objetosPropiedadMigrador"
      FROM pg_roles AS rol
      WHERE rol.rolname = current_user
    `;
    if (fila === undefined) {
      throw new Error('La identidad PostgreSQL no coincide con el rol y el destino de pruebas.');
    }

    return validarIdentidadBasePrueba(fila, rolEsperado);
  } catch {
    throw new Error('No fue posible verificar la identidad PostgreSQL de pruebas.');
  } finally {
    try {
      await conexion.end({ timeout: 5 });
    } catch {
      // El fallo de cierre no debe divulgar la URL ni reemplazar el resultado de seguridad.
    }
  }
}

/**
 * Comprueba que la identidad PostgreSQL cumpla el perfil mínimo de cada rol de pruebas.
 * @param identidad Metadatos de la conexión que se van a validar.
 * @param rolEsperado Rol del Portal de Soporte esperado en la base aislada.
 * @returns La misma identidad cuando pasa todas las verificaciones.
 * @throws Error si base, endpoint, privilegios, esquema o ACL difieren del contrato.
 */
export function validarIdentidadBasePrueba(
  identidad: IdentidadPostgresPrueba,
  rolEsperado: RolBasePrueba,
): IdentidadPostgresPrueba {
  const rolDeAplicacion = rolEsperado === 'portal_test_app';
  const limiteEsperado = rolDeAplicacion ? 8 : 2;
  const identidadValida =
    identidad.nombreBase === 'portal_soporte_test' &&
    identidad.rol === rolEsperado &&
    identidad.direccionServidor === '127.0.0.1' &&
    identidad.puertoServidor === 5432 &&
    Number.isInteger(identidad.versionServidor) &&
    identidad.versionServidor >= 100_000 &&
    identidad.inicioServidor.length > 0 &&
    !identidad.esSuperusuario &&
    !identidad.puedeCrearBases &&
    !identidad.puedeCrearRoles &&
    !identidad.puedeReplicar &&
    !identidad.puedeOmitirRls &&
    identidad.sinMembresias &&
    !identidad.heredaRoles &&
    identidad.puedeIniciarSesion &&
    identidad.limiteConexiones === limiteEsperado &&
    identidad.puedeCrearEsquemas === !rolDeAplicacion &&
    identidad.puedeConectar &&
    identidad.puedeCrearTemporales;
  const privilegiosDeEsquemaValidos =
    identidad.puedeUsarEsquemaPublico &&
    !identidad.puedeCrearEnEsquemaPublico &&
    identidad.puedeUsarEsquemaPortal &&
    identidad.puedeCrearEnEsquemaPortal === !rolDeAplicacion;
  const aislamientoDeObjetosValido =
    identidad.aclPublicoLimpio &&
    identidad.permisosDmlExactos &&
    identidad.sinAccesoObjetosFueraPortal &&
    identidad.objetosPropiedadMigrador;

  if (!identidadValida || !privilegiosDeEsquemaValidos || !aislamientoDeObjetosValido) {
    throw new Error('La identidad PostgreSQL no coincide con el rol y el destino de pruebas.');
  }

  return identidad;
}

/**
 * Confirma que las credenciales de runner y migración llegan al mismo servidor PostgreSQL.
 * @param identidadAplicacion Metadatos de la conexión del runner.
 * @param identidadMigrador Metadatos de la conexión de migración.
 * @returns No devuelve valor si ambas credenciales identifican el mismo proceso servidor.
 * @throws Error si difieren base, dirección, puerto, versión o hora de inicio.
 */
export function validarMismaInstanciaBasePrueba(
  identidadAplicacion: IdentidadPostgresPrueba,
  identidadMigrador: IdentidadPostgresPrueba,
): void {
  const mismaInstancia =
    identidadAplicacion.nombreBase === identidadMigrador.nombreBase &&
    identidadAplicacion.direccionServidor === identidadMigrador.direccionServidor &&
    identidadAplicacion.puertoServidor === identidadMigrador.puertoServidor &&
    identidadAplicacion.versionServidor === identidadMigrador.versionServidor &&
    identidadAplicacion.inicioServidor === identidadMigrador.inicioServidor;

  if (!mismaInstancia) {
    throw new Error('Las credenciales de prueba no alcanzan la misma instancia PostgreSQL.');
  }
}

/**
 * Acepta una base nueva, el estado exacto anterior a 0008 o el esquema actual vacío.
 * @param estado Inventario de catálogos y conteos obtenidos en modo read-only.
 * @param hashesEsperados Hashes de migración calculados desde los archivos versionados.
 * @returns Estado vacío, inmediatamente anterior a una migración o ya migrado.
 * @throws Error si existe un objeto, restricción, hash o dato no autorizado.
 */
export function validarEstadoEsquemaBasePrueba(
  estado: EstadoEsquemaBasePrueba,
  hashesEsperados: readonly (readonly string[])[],
): 'vacio' | 'migracion-pendiente' | 'migrado' {
  const esquemas = [...estado.esquemas].sort();
  const tablas = [...estado.tablas].sort(compararObjetosEsquema);
  const secuencias = [...estado.secuencias].sort(compararObjetosEsquema);
  const hashes = [...estado.hashesMigraciones];
  const relaciones = [...estado.relaciones].sort(compararObjetosEsquema);
  const restricciones = [...estado.restricciones].sort(compararRestricciones);
  const restriccionesEsperadas = [...restriccionesMigradasEsperadas].sort(compararRestricciones);
  const filasSinDatos =
    estado.filas.usuarios === 0 &&
    estado.filas.sesiones === 0 &&
    estado.filas.tokens === 0 &&
    estado.filas.limitadores === 0 &&
    estado.filas.auditoria === 0 &&
    estado.filas.clientes === 0 &&
    estado.filas.ambientesSap === 0 &&
    estado.filas.perfilesConexion === 0 &&
    estado.filas.asignacionesCliente === 0 &&
    estado.filas.capacidadesCliente === 0;

  const esquemasBaseVacia =
    (esquemas.length === 1 && esquemas[0] === 'public') ||
    (esquemas.length === 2 && esquemas[0] === 'portal' && esquemas[1] === 'public');
  const objetosAdicionalesLimpios =
    estado.objetosAdicionales.rutinas === 0 &&
    estado.objetosAdicionales.disparadores === 0 &&
    estado.objetosAdicionales.politicas === 0 &&
    estado.objetosAdicionales.tiposPersonalizados === 0 &&
    estado.objetosAdicionales.reglas === 0 &&
    estado.objetosAdicionales.objetosGrandes === 0 &&
    (estado.objetosAdicionales.extensiones.length === 0 ||
      (estado.objetosAdicionales.extensiones.length === 1 &&
        estado.objetosAdicionales.extensiones[0]?.nombre === 'plpgsql' &&
        estado.objetosAdicionales.extensiones[0]?.esquema === 'pg_catalog'));
  const baseNueva =
    esquemasBaseVacia &&
    tablas.length === 0 &&
    secuencias.length === 0 &&
    relaciones.length === 0 &&
    restricciones.length === 0 &&
    hashes.length === 0 &&
    objetosAdicionalesLimpios &&
    Object.values(estado.filas).every((cantidad) => cantidad === 0);
  if (baseNueva) {
    return 'vacio';
  }

  const tablasEsperadas = ['__drizzle_migrations', ...nombresTablasAplicacion].map((nombre) => ({
    esquema: 'portal',
    nombre,
    tipo: 'BASE TABLE',
  }));
  const secuenciasEsperadas = [{ esquema: 'portal', nombre: '__drizzle_migrations_id_seq' }];
  const esquemasPortalEsperados =
    esquemas.length === 2 && esquemas[0] === 'portal' && esquemas[1] === 'public';
  const tablasActualesEsperadas =
    JSON.stringify(tablas) === JSON.stringify([...tablasEsperadas].sort(compararObjetosEsquema));
  const relacionesActualesEsperadas =
    JSON.stringify(relaciones) ===
    JSON.stringify([...relacionesMigradasEsperadas].sort(compararObjetosEsquema));
  const restriccionesPreviasRf1ExecuteActuales =
    JSON.stringify(restricciones) === JSON.stringify(restriccionesPreviasRf1ExecuteEsperadas);
  const restriccionesActualesEsperadas =
    JSON.stringify(restricciones) === JSON.stringify(restriccionesEsperadas);
  const secuenciasEsperadasExactas =
    JSON.stringify(secuencias) ===
    JSON.stringify([...secuenciasEsperadas].sort(compararObjetosEsquema));
  const ledgerActualEsperado = coincidenHashesDeMigracion(hashes, hashesEsperados);
  const ledgerAnteriorEsperado = coincidenHashesDeMigracion(hashes, hashesEsperados.slice(0, -1));
  const esquemaPrevioRf1ExecuteSeguro =
    hashesEsperados.length > 0 &&
    esquemasPortalEsperados &&
    tablasActualesEsperadas &&
    secuenciasEsperadasExactas &&
    relacionesActualesEsperadas &&
    restriccionesPreviasRf1ExecuteActuales &&
    ledgerAnteriorEsperado &&
    objetosAdicionalesLimpios &&
    filasSinDatos &&
    estado.filas.invariantes === 1;
  if (esquemaPrevioRf1ExecuteSeguro) {
    return 'migracion-pendiente';
  }

  const estadoMigrado =
    esquemasPortalEsperados &&
    tablasActualesEsperadas &&
    secuenciasEsperadasExactas &&
    relacionesActualesEsperadas &&
    restriccionesActualesEsperadas &&
    ledgerActualEsperado &&
    objetosAdicionalesLimpios &&
    filasSinDatos &&
    estado.filas.invariantes === 1;

  if (!estadoMigrado) {
    const diferencias = [
      ...(esquemasPortalEsperados ? [] : ['esquemas']),
      ...(tablasActualesEsperadas ? [] : ['tablas']),
      ...(secuenciasEsperadasExactas ? [] : ['secuencias']),
      ...(relacionesActualesEsperadas ? [] : ['índices y relaciones']),
      ...(restriccionesActualesEsperadas ? [] : ['restricciones']),
      ...(ledgerActualEsperado ? [] : ['historial de migraciones']),
      ...(objetosAdicionalesLimpios ? [] : ['objetos adicionales']),
      ...(filasSinDatos ? [] : ['filas de autenticación']),
      ...(estado.filas.invariantes === 1 || estado.filas.invariantes === 0 ? [] : ['invariantes']),
    ];
    throw new Error(
      `La base de pruebas contiene objetos o datos fuera del estado aprobado (${diferencias.join(', ')}).`,
    );
  }

  return 'migrado';
}

/**
 * Inspecciona catálogos y conteos del destino sin leer datos de otras aplicaciones.
 * @param url URL de la base de pruebas validada por el runner.
 * @returns Clasificación vacía o migrada del esquema permitido.
 * @throws Error si la consulta o cualquier elemento del estado no puede validarse.
 * @effects Abre una conexión PostgreSQL read-only y la cierra antes de retornar.
 */
export async function verificarEstadoEsquemaBasePrueba(
  url: string,
): Promise<'vacio' | 'migracion-pendiente' | 'migrado'> {
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
    queue_timeout: 5,
    query_timeout: 10,
    connection: {
      application_name: 'portal-ps003-test-schema-preflight',
      default_transaction_read_only: true,
      statement_timeout: 10_000,
      lock_timeout: 2_000,
      idle_in_transaction_session_timeout: 5_000,
    },
  });

  try {
    const esquemas = await sql<{ esquema: string }[]>`
      SELECT nspname AS esquema
      FROM pg_namespace
      WHERE nspname <> 'information_schema'
        AND left(nspname, 3) <> 'pg_'
      ORDER BY nspname
    `;
    const tablas = await sql<{ esquema: string; nombre: string; tipo: string }[]>`
      SELECT esquema.nspname AS esquema,
             relacion.relname AS nombre,
             CASE WHEN relacion.relkind IN ('r', 'p') THEN 'BASE TABLE'
                  WHEN relacion.relkind = 'v' THEN 'VIEW'
                  WHEN relacion.relkind = 'm' THEN 'MATERIALIZED VIEW'
                  ELSE 'FOREIGN TABLE' END AS tipo
      FROM pg_class AS relacion
      JOIN pg_namespace AS esquema ON esquema.oid = relacion.relnamespace
      WHERE esquema.nspname IN ('public', 'portal')
        AND relacion.relkind IN ('r', 'p', 'v', 'm', 'f')
      ORDER BY esquema.nspname, relacion.relname
    `;
    const secuencias = await sql<{ esquema: string; nombre: string }[]>`
      SELECT esquema.nspname AS esquema, secuencia.relname AS nombre
      FROM pg_class AS secuencia
      JOIN pg_namespace AS esquema ON esquema.oid = secuencia.relnamespace
      WHERE esquema.nspname IN ('public', 'portal')
        AND secuencia.relkind = 'S'
      ORDER BY esquema.nspname, secuencia.relname
    `;
    const relaciones = await sql<{ esquema: string; nombre: string; tipo: string }[]>`
      SELECT esquema.nspname AS esquema, relacion.relname AS nombre, relacion.relkind AS tipo
      FROM pg_class AS relacion
      JOIN pg_namespace AS esquema ON esquema.oid = relacion.relnamespace
      WHERE esquema.nspname IN ('public', 'portal')
        AND relacion.relkind IN ('r', 'p', 'v', 'm', 'f', 'S', 'i', 'I', 'c')
      ORDER BY esquema.nspname, relacion.relkind, relacion.relname
    `;
    const restricciones = await sql<
      { esquema: string; tabla: string; nombre: string; tipo: string }[]
    >`
      SELECT esquema.nspname AS esquema,
             tabla.relname AS tabla,
             restriccion.conname AS nombre,
             restriccion.contype::text AS tipo
      FROM pg_constraint AS restriccion
      JOIN pg_class AS tabla ON tabla.oid = restriccion.conrelid
      JOIN pg_namespace AS esquema ON esquema.oid = tabla.relnamespace
      WHERE esquema.nspname IN ('public', 'portal')
        AND restriccion.contype IN ('c', 'f', 'p', 'u', 'x')
      ORDER BY esquema.nspname, tabla.relname, restriccion.conname, restriccion.contype
    `;
    const [conteosObjetos] = await sql<
      {
        rutinas: number;
        disparadores: number;
        politicas: number;
        tiposPersonalizados: number;
        reglas: number;
        objetosGrandes: number;
      }[]
    >`
      SELECT
        (SELECT count(*)::integer
         FROM pg_proc AS rutina
         JOIN pg_namespace AS esquema ON esquema.oid = rutina.pronamespace
         WHERE esquema.nspname IN ('public', 'portal')) AS rutinas,
        (SELECT count(*)::integer
         FROM pg_trigger AS disparador
         JOIN pg_class AS tabla ON tabla.oid = disparador.tgrelid
         JOIN pg_namespace AS esquema ON esquema.oid = tabla.relnamespace
         WHERE esquema.nspname IN ('public', 'portal') AND NOT disparador.tgisinternal) AS disparadores,
        (SELECT count(*)::integer
         FROM pg_policy AS politica
         JOIN pg_class AS tabla ON tabla.oid = politica.polrelid
         JOIN pg_namespace AS esquema ON esquema.oid = tabla.relnamespace
         WHERE esquema.nspname IN ('public', 'portal')) AS politicas,
        (SELECT count(*)::integer
         FROM pg_type AS tipo
         JOIN pg_namespace AS esquema ON esquema.oid = tipo.typnamespace
         WHERE esquema.nspname IN ('public', 'portal')
           AND (tipo.typtype IN ('d', 'e', 'r', 'm') OR (tipo.typtype = 'c' AND tipo.typrelid = 0))) AS "tiposPersonalizados",
        (SELECT count(*)::integer
         FROM pg_rewrite AS regla
         JOIN pg_class AS tabla ON tabla.oid = regla.ev_class
         JOIN pg_namespace AS esquema ON esquema.oid = tabla.relnamespace
         WHERE esquema.nspname IN ('public', 'portal') AND regla.rulename <> '_RETURN') AS reglas,
        (SELECT count(*)::integer FROM pg_largeobject_metadata) AS "objetosGrandes"
    `;
    const extensiones = await sql<{ nombre: string; esquema: string }[]>`
      SELECT extension.extname AS nombre, namespace.nspname AS esquema
      FROM pg_extension AS extension
      JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace
      ORDER BY extension.extname, namespace.nspname
    `;
    const hashesEsperados = resolverVariantesHashesMigracionPrueba();

    let hashesMigraciones: string[] = [];
    let filas = {
      usuarios: 0,
      sesiones: 0,
      tokens: 0,
      limitadores: 0,
      auditoria: 0,
      invariantes: 0,
      clientes: 0,
      ambientesSap: 0,
      perfilesConexion: 0,
      asignacionesCliente: 0,
      capacidadesCliente: 0,
    };
    if (
      tablas.some((tabla) => tabla.esquema === 'portal' && tabla.nombre === '__drizzle_migrations')
    ) {
      const ledger = await sql<{ hash: string }[]>`
        SELECT hash FROM portal.__drizzle_migrations ORDER BY id
      `;
      hashesMigraciones = ledger.map((fila) => fila.hash);
    }
    if (tablas.some((tabla) => tabla.esquema === 'portal' && tabla.nombre === 'users')) {
      const [conteos] = await sql<(typeof filas)[]>`
        SELECT
          (SELECT count(*)::integer FROM portal.users) AS usuarios,
          (SELECT count(*)::integer FROM portal.sessions) AS sesiones,
          (SELECT count(*)::integer FROM portal.recovery_tokens) AS tokens,
          (SELECT count(*)::integer FROM portal.auth_throttle_windows) AS limitadores,
          (SELECT count(*)::integer FROM portal.audit_events) AS auditoria,
          (SELECT count(*)::integer FROM portal.auth_invariants) AS invariantes
      `;
      if (conteos !== undefined) {
        filas = { ...filas, ...conteos };
      }
    }
    if (
      tablas.some((tabla) => tabla.esquema === 'portal' && tabla.nombre === 'clients') &&
      tablas.some(
        (tabla) => tabla.esquema === 'portal' && tabla.nombre === 'client_sap_environments',
      )
    ) {
      const [conteosClientes] = await sql<{ clientes: number; ambientesSap: number }[]>`
        SELECT
          (SELECT count(*)::integer FROM portal.clients) AS clientes,
          (SELECT count(*)::integer FROM portal.client_sap_environments) AS "ambientesSap"
      `;
      if (conteosClientes !== undefined) {
        filas = { ...filas, ...conteosClientes };
      }
    }
    if (
      tablas.some(
        (tabla) => tabla.esquema === 'portal' && tabla.nombre === 'client_connection_profiles',
      )
    ) {
      const [conteosPerfiles] = await sql<{ perfilesConexion: number }[]>`
        SELECT count(*)::integer AS "perfilesConexion" FROM portal.client_connection_profiles
      `;
      if (conteosPerfiles !== undefined) {
        filas = { ...filas, ...conteosPerfiles };
      }
    }
    if (
      tablas.some(
        (tabla) => tabla.esquema === 'portal' && tabla.nombre === 'client_user_assignments',
      ) &&
      tablas.some((tabla) => tabla.esquema === 'portal' && tabla.nombre === 'client_capabilities')
    ) {
      const [conteosAcceso] = await sql<
        { asignacionesCliente: number; capacidadesCliente: number }[]
      >`
        SELECT
          (SELECT count(*)::integer FROM portal.client_user_assignments) AS "asignacionesCliente",
          (SELECT count(*)::integer FROM portal.client_capabilities) AS "capacidadesCliente"
      `;
      if (conteosAcceso !== undefined) {
        filas = { ...filas, ...conteosAcceso };
      }
    }
    return validarEstadoEsquemaBasePrueba(
      {
        esquemas: esquemas.map((fila) => fila.esquema),
        tablas,
        secuencias,
        relaciones,
        restricciones,
        hashesMigraciones,
        objetosAdicionales: {
          rutinas: conteosObjetos?.rutinas ?? -1,
          disparadores: conteosObjetos?.disparadores ?? -1,
          politicas: conteosObjetos?.politicas ?? -1,
          tiposPersonalizados: conteosObjetos?.tiposPersonalizados ?? -1,
          reglas: conteosObjetos?.reglas ?? -1,
          objetosGrandes: conteosObjetos?.objetosGrandes ?? -1,
          extensiones,
        },
        filas,
      },
      hashesEsperados,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(
        'La base de pruebas contiene objetos o datos fuera del estado aprobado',
      )
    ) {
      throw error;
    }

    const codigoSql =
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(error.code)
        ? error.code
        : undefined;
    const diagnostico = codigoSql === undefined ? '' : ` (SQLSTATE ${codigoSql})`;
    throw new Error(`No fue posible verificar el estado de la base de pruebas.${diagnostico}`);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // La limpieza del socket no debe revelar el DSN ni ocultar el resultado de preflight.
    }
  }
}

/**
 * Ordena objetos relacionales por esquema, nombre y tipo.
 * @param izquierda Primer objeto de la comparación.
 * @param derecha Segundo objeto de la comparación.
 * @returns Resultado del orden lexicográfico de objetos.
 */
function compararObjetosEsquema(
  izquierda: { readonly esquema: string; readonly nombre: string; readonly tipo?: string },
  derecha: { readonly esquema: string; readonly nombre: string; readonly tipo?: string },
): number {
  return (
    izquierda.esquema.localeCompare(derecha.esquema) ||
    izquierda.nombre.localeCompare(derecha.nombre) ||
    (izquierda.tipo ?? '').localeCompare(derecha.tipo ?? '')
  );
}

/**
 * Ordena restricciones por esquema, tabla, nombre y tipo para comparar listas cerradas.
 * @param izquierda Restricción situada a la izquierda de la comparación.
 * @param derecha Restricción situada a la derecha de la comparación.
 * @returns Resultado de orden lexicográfico de las restricciones.
 */
function compararRestricciones(
  izquierda: {
    readonly esquema: string;
    readonly tabla: string;
    readonly nombre: string;
    readonly tipo: string;
  },
  derecha: {
    readonly esquema: string;
    readonly tabla: string;
    readonly nombre: string;
    readonly tipo: string;
  },
): number {
  return (
    izquierda.esquema.localeCompare(derecha.esquema) ||
    izquierda.tabla.localeCompare(derecha.tabla) ||
    izquierda.nombre.localeCompare(derecha.nombre) ||
    izquierda.tipo.localeCompare(derecha.tipo)
  );
}

/**
 * Compara el ledger remoto con las variantes locales permitidas en orden de migración.
 * @param hashesRegistrados Hashes del ledger PostgreSQL ordenados por id.
 * @param variantesEsperadas Hashes permitidos para cada migración versionada.
 * @returns `true` cuando cantidad, orden y contenido coinciden.
 */
function coincidenHashesDeMigracion(
  hashesRegistrados: readonly string[],
  variantesEsperadas: readonly (readonly string[])[],
): boolean {
  return (
    hashesRegistrados.length === variantesEsperadas.length &&
    hashesRegistrados.every((hash, indice) => variantesEsperadas[indice]?.includes(hash) === true)
  );
}

/**
 * Calcula los hashes Drizzle válidos para archivos con finales de línea Windows o Unix.
 * @returns Variantes permitidas por migración, conservando el orden del journal.
 * @throws Error si el journal o sus archivos no coinciden.
 * @effects Lee únicamente los archivos locales versionados de migración.
 */
function resolverVariantesHashesMigracionPrueba(): readonly (readonly string[])[] {
  const carpeta = resolverCarpetaMigracionesPrueba();
  const diario = JSON.parse(readFileSync(resolve(carpeta, 'meta', '_journal.json'), 'utf8')) as {
    readonly entries: readonly { readonly tag: string }[];
  };
  const migraciones = readMigrationFiles({ migrationsFolder: carpeta, migrationsSchema: 'portal' });
  if (diario.entries.length !== migraciones.length) {
    throw new Error('El diario y los archivos de migración no coinciden.');
  }

  return diario.entries.map((entrada, indice) => {
    if (!/^[A-Za-z0-9_-]+$/.test(entrada.tag)) {
      throw new Error('El diario de migraciones contiene una etiqueta no válida.');
    }
    const contenidoOriginal = readFileSync(resolve(carpeta, `${entrada.tag}.sql`), 'utf8');
    const contenidoUnix = contenidoOriginal.split('\r\n').join('\n');
    const contenidoWindows = contenidoUnix.split('\n').join('\r\n');
    const hashMigracion = migraciones[indice]?.hash;
    if (hashMigracion === undefined) {
      throw new Error('No se pudo calcular el hash de una migración.');
    }

    return [
      ...new Set([
        hashMigracion,
        createHash('sha256').update(contenidoUnix).digest('hex'),
        createHash('sha256').update(contenidoWindows).digest('hex'),
      ]),
    ];
  });
}

/**
 * Localiza el directorio versionado de migraciones en fuente o salida compilada.
 * @returns Ruta absoluta del journal Drizzle existente.
 * @throws Error si no se encuentra un journal versionado.
 */
function resolverCarpetaMigracionesPrueba(): string {
  const carpetaFuente = fileURLToPath(new URL('../../drizzle', import.meta.url));
  if (existsSync(resolve(carpetaFuente, 'meta', '_journal.json'))) {
    return carpetaFuente;
  }

  const carpetaProyecto = resolve(process.cwd(), 'apps/api/drizzle');
  if (existsSync(resolve(carpetaProyecto, 'meta', '_journal.json'))) {
    return carpetaProyecto;
  }

  throw new Error('No se encontró el journal versionado de Drizzle.');
}
