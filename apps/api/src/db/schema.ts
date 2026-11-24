import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { EstadoUsuario, RolUsuario } from '../../../../packages/core/src/auth/models.js';
import type { TemaPreferenciaUsuario } from '../../../../packages/core/src/preferences/models.js';
import type { SobreSecretoCifrado } from '../../../../packages/core/src/clients/secret-custody-ports.js';

const esquemaPortal = pgSchema('portal');

type ColumnasUsuarioRestricciones = {
  emailNormalized: AnyPgColumn;
  emailVerifiedAt: AnyPgColumn;
  passwordHash: AnyPgColumn;
  role: AnyPgColumn;
  status: AnyPgColumn;
  themePreference: AnyPgColumn;
  usernameNormalized: AnyPgColumn;
};

type ColumnasSesionIndices = {
  absoluteExpiresAt: AnyPgColumn;
  idleExpiresAt: AnyPgColumn;
  userId: AnyPgColumn;
};

type ColumnasTokenRestricciones = {
  expiresAt: AnyPgColumn;
  purpose: AnyPgColumn;
  targetEmail: AnyPgColumn;
  userId: AnyPgColumn;
};

type ColumnasThrottleRestricciones = {
  attemptCount: AnyPgColumn;
  expiresAt: AnyPgColumn;
  scope: AnyPgColumn;
};

type ColumnasAuditoriaRestricciones = {
  actorUserId: AnyPgColumn;
  createdAt: AnyPgColumn;
  outcome: AnyPgColumn;
  targetUserId: AnyPgColumn;
};

type ColumnasInvariantesRestricciones = {
  id: AnyPgColumn;
};

type ColumnasAsignacionClienteRestricciones = {
  clientId: AnyPgColumn;
  userId: AnyPgColumn;
  revokedByUserId: AnyPgColumn;
  revokedAt: AnyPgColumn;
};

type ColumnasCapacidadClienteRestricciones = {
  capabilityId: AnyPgColumn;
  enabled: AnyPgColumn;
};

type ColumnasClienteRestricciones = {
  displayName: AnyPgColumn;
  status: AnyPgColumn;
};

type ColumnasAmbienteSapRestricciones = {
  clientId: AnyPgColumn;
  code: AnyPgColumn;
  displayName: AnyPgColumn;
  status: AnyPgColumn;
};

type ColumnasPerfilConexionRestricciones = {
  databaseName: AnyPgColumn;
  clientId: AnyPgColumn;
  destinationId: AnyPgColumn;
  destinationHostname: AnyPgColumn;
  destinationPort: AnyPgColumn;
  displayName: AnyPgColumn;
  gatewayId: AnyPgColumn;
  gatewayHostname: AnyPgColumn;
  gatewayPort: AnyPgColumn;
  gatewayFingerprint: AnyPgColumn;
  profileType: AnyPgColumn;
  environment: AnyPgColumn;
  status: AnyPgColumn;
};

/** Define índices únicos y restricciones de coherencia para la identidad del portal. */
function definirRestriccionesUsuario(columnas: ColumnasUsuarioRestricciones) {
  return {
    correoNormalizadoUnico: uniqueIndex('users_email_normalized_unique').on(
      columnas.emailNormalized,
    ),
    rolValido: check('users_role_check', sql`${columnas.role} IN ('ADMIN', 'SUPPORT')`),
    estadoValido: check(
      'users_status_check',
      sql`${columnas.status} IN ('PENDING_ACTIVATION', 'ACTIVE', 'DISABLED')`,
    ),
    temaPreferidoValido: check(
      'users_theme_preference_check',
      sql`${columnas.themePreference} IN ('system', 'light', 'dark')`,
    ),
    credencialCoherente: check(
      'users_credential_state_check',
      sql`(${columnas.status} = 'PENDING_ACTIVATION' AND ${columnas.passwordHash} IS NULL AND ${columnas.emailVerifiedAt} IS NULL) OR (${columnas.status} = 'DISABLED' AND ${columnas.passwordHash} IS NULL AND ${columnas.emailVerifiedAt} IS NULL) OR (${columnas.status} IN ('ACTIVE', 'DISABLED') AND ${columnas.passwordHash} IS NOT NULL)`,
    ),
    usuarioNormalizadoUnico: uniqueIndex('users_username_normalized_unique').on(
      columnas.usernameNormalized,
    ),
  };
}

