# PS-005.3 / PS-007 Client Access and RF-1 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce persistent user-client assignment and per-client capabilities on every request, then provide typed read-only RF-1 preview through the existing broker architecture.

**Architecture:** Add migration 0007 and small static capability contracts, a PostgreSQL repository/application service, explicit ADMIN and SUPPORT routes, and a broker session exposing only three fixed RF-1 reads. Authorize before opening/decrypting a profile; use the existing pure `modules/rf-1` domain preview.

**Tech Stack:** TypeScript strict, PostgreSQL 15/Drizzle, Fastify, mysql2 prepared statements, Vitest, PGlite for quick simulations, isolated PostgreSQL/MySQL fixtures.

**Spec:** `docs/superpowers/specs/2026-11-21-ps0053-rf1-client-access-design.md`, `docs/product/DECISIONS_APPROVED.md` AP-014, `docs/specs/RF-1_LOOKUP_RULES.md`, `docs/specs/RF-1_FIELD_MAPPING.md`.

## Global Constraints

- Persist only `rf-1:read` and `rf-1:execute` as allowlisted IDs; absent rows mean disabled; this delivery never implements `rf-1:execute`.
- Only active SUPPORT accounts can receive assignments; ADMIN has global administrative scope but RF-1 operations still require an active client and enabled `rf-1:read` capability.
- Each RF-1 request checks active session, current role/status, active client, enabled capability, and profile ownership/status using current PostgreSQL state; SUPPORT also requires a current assignment. `rf-1:execute` is permanently disabled and unavailable in this delivery.
- Every mutation uses CSRF and writes audit metadata in the same PostgreSQL transaction; no secrets/XML/SQL are audited.
- MySQL SQL is fixed, parameterized, bounded, and private to the connector; no caller-supplied SQL, host, database, table, or column.
- No customer MySQL/SSH connections, production `portal_soporte` migration, invoice INSERT, or persistent customer writes.

## Review Focus

- Concurrent duplicate grant/revoke/capability update: DB constraints and transactions preserve one active assignment and audit only successful changes (Tasks 1–3).
- Revoked assignment/capability with same live session: next request is 403 before opening broker (Tasks 2–3).
- Foreign client/profile/environment IDs: no resource details or broker access are exposed (Tasks 3–5).
- SQL injection-shaped RFC/UUID values and duplicate SAP rows: prepared queries preserve lookup semantics and block ambiguity (Task 4).
- Truncated, malformed, oversized, too-numerous, or slowly delivered upload: bounded parser settles and leaks no files/sessions (Task 5).

### Task 1: Add additive migration and PostgreSQL schema

