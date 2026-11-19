# PS-003 Remote PostgreSQL Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow integration and E2E suites to use an explicitly configured PostgreSQL test database through the existing SSH tunnel, while preventing any test mutation outside the isolated Portal test database.

**Architecture:** Preserve the local ephemeral-cluster mode. Add a remote SSH-tunnel mode whose application and migration DSNs use separate exact roles, whose URL is fixed to `127.0.0.1:15432/portal_soporte_test`, and whose mutations require an explicit environment gate. A read-only preflight validates the connected PostgreSQL identity and role before migrations or tests start; no server operation runs as part of implementing this plan.

**Tech Stack:** Node.js 24, strict TypeScript, `postgres` 4.1, Drizzle ORM, Vitest, Playwright, PostgreSQL, PowerShell/OpenSSH on the authorized Windows runner.

**Spec:** `docs/operations/INFRA-001_POSTGRES_PLAN.md`; `docs/security/PS-003_AUTHENTICATION.md`; `docs/operations/TEST_STRATEGY.md`; owner instructions dated 2026-11-18.

## Global Constraints

- Test writes and migrations may target only `portal_soporte_test` through `127.0.0.1:15432` and the active SSH tunnel to `daniel@10.18.170.44`.
- Remote app and migration users are distinct (`portal_test_runner`, `portal_test_migrator`) and distinct from `portal_app` and `portal_migrator`.
- No remote migration or destructive test runs before a read-only target preflight and the exact mutation opt-in.
- Integration and E2E workers stay at one; connection pools, statements, locks and hooks have bounded timeouts.
- The local ephemeral PostgreSQL path, test coverage and PGlite simulations remain available.
- No credentials are written to Git, argv, logs, test output or WORKLOG; secure local environment files remain gitignored.
- No push, merge, deployment, server configuration change, or write to a pre-existing database is in scope.

## Review Focus

- A production database URL, wrong DB name, username, host, port, query parameter, or absent opt-in must fail before network access.
- A PostgreSQL endpoint with mismatched database/role/server identity or privileged test role must fail before migrations or writes.
- Existing/unknown objects or migration history must be detected without deletion and must stop remote execution.
- A repeated remote run must preserve unrelated rows and use only generated IDs or exact generated schema names for cleanup.
- E2E must use the app role for API requests and the separate migrator role only for migrations.

---

### Task 1: Remote Test Configuration Contract

**Files:**
- Modify: `apps/api/src/runtime-config.ts`
- Modify: `tests/unit/api-runtime-config.test.ts`
- Modify: `tests/unit/auth-db-client.test.ts`

**Interfaces:**
- Produce `cargarConfiguracionBasePrueba(variables)` returning the validated mode, app `TEST_DATABASE_URL`, and migration URL.
- Remote mode requires `TEST_DATABASE_MODE=ssh-tunnel`, `TEST_DATABASE_ALLOW_MUTATIONS=portal_soporte_test`, app role `portal_test_runner`, migrator role `portal_test_migrator`, exact database/host/port, and nonempty passwords.
- Local mode retains `portal_ps003_test`, `ps003_test`, loopback, no password, and no query/fragment.

- [x] Add unit cases for exact remote acceptance and reject each wrong mode/database/role/host/port, absent password, query, fragment, and mutation gate.
- [x] Run the focused config tests and observe the expected RED failures.
- [x] Implement the shared validator and ensure failures never contain URLs or credentials.
- [x] Run focused tests and verify GREEN.

### Task 2: Read-Only Remote Preflight and Bounded Connections

**Files:**
- Create: `apps/api/src/db/test-database-preflight.ts`
- Modify: `apps/api/src/db/client.ts`
- Modify: `tests/unit/auth-db-client.test.ts`
- Create: `tests/unit/test-database-preflight.test.ts`

**Interfaces:**
- Produce `verificarIdentidadBasePrueba(url, rolEsperado)` that performs only `SELECT`, returns sanitized database/role/server address/port/version/role flags, and throws generic redacted errors.
- Remote app and migrator connections must report the same PostgreSQL endpoint; both roles must have all administrative flags false. The runner has no schema/database creation; the migrator has only the database-local schema creation needed by its migration tests.
- Test connection pools use at most 3 connections with bounded connect, idle, statement and lock waits.

- [x] Add pure tests for rejecting wrong identity, role flags, port and DB before mutation.
- [x] Verify RED, implement read-only preflight and bounded pool settings, then verify GREEN.