/** Define índices de consulta por propietario y expiración de las sesiones. */
function definirIndicesSesion(columnas: ColumnasSesionIndices) {
  return {
    vencimientoAbsolutoIdx: index('sessions_absolute_expires_at_idx').on(
      columnas.absoluteExpiresAt,
    ),
    vencimientoInactivoIdx: index('sessions_idle_expires_at_idx').on(columnas.idleExpiresAt),
    propietarioIdx: index('sessions_user_id_idx').on(columnas.userId),
  };
}

/** Valida el propósito y los datos asociados a cada token de un solo uso. */
function definirRestriccionesToken(columnas: ColumnasTokenRestricciones) {
  return {
    vencimientoIdx: index('recovery_tokens_expires_at_idx').on(columnas.expiresAt),
    propietarioIdx: index('recovery_tokens_user_id_idx').on(columnas.userId),
    propositoValido: check(
      'recovery_tokens_purpose_check',
      sql`${columnas.purpose} IN ('ACTIVATION', 'PASSWORD_RECOVERY', 'EMAIL_CHANGE', 'EMAIL_VERIFICATION')`,
    ),
    correoObjetivoEmailChange: check(
      'recovery_tokens_target_email_check',
      sql`(${columnas.purpose} = 'EMAIL_CHANGE' AND ${columnas.targetEmail} IS NOT NULL) OR (${columnas.purpose} <> 'EMAIL_CHANGE' AND ${columnas.targetEmail} IS NULL)`,
    ),
    expiracionPositiva: check(
      'recovery_tokens_expiration_check',
      sql`${columnas.expiresAt} > '1970-01-01T00:00:00Z'::timestamptz`,
    ),
  };
}

/** Limita los alcances admitidos y evita contadores negativos en la protección antiabuso. */
function definirRestriccionesThrottle(columnas: ColumnasThrottleRestricciones) {
  return {
    expiracionIdx: index('auth_throttle_expires_at_idx').on(columnas.expiresAt),
    alcanceValido: check(
      'auth_throttle_scope_check',
      sql`${columnas.scope} IN ('LOGIN_ACCOUNT', 'LOGIN_NETWORK', 'RECOVERY_ACCOUNT', 'RECOVERY_NETWORK')`,
    ),
    intentosNoNegativos: check(
      'auth_throttle_attempt_count_check',
      sql`${columnas.attemptCount} >= 0`,
    ),
    expiracionPositiva: check(
      'auth_throttle_expiration_check',
      sql`${columnas.expiresAt} > '1970-01-01T00:00:00Z'::timestamptz`,
    ),
  };
}

/** Limita los resultados persistidos de auditoría a los valores públicos acordados. */
function definirRestriccionesAuditoria(columnas: ColumnasAuditoriaRestricciones) {
  return {
    actorFechaIdx: index('audit_events_actor_created_idx').on(
      columnas.actorUserId,
      columnas.createdAt,
    ),
    objetivoFechaIdx: index('audit_events_target_created_idx').on(
      columnas.targetUserId,
      columnas.createdAt,
    ),
    fechaIdx: index('audit_events_created_at_idx').on(columnas.createdAt),
    resultadoValido: check(
      'audit_events_outcome_check',
      sql`${columnas.outcome} IN ('SUCCESS', 'FAILURE', 'DENIED')`,
    ),
  };
}

/** Mantiene un solo registro bloqueable para serializar cambios de administradores. */
function definirRestriccionesInvariantes(columnas: ColumnasInvariantesRestricciones) {
  return {
    singleton: check('auth_invariants_singleton_check', sql`${columnas.id} = 1`),
  };
}

/** Evita concesiones activas duplicadas y exige metadatos de revocación coherentes. */
function definirRestriccionesAsignacionCliente(columnas: ColumnasAsignacionClienteRestricciones) {
  return {
    clienteUsuarioActivoUnico: uniqueIndex('client_user_assignments_active_pair_unique')
      .on(columnas.clientId, columnas.userId)
      .where(sql`${columnas.revokedAt} IS NULL`),
    usuarioActivoIdx: index('client_user_assignments_user_id_idx')
      .on(columnas.userId)
      .where(sql`${columnas.revokedAt} IS NULL`),
    revocacionCoherente: check(
      'client_user_assignments_revocation_metadata_check',
      sql`(${columnas.revokedByUserId} IS NULL AND ${columnas.revokedAt} IS NULL) OR (${columnas.revokedByUserId} IS NOT NULL AND ${columnas.revokedAt} IS NOT NULL)`,
    ),
  };
}

