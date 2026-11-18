import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { EstadoUsuario, RolUsuario } from '../../../../packages/core/src/auth/models.js';

type ColumnasUsuarioRestricciones = {
  emailNormalized: AnyPgColumn;
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
      sql`(${columnas.status} = 'PENDING_ACTIVATION' AND ${columnas.passwordHash} IS NULL) OR (${columnas.status} IN ('ACTIVE', 'DISABLED') AND ${columnas.passwordHash} IS NOT NULL)`,
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
export const users = pgTable(
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

/** Persiste sesiones opacas con expiración inactiva y absoluta comprobables. */
export const sessions = pgTable(
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
export const recoveryTokens = pgTable(
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
export const authThrottleWindows = pgTable(
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
export const auditEvents = pgTable(
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
export const authInvariants = pgTable(
  'auth_invariants',
  {
    id: smallint('id').primaryKey(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  definirRestriccionesInvariantes,
);