### Task 3: Runner, Migrations and Test Cleanup

**Files:**
- Modify: `scripts/with-test-postgres.ts`
- Modify: `apps/api/src/db/migrate-cli.ts`
- Modify: `tests/integration/setup.ts`
- Modify: `tests/integration/auth-migrations.test.ts`
- Modify: `tests/integration/recovery-routes.test.ts`
- Modify: `tests/e2e/start-auth-api.ts`
- Modify: `tests/e2e/auth-real-stack.spec.ts`
- Modify: `vitest.integration.config.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- `TEST_DATABASE_URL` is the test app role; remote `TEST_MIGRATOR_DATABASE_URL` is required for migrations and migration-specific schema DDL.
- Local ephemeral mode sets both URLs to the disposable local role and preserves the current lifecycle.
- Remote mode validates the active loopback SSH forward and pinned host fingerprint, runs read-only DB identity/schema preflight for both roles, then starts tests only when the exact mutation gate is present.
- Remote mode never drops/recreates a database/schema. Migration tests may drop only a schema whose name they generated from a fixed prefix plus a cryptographically random identifier.

- [x] Add regression assertions for remote E2E and migration URL selection, exact-schema cleanup, and removal of unfiltered table deletion.
- [x] Verify RED, adapt runner/startup/setup while preserving coverage, then verify GREEN locally without remote access.
- [x] Keep integration and Playwright workers at one and set finite suite/hook/query/lock limits.

### Task 4: Provisioning Plan and Review Evidence

**Files:**
- Modify: `docs/operations/INFRA-001_POSTGRES_PLAN.md`
- Modify: `docs/operations/TASK_BOARD.md`
- Modify: `docs/operations/WORKLOG.md`

- [x] Present exact SQL for permanent and test databases, four least-privilege roles, database-local grants, PUBLIC ACL review, preconditions, no-interference checks and rollback.
- [x] Keep `INFRA-001` blocked because authenticated read-only inventory is unavailable; do not execute the SQL.
- [x] Record test results, skipped external tests, open risks, next approval gate and current task states.

### Task 5: Verification and Handoff

**Files:**
- Review: full working-tree diff, secret scan, migration scope and test cleanup paths.

- [x] Run focused unit tests, full unit suite with one worker and bounded heap, format, lint, typecheck, build, security checks and Drizzle consistency checks.
- [x] Report PostgreSQL integration/E2E as `NO EJECUTADO` unless run after approved provisioning; do not call them PASS based on local simulations.
- [x] Leave PS-003 `EN_REVISION`, PS-003.1 blocked until remote PostgreSQL/migrate-cli/E2E evidence is available, and INFRA-001 blocked until inventory/approval gates are satisfied.

## Self-Review

- Coverage includes remote URL validation, distinct app/migrator identities, preflight, bounded execution, isolated cleanup, test persistence across runs, security checks and the approval gate for provisioning.
- The plan does not authorize SSH, PostgreSQL, migration, CI publishing, PR, merge or deployment writes.
- The only cross-task decision is the proposed names/roles, which remain subject to approval in the exact INFRA-001 SQL plan before creation.

## Addendum de ejecución autorizada · 2026-11-19

La autorización posterior del propietario reemplazó las identidades de runner redactadas en esta propuesta con `portal_test_app` y `portal_test_migrator`, y autorizó el uso de las bases `portal_soporte` y `portal_soporte_test`. El código vigente y los preflights usan los nombres aprobados; las menciones previas a `portal_test_runner` describen la propuesta histórica, no una cuenta creada. El inventario y aprovisionamiento se realizaron solo después de aprobación expresa. Las suites remotas ahora pasan con la base exacta `portal_soporte_test`; la base permanente no se usó para pruebas destructivas.

El permiso temporal `CREATE ON DATABASE portal_soporte` fue aprobado aparte, aplicado exclusivamente para las migraciones versionadas del Portal y revocado al terminar. Ningún cambio a otras bases, roles, ACL de `PUBLIC`, servicios o configuración global es parte de esta autorización.

PS-003.2 reejecutó las pruebas unitarias (213/213), integración (53/53), CLI de migraciones y E2E (8/8), todas remotas contra la base aislada de pruebas, además de los gates locales. La propuesta no autoriza cambiar DNS/túneles, desplegar públicamente, hacer push/merge ni iniciar PS-004, PS-005 o RF-1.