/** Limita la tabla de capacidades a los identificadores RF-1 conocidos. */
function definirRestriccionesCapacidadCliente(columnas: ColumnasCapacidadClienteRestricciones) {
  return {
    capacidadPermitida: check(
      'client_capabilities_id_check',
      sql`${columnas.capabilityId} IN ('rf-1:read', 'rf-1:execute')`,
    ),
  };
}

/** Limita nombre y estado de un cliente y facilita filtros del panel administrativo. */
function definirRestriccionesCliente(columnas: ColumnasClienteRestricciones) {
  return {
    estadoValido: check('clients_status_check', sql`${columnas.status} IN ('ACTIVE', 'DISABLED')`),
    nombreNoVacio: check('clients_name_check', sql`length(trim(${columnas.displayName})) >= 2`),
    nombreIdx: index('clients_display_name_idx').on(columnas.displayName),
    estadoIdx: index('clients_status_idx').on(columnas.status),
  };
}

/** Restringe el código SAP dentro del cliente y prepara búsquedas por propietario. */
function definirRestriccionesAmbienteSap(columnas: ColumnasAmbienteSapRestricciones) {
  return {
    codigoPorClienteUnico: uniqueIndex('client_sap_environments_client_code_unique').on(
      columnas.clientId,
      columnas.code,
    ),
    propietarioIdx: index('client_sap_environments_client_id_idx').on(columnas.clientId),
    estadoIdx: index('client_sap_environments_status_idx').on(columnas.status),
    codigoValido: check(
      'client_sap_environments_code_check',
      sql`${columnas.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'`,
    ),
    estadoValido: check(
      'client_sap_environments_status_check',
      sql`${columnas.status} IN ('ACTIVE', 'DISABLED')`,
    ),
    nombreNoVacio: check(
      'client_sap_environments_name_check',
      sql`length(trim(${columnas.displayName})) >= 2`,
    ),
  };
}

