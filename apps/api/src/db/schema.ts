import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
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

const esquemaPortal = pgSchema('portal');

type ColumnasUsuarioRestricciones = {
  emailNormalized: AnyPgColumn;
  emailVerifiedAt: AnyPgColumn;
  passwordHash: AnyPgColumn;
  role: AnyPgColumn;
  status: AnyPgColumn;
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

type ColumnasMfaFactorRestricciones = {
  enabledAt: AnyPgColumn;
  lastTotpCounter: AnyPgColumn;
  seedCiphertext: AnyPgColumn;
  seedNonce: AnyPgColumn;
  seedTag: AnyPgColumn;
};

type ColumnasMfaRecoveryRestricciones = {
  consumedAt: AnyPgColumn;
  digest: AnyPgColumn;
  userId: AnyPgColumn;
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

/** Impone el formato Base64URL canónico y la coherencia de enrolamiento y contador TOTP. */
function definirRestriccionesMfaFactor(columnas: ColumnasMfaFactorRestricciones) {
  return {
    nonceBase64Url: check(
      'user_mfa_factors_nonce_check',
      sql`${columnas.seedNonce} ~ '^[A-Za-z0-9_-]{16}$'`,
    ),
    ciphertextBase64Url: check(
      'user_mfa_factors_ciphertext_check',
      sql`${columnas.seedCiphertext} ~ '^[A-Za-z0-9_-]{26}[AEIMQUYcgkosw048]$'`,
    ),
    tagBase64Url: check(
      'user_mfa_factors_tag_check',
      sql`${columnas.seedTag} ~ '^[A-Za-z0-9_-]{21}[AEIMQUYcgkosw048]$'`,
    ),
    contadorEnRango: check(
      'user_mfa_factors_counter_check',
      sql`${columnas.lastTotpCounter} IS NULL OR (${columnas.lastTotpCounter} >= 0 AND ${columnas.lastTotpCounter} <= 18446744073709551615)`,
    ),
    estadoDeEnrolamientoCoherente: check(
      'user_mfa_factors_enabled_counter_check',
      sql`(${columnas.enabledAt} IS NULL AND ${columnas.lastTotpCounter} IS NULL) OR (${columnas.enabledAt} IS NOT NULL AND ${columnas.lastTotpCounter} IS NOT NULL)`,
    ),
  };
}

/** Impone digest hexadecimal y unicidad del código de recuperación por usuario. */
function definirRestriccionesMfaRecovery(columnas: ColumnasMfaRecoveryRestricciones) {
  return {
    digestHexadecimal: check(
      'user_mfa_recovery_codes_digest_check',
      sql`${columnas.digest} ~ '^[a-f0-9]{64}$'`,
    ),
    propietarioDigestUnicos: primaryKey({
      name: 'user_mfa_recovery_codes_pk',
      columns: [columnas.userId, columnas.digest],
    }),
    propietarioConsumidoIdx: index('user_mfa_recovery_codes_user_consumed_idx').on(
      columnas.userId,
      columnas.consumedAt,
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
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  definirRestriccionesUsuario,
);

/** Persiste una sola semilla cifrada por usuario y el estado verificable de su enrolamiento TOTP. */
export const userMfaFactors = esquemaPortal.table(
  'user_mfa_factors',
  {
    /** Cuenta propietaria; la restricción impide borrar una cuenta con factor MFA. */
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Nonce GCM de doce bytes codificado en Base64URL canónico sin padding. */
    seedNonce: varchar('seed_nonce', { length: 16 }).notNull(),
    /** Semilla TOTP cifrada de veinte bytes codificada en Base64URL canónico sin padding. */
    seedCiphertext: varchar('seed_ciphertext', { length: 27 }).notNull(),
    /** Etiqueta GCM de dieciséis bytes codificada en Base64URL canónico sin padding. */
    seedTag: varchar('seed_tag', { length: 22 }).notNull(),
    /** Instante en que se validó el primer factor; null indica enrolamiento pendiente. */
    enabledAt: timestamp('enabled_at', { withTimezone: true, mode: 'date' }),
    /** Último contador TOTP aceptado, exacto y no negativo, para impedir su reutilización. */
    lastTotpCounter: numeric('last_totp_counter', {
      precision: 20,
      scale: 0,
      mode: 'bigint',
    }),
    /** Fecha UTC de creación del factor. */
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** Fecha UTC de la última actualización del enrolamiento o contador. */
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  definirRestriccionesMfaFactor,
);

/** Persiste únicamente digests de códigos de recuperación y su estado de consumo. */
export const userMfaRecoveryCodes = esquemaPortal.table(
  'user_mfa_recovery_codes',
  {
    /** Factor propietario; la referencia restringida conserva integridad ante borrados. */
    userId: uuid('user_id')
      .notNull()
      .references(() => userMfaFactors.userId, { onDelete: 'restrict' }),
    /** Digest SHA-256 hexadecimal en minúsculas; nunca se almacena el código original. */
    digest: varchar('digest', { length: 64 }).notNull(),
    /** Fecha UTC de creación del digest. */
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** Fecha UTC de consumo; null indica que el código aún es utilizable. */
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
  },
  definirRestriccionesMfaRecovery,
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