**Files:**
- Create: `apps/api/drizzle/0007_client_user_access_capabilities.sql` and matching generated snapshot under `apps/api/drizzle/meta/`.
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/db/test-database-preflight.ts`.
- Create: `tests/support/client-access-migration-fixture.ts`, `tests/unit/client-access-migration.test.ts`, `tests/integration/client-access-migrations.test.ts`.

**Interfaces:**
- `client_user_assignments`: UUID, `client_id`, `user_id`, granting/revoking actor and timestamps; active-pair partial unique index; consistent nullable revoke metadata; FKs `ON DELETE RESTRICT`.
- `client_capabilities`: `(client_id, capability_id)` key, explicit `enabled`, actor and changed timestamp; application plus DB allowlist for known IDs.
- No changes to migration files 0004–0006.

- [x] **Step 1: Write failing PGlite tests** for applying 0000–0007, FK restrictions, duplicate active grant, revoke/regrant, capability default, invalid capability, and consistent actor/timestamp pairs.
- [x] **Step 2: Run `corepack pnpm@12.21.0 exec vitest run --maxWorkers=2 --no-file-parallelism tests/unit/client-access-migration.test.ts`.** Expected: FAIL because migration 0007 is absent.
- [x] **Step 3: Add migration 0007 and matching Drizzle schema.** Keep migrations 0004–0006 byte-identical; use DB constraints for concurrency invariants.
- [x] **Step 4: Extend test preflight's exact expected table/index/constraint and least-privilege assertions.** Preserve its exact test DB/role/identity check.
- [x] **Step 5: Run PGlite and real PostgreSQL migration verification.** Commands: focused migration tests above, then `corepack pnpm@12.21.0 run test:migrate-cli:remote`. Expected: migration applies only to `portal_soporte_test`; `portal_soporte` remains untouched.
- [x] **Step 6: Commit migration/schema increment** as `feat(db): PS-005.3 persist client assignments and capabilities`.

### Task 2: Add typed access ports and application service

**Files:**
- Create: `packages/core/src/clients/client-access-ports.ts`, `apps/api/src/clients/client-access-service.ts`, `tests/unit/client-access-service.test.ts`.
- Modify: `packages/core/src/index.ts` or existing client exports, `packages/contracts/src/clients.ts`, `packages/contracts/src/index.ts`.

**Interfaces:**
- `type CapacidadCliente = 'rf-1:read' | 'rf-1:execute'`.
- `ServicioAccesoCliente.listarClientes(actor: ActorAccesoCliente): Promise<readonly ClienteAccesible[]>`.
- `ServicioAccesoCliente.listarAsignaciones(clientId: string): Promise<readonly AsignacionClienteUsuario[]>`.
- `conceder(clientId: string, userId: string, actor: ActorAdministracionClientes): Promise<void>`; `revocar(...)`; `establecerCapacidad(clientId: string, capability: CapacidadCliente, enabled: boolean, actor: ActorAdministracionClientes): Promise<void>`.
- `exigir(actor: ActorAccesoCliente, clientId: string, capability: CapacidadCliente): Promise<void>` re-queries current state; unauthorized SUPPORT yields `ErrorAccesoCliente('CLIENT_ACCESS_DENIED', 403)`.

- [x] **Step 1: Write service unit tests** for ADMIN global administration plus RF-1 client/capability requirements, authorized SUPPORT, absent/revoked assignment, disabled capability, inactive user/client, rejected `rf-1:execute`, unknown capability, and re-grant after revoke.
- [x] **Step 2: Run focused test and confirm red:** `corepack pnpm@12.21.0 exec vitest run --maxWorkers=2 --no-file-parallelism tests/unit/client-access-service.test.ts`.
- [x] **Step 3: Add Spanish-documented ports, DTO schemas, static capability allowlist, and controlled errors.** Unknown IDs fail closed.
- [x] **Step 4: Implement service over repository port.** Do not store client grants/caps in session or long-lived cache.
- [x] **Step 5: Run focused tests and `corepack pnpm@12.21.0 --filter @portal-soporte/api run typecheck`.** Expected: core decisions are testable without database runtime.
- [x] **Step 6: Commit core/application increment** as `feat(core): PS-005.3 add client capability guard`.

### Task 3: Add PostgreSQL repository and authorized routes

**Files:**
- Create: `apps/api/src/clients/postgres-client-access-repository.ts`, `apps/api/src/routes/client-access-routes.ts`, `tests/integration/client-access-routes.test.ts`.
- Modify: `apps/api/src/runtime.ts`, `apps/api/src/server.ts`, `apps/api/src/clients/postgres-connection-profile-repository.ts`, `scripts/with-test-postgres.ts` role grants only for newly created Portal tables.

**Interfaces:**
- ADMIN: `GET /api/v1/admin/clients/:clientId/access`; `PUT /api/v1/admin/clients/:clientId/access/users/:userId`; `DELETE` that URI; `PUT /api/v1/admin/clients/:clientId/capabilities/:capabilityId` with `{ enabled: boolean }`.
- SUPPORT: `GET /api/v1/clients` returns current assigned active clients; nested SAP environment/profile GETs require assignment and return redacted DTOs.
- ADMIN assignment DTO includes only support user ID, display name, active state, and grant/revoke timestamps.

- [x] **Step 1: Write failing PostgreSQL integration tests** for all routes, role 403s, CSRF, atomic audit, duplicate grant, foreign IDs, and same-cookie 403 immediately after revoke.
- [x] **Step 2: Run `corepack pnpm@12.21.0 run test:integration:remote`.** Expected: tests fail before repository/routes.
- [x] **Step 3: Implement transaction-based repository with conditional writes and safe conflict behavior.** Audit metadata is explicit allowlist and commits/rolls back with the mutation.
- [x] **Step 4: Register routes with authenticated-session guards.** ADMIN writes require ADMIN and CSRF; SUPPORT reads call `ServicioAccesoCliente.exigir` before querying profiles/environments. Use the same 403 body for all client-scope denials.
- [x] **Step 5: Rerun remote integration tests.** Expected: revoke takes effect on the next request without logout; foreign profile response is 403 and no profile envelope is selected.
- [x] **Step 6: Commit access API increment** as `feat(api): PS-005.3 enforce per-client access`.

### Task 4: Add fixed RF-1 reads to ClientConnectionBroker

**Files:**
- Modify: `packages/core/src/clients/secret-custody-ports.ts`, `packages/connectors/src/mysql-connection-broker.ts`, `packages/connectors/src/mysql2-ssh-factories.ts`, `apps/api/src/clients/connection-profile-service.ts`, `apps/api/src/clients/connection-runtime-config.ts`.
- Create: `apps/api/src/clients/mysql-rf1-catalog.ts`, `tests/unit/mysql-rf1-catalog.test.ts`, `tests/fixtures/mysql-rf1/schema.sql`, `tests/fixtures/mysql-rf1/seed.sql`.
- Modify: `scripts/with-mysql-fixture.sh`, `tests/mysql-fixture/mysql-connector-real.test.ts`.

**Interfaces:**
- `SesionLecturaRf1.buscarSociedadesPorRfc(rfcReceptor: string): Promise<readonly SociedadCatalogoRf1[]>`.
- `buscarProveedoresPorContexto(rfcEmisor: string, sociedad: string, ambienteSap: string): Promise<readonly { readonly idProveedor: string }[]>`.
- `existeUuid(uuid: string): Promise<boolean>` and `cerrar(): Promise<void>`.
- `ClientConnectionBroker.abrirLecturaRf1(perfil: PerfilConexionPrueba, secretos: Uint8Array, senal: AbortSignal): Promise<SesionLecturaRf1>`; no generic query method.

- [ ] **Step 1: Write failing tests** pinning query text and parameter order for society, contextual provider and UUID lookups; include SQL-injection-shaped values and 0/1/2+ matches.
- [ ] **Step 2: Run `corepack pnpm@12.21.0 exec vitest run --maxWorkers=2 --no-file-parallelism tests/unit/mysql-rf1-catalog.test.ts tests/unit/mysql-connection-broker.test.ts`.** Expected: RF-1 connector cases fail.
- [ ] **Step 3: Implement fixed prepared `execute()` statements** with static identifiers, result limits, timeout/abort, one connection and `finally` cleanup; no `marcado_borrado` or `contabilizar` filter.
- [ ] **Step 4: Extend ephemeral fixture with only synthetic society/provider/invoice rows.** Include multiple society/environment, same RFC across distinct contexts, ambiguous same-context provider, and existing/missing UUID cases.
- [ ] **Step 5: Run `corepack pnpm@12.21.0 run test:mysql-fixture`.** Expected: synthetic TCP/TLS and SSH paths pass; no external/customer destination is contacted.
- [ ] **Step 6: Commit connector increment** as `feat(connectors): PS-007 add typed read-only RF-1 lookups`.

### Task 5: Add bounded multipart preview endpoint

**Files:**
- Add `@fastify/multipart` to `apps/api/package.json` and `pnpm-lock.yaml` at exact `10.1.9` or later version confirmed patched by `check:dependencies:ci`.
- Create: `apps/api/src/clients/rf1-preview-service.ts`, `apps/api/src/routes/rf1-preview-routes.ts`, `tests/integration/rf1-preview-routes.test.ts`.
- Modify: `apps/api/src/server.ts`, `apps/api/src/runtime.ts`, `packages/contracts/src/clients.ts`, shared synthetic E2E API fixture as required.

**Interfaces:**
- `POST /api/v1/clients/:clientId/modules/rf-1/preview?profileId=<uuid>&estatus=<enum>` consumes multipart parts named exactly `files` and returns per-file safe preview results.
- Route validates session, client UUID, active client, role, assignment/capability, profile ownership/status **before opening the broker or processing XML**.
- Parser limits: `files=100`, `fields=0`, `parts=100`, `fileSize=5 MiB`, plus application byte counter `<=25 MiB`; filenames are ignored and no temporary disk files are used.

- [ ] **Step 1: Write failing route tests** for ADMIN/authorized SUPPORT preview, anonymous 401, unassigned/foreign-profile SUPPORT 403 before broker call, disabled `rf-1:read`, malformed XML, 101 files, 5 MiB+1 file, aggregate 25 MiB+1, malformed/truncated multipart, duplicate UUID, catalog failure, audit redaction, and zero DML.
- [ ] **Step 2: Run `corepack pnpm@12.21.0 run test:integration:remote`.** Expected: route cases fail because endpoint is absent.
- [ ] **Step 3: Add TypeBox query/param schemas and `request.parts()` parsing.** Fully consume or abort each stream on all branches, use only bounded memory, enforce a request deadline, and return controlled errors without driver stack/details.
- [ ] **Step 4: Implement `ServicioVistaPreviaRf1`** so authorization precedes profile secret retrieval; call existing `generarVistaPreviaLote`, close session in `finally`, zero decrypted buffers, and audit only client/profile IDs, counts, result codes, and request ID.
- [ ] **Step 5: Use `@fastify/multipart` 10.1.9 or later and never call `saveRequestFiles()`.** Explicitly enforce aggregate bytes because multipart parsing bypasses Fastify aggregate `bodyLimit`; add regression tests for truncated/aborted streams and no temp-file leak.
- [ ] **Step 6: Run focused integration tests, then `corepack pnpm@12.21.0 run test:e2e:remote`.** Expected: all preview flows pass, malformed requests finish within timeout, no DML occurs, and fixture resources are cleaned.
- [ ] **Step 7: Commit preview API increment** as `feat(api): PS-007 add safe RF-1 preview endpoint`.

## Security References

- Official multipart advisory: arbitrary file write fixed in 10.1.9, https://github.com/fastify/fastify-multipart/security/advisories/GHSA-gmhr-r4mc-w935.
- Official upload DoS advisories: https://github.com/fastify/fastify-multipart/security/advisories/GHSA-vmph-573x-85f6 and https://github.com/fastify/fastify-multipart/security/advisories/GHSA-r9rg-mfh6-f225.
- Official README documents explicit file/parts limits and that `bodyLimit` is not an aggregate multipart limit: https://github.com/fastify/fastify-multipart.