/** Restringe perfiles MySQL a metadatos allowlisted y oculta nombres/credenciales del catálogo. */
function definirRestriccionesPerfilConexion(columnas: ColumnasPerfilConexionRestricciones) {
  return {
    nombrePorClienteUnico: uniqueIndex('client_connection_profiles_client_name_unique').on(
      columnas.clientId,
      sql`lower(${columnas.displayName})`,
    ),
    propietarioIdx: index('client_connection_profiles_client_id_idx').on(columnas.clientId),
    estadoIdx: index('client_connection_profiles_status_idx').on(columnas.status),
    tipoValido: check(
      'client_connection_profiles_type_check',
      sql`${columnas.profileType} IN ('MYSQL_TCP', 'MYSQL_SSH')`,
    ),
    ambienteValido: check(
      'client_connection_profiles_environment_check',
      sql`${columnas.environment} IN ('PRODUCTION', 'TEST')`,
    ),
    estadoValido: check(
      'client_connection_profiles_status_check',
      sql`${columnas.status} IN ('ACTIVE', 'DISABLED')`,
    ),
    nombreNoVacio: check(
      'client_connection_profiles_name_check',
      sql`length(trim(${columnas.displayName})) >= 2`,
    ),
    destinoValido: check(
      'client_connection_profiles_destination_check',
      sql`${columnas.destinationId} ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`,
    ),
    baseValida: check(
      'client_connection_profiles_database_check',
      sql`${columnas.databaseName} ~ '^[A-Za-z0-9_$-]{1,64}$'`,
    ),
    gatewayCoherente: check(
      'client_connection_profiles_gateway_check',
      sql`(${columnas.profileType} = 'MYSQL_SSH' AND ${columnas.gatewayId} ~ '^[a-z0-9][a-z0-9_-]{0,63}$') OR (${columnas.profileType} = 'MYSQL_TCP' AND ${columnas.gatewayId} IS NULL)`,
    ),
    destinoEndpointCompleto: check(
      'client_connection_profiles_destination_endpoint_check',
      sql`(${columnas.destinationHostname} IS NULL AND ${columnas.destinationPort} IS NULL) OR (${columnas.destinationHostname} IS NOT NULL AND btrim(${columnas.destinationHostname}) <> '' AND ${columnas.destinationPort} BETWEEN 1 AND 65535)`,
    ),
    gatewayEndpointCoherente: check(
      'client_connection_profiles_gateway_endpoint_check',
      sql`(${columnas.destinationHostname} IS NULL AND ${columnas.destinationPort} IS NULL AND ${columnas.gatewayHostname} IS NULL AND ${columnas.gatewayPort} IS NULL AND ${columnas.gatewayFingerprint} IS NULL) OR (${columnas.profileType} = 'MYSQL_TCP' AND ${columnas.destinationHostname} IS NOT NULL AND ${columnas.destinationPort} BETWEEN 1 AND 65535 AND ${columnas.gatewayHostname} IS NULL AND ${columnas.gatewayPort} IS NULL AND ${columnas.gatewayFingerprint} IS NULL) OR (${columnas.profileType} = 'MYSQL_SSH' AND ${columnas.destinationHostname} IS NOT NULL AND ${columnas.destinationPort} BETWEEN 1 AND 65535 AND ${columnas.gatewayHostname} IS NOT NULL AND btrim(${columnas.gatewayHostname}) <> '' AND ${columnas.gatewayPort} BETWEEN 1 AND 65535 AND ${columnas.gatewayFingerprint} ~ '^SHA256:[A-Za-z0-9+/]{43}$')`,
    ),
    endpointPerfilCompleto: check(
      'client_connection_profiles_complete_endpoint_check',
      sql`(${columnas.destinationHostname} IS NULL AND ${columnas.destinationPort} IS NULL AND ${columnas.gatewayHostname} IS NULL AND ${columnas.gatewayPort} IS NULL AND ${columnas.gatewayFingerprint} IS NULL) OR (${columnas.profileType} = 'MYSQL_TCP' AND ${columnas.destinationHostname} IS NOT NULL AND btrim(${columnas.destinationHostname}) <> '' AND ${columnas.destinationPort} IS NOT NULL AND ${columnas.destinationPort} BETWEEN 1 AND 65535 AND ${columnas.gatewayHostname} IS NULL AND ${columnas.gatewayPort} IS NULL AND ${columnas.gatewayFingerprint} IS NULL) OR (${columnas.profileType} = 'MYSQL_SSH' AND ${columnas.destinationHostname} IS NOT NULL AND btrim(${columnas.destinationHostname}) <> '' AND ${columnas.destinationPort} IS NOT NULL AND ${columnas.destinationPort} BETWEEN 1 AND 65535 AND ${columnas.gatewayHostname} IS NOT NULL AND btrim(${columnas.gatewayHostname}) <> '' AND ${columnas.gatewayPort} IS NOT NULL AND ${columnas.gatewayPort} BETWEEN 1 AND 65535 AND ${columnas.gatewayFingerprint} IS NOT NULL AND ${columnas.gatewayFingerprint} ~ '^SHA256:[A-Za-z0-9+/]{43}$')`,
    ),
  };
}

/** Devuelve la clave referencial de usuario para sesiones. */
function referenciarUsuarioDeSesion(): AnyPgColumn {
  return users.id;
}

/** Devuelve la clave referencial de usuario para tokens. */
function referenciarUsuarioDeToken(): AnyPgColumn {
  return users.id;
}

/** Devuelve la clave referencial opcional del actor de auditoría. */
function referenciarActorDeAuditoria(): AnyPgColumn {
  return users.id;
}

/** Devuelve la clave referencial opcional del objetivo de auditoría. */
function referenciarObjetivoDeAuditoria(): AnyPgColumn {
  return users.id;
}

/** Persiste cuentas individuales y solo los hashes de credenciales. */
export const users = esquemaPortal.table(
  'users',
  {
    id: uuid('id').primaryKey(),
    username: varchar('username', { length: 64 }).notNull(),
    usernameNormalized: varchar('username_normalized', { length: 64 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    emailNormalized: varchar('email_normalized', { length: 254 }).notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true, mode: 'date' }),
    passwordHash: text('password_hash'),
    role: text('role').$type<RolUsuario>().notNull(),
    status: text('status').$type<EstadoUsuario>().notNull(),
    themePreference: text('theme_preference')
      .$type<TemaPreferenciaUsuario>()
      .notNull()
      .default('system'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  definirRestriccionesUsuario,
);

/** Conserva el catálogo de clientes sin incluir endpoints ni credenciales externas. */
export const clients = esquemaPortal.table(
  'clients',
  {
    id: uuid('id').primaryKey(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    status: text('status').$type<'ACTIVE' | 'DISABLED'>().notNull().default('ACTIVE'),
    createdByUserId: uuid('created_by_user_id').references(referenciarActorDeAuditoria, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  definirRestriccionesCliente,
);

/** Separa el código de ambiente SAP del entorno operativo de cada perfil de conexión. */
export const clientSapEnvironments = esquemaPortal.table(
  'client_sap_environments',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    code: varchar('code', { length: 32 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    status: text('status').$type<'ACTIVE' | 'DISABLED'>().notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  definirRestriccionesAmbienteSap,
);

/** Persiste metadatos de conexión y un sobre cifrado; nunca guarda credenciales en claro. */
export const clientConnectionProfiles = esquemaPortal.table(
  'client_connection_profiles',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    profileType: text('profile_type').$type<'MYSQL_TCP' | 'MYSQL_SSH'>().notNull(),
    environment: text('environment').$type<'PRODUCTION' | 'TEST'>().notNull(),
    destinationId: varchar('destination_id', { length: 64 }).notNull(),
    destinationHostname: varchar('destination_hostname', { length: 253 }),
    destinationPort: integer('destination_port'),
    gatewayId: varchar('gateway_id', { length: 64 }),
    gatewayHostname: varchar('gateway_hostname', { length: 253 }),
    gatewayPort: integer('gateway_port'),
    gatewayFingerprint: varchar('gateway_fingerprint', { length: 50 }),
    databaseName: varchar('database_name', { length: 64 }).notNull(),
    secretEnvelope: jsonb('secret_envelope').$type<SobreSecretoCifrado>().notNull(),
    status: text('status').$type<'ACTIVE' | 'DISABLED'>().notNull().default('ACTIVE'),
    createdByUserId: uuid('created_by_user_id').references(referenciarActorDeAuditoria, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  definirRestriccionesPerfilConexion,
);

/** Persiste sesiones opacas con expiración inactiva y absoluta comprobables. */
export const sessions = esquemaPortal.table(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(referenciarUsuarioDeSesion, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique('sessions_token_hash_unique'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  definirIndicesSesion,
);

/** Persiste hashes de tokens de activación, recuperación y cambio de correo. */
export const recoveryTokens = esquemaPortal.table(
  'recovery_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(referenciarUsuarioDeToken, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 })
      .notNull()
      .unique('recovery_tokens_token_hash_unique'),
    purpose: text('purpose').notNull(),
    targetEmail: varchar('target_email', { length: 254 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
  },
  definirRestriccionesToken,
);

/** Persiste contadores y bloqueos usando únicamente identificadores HMAC. */
export const authThrottleWindows = esquemaPortal.table(
  'auth_throttle_windows',
  {
    keyHash: varchar('key_hash', { length: 64 }).primaryKey(),
    scope: text('scope').notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true, mode: 'date' }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    blockedUntil: timestamp('blocked_until', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  definirRestriccionesThrottle,
);

/** Registra acciones sensibles con metadatos previamente limitados y saneados. */
export const auditEvents = esquemaPortal.table(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    actorUserId: uuid('actor_user_id').references(referenciarActorDeAuditoria, {
      onDelete: 'set null',
    }),
    targetUserId: uuid('target_user_id').references(referenciarObjetivoDeAuditoria, {
      onDelete: 'set null',
    }),
    action: varchar('action', { length: 80 }).notNull(),
    outcome: text('outcome').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  definirRestriccionesAuditoria,
);

/** Ofrece una fila centinela bloqueable para invariantes transaccionales. */
export const authInvariants = esquemaPortal.table(
  'auth_invariants',
  {
    id: smallint('id').primaryKey(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  definirRestriccionesInvariantes,
);

/** Conserva el historial de concesiones y revocaciones de clientes para usuarios SUPPORT. */
export const clientUserAssignments = esquemaPortal.table(
  'client_user_assignments',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    grantedByUserId: uuid('granted_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  definirRestriccionesAsignacionCliente,
);

/** Conserva capacidades explícitas por cliente, apagadas por defecto y sin ejecución RF-1. */
export const clientCapabilities = esquemaPortal.table(
  'client_capabilities',
  {
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    capabilityId: varchar('capability_id', { length: 64 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    changedByUserId: uuid('changed_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    changedAt: timestamp('changed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (columnas) => ({
    clavePrimaria: primaryKey({
      name: 'client_capabilities_pkey',
      columns: [columnas.clientId, columnas.capabilityId],
    }),
    ...definirRestriccionesCapacidadCliente(columnas),
  }),
);
