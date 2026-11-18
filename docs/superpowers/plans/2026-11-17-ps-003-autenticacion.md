# PS-003 Authentication and User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved PS-003 authentication core, user administration, sessions, recovery, audit, and login UI, leaving the task `EN_REVISION`.

**Architecture:** Keep runtime contracts in `packages/contracts`, pure identity policies and ports in `packages/core`, PostgreSQL/Argon2id/SMTP adapters and Fastify routes in `apps/api`, and same-origin Next.js pages/proxy behavior in `apps/web`. Store opaque session and one-use token hashes in PostgreSQL; require server-side role checks, CSRF validation on all writes, and explicit trusted-proxy configuration.

**Tech Stack:** TypeScript strict, Fastify 5, Next.js 16, TypeBox, Drizzle ORM/Kit with PostgreSQL, Argon2id, Nodemailer, Vitest, PGlite simulations, real isolated PostgreSQL integration, and Playwright browser checks.

**Spec:** `docs/superpowers/specs/2026-11-17-ps-003-autenticacion-diseno.md`

## Global Constraints

- Login identifier is only normalized `username`; recovery uses normalized email.
- Roles are exactly `ADMIN` and `SUPPORT`; statuses are `PENDING_ACTIVATION`, `ACTIVE`, and `DISABLED`.
- Argon2id baseline: 19 MiB memory, 2 iterations, parallelism 1; passwords accept 15–128 Unicode code points without trimming or truncation.
- Session idle expiration is 30 minutes and absolute expiration is 8 hours; session tokens contain 32 random bytes and only SHA-256 hashes are stored.
- Recovery, activation, and email-change tokens contain 32 random bytes, expire after 30 minutes, are one-use, and are stored as hashes only.
- `PUBLIC_APP_ORIGIN` is canonical and is the sole origin for CSRF and email links; browser API calls use same-origin `/api/v1/*` and a server-side proxy to `API_INTERNAL_ORIGIN`.
- All writes require a CSRF cookie/header pair, an exact matching `Origin`, and `Sec-Fetch-Site: same-origin` when that header is present.
- Fastify trusts no proxy by default; trusted proxies must be explicit IP/CIDR values, never `true`, hop counts, or wildcards.
- All active-admin membership changes and initial bootstrap lock `auth_invariants(id=1)` with `SELECT FOR UPDATE` inside `READ COMMITTED` transactions.
- Run integration tests only against a disposable local PostgreSQL process/database with synthetic records; never connect to client or production databases.
- Use strict TypeScript and runtime input/output validation; do not use `any` to bypass contracts.
- Keep passwords, tokens, cookies, SMTP credentials, DSNs with passwords, and real personal data out of code, tests, logs, screenshots, and Git.
- No public registration, dashboard, client connections, RF-1, PS-004, deployment, tunnel, or production configuration.
- Document functions, classes, methods, components, endpoints, and exported contracts in Spanish with JSDoc/TSDoc.
- Preserve existing CI, formatting, lint, typecheck, test, build, secret scan, dependency audit and the temporary dev-only picomatch exception; review 2026-12-10 UTC, acceptance expires 2026-12-17 UTC.
- Before UI work, read `.agents/skills/apple-design/SKILL.md`; record its criteria and visual/accessibility evidence in `docs/operations/WORKLOG.md`.

## Review Focus

- Untrusted `Host` and forwarded headers cannot alter generated reset links, client IP decisions, or the target CSRF origin; add spoofing tests to Task 4.
- Concurrent requests cannot demote/deactivate the final active admin or create more than one initial admin; add real PostgreSQL race tests to Task 5.
- Recovery, invitation, and email-change tokens cannot be replayed, expired, logged, returned, or exposed through query strings/referrers; add tests to Task 6.
- Unicode and whitespace passwords retain exact bytes/code points, and voluntary changes fail without the current password; add tests to Tasks 1 and 3.
- Cross-origin, missing-Origin, invalid-cookie/header, `Origin: null`, and cross-site writes fail before handlers, including login/recovery; add tests to Task 4.

---

### Task 1: Authentication contracts and pure identity policies

**Files:**
- Create: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/core/src/auth/models.ts`
- Create: `packages/core/src/auth/policies.ts`
- Modify: `packages/core/src/index.ts`
- Test: `tests/auth-policies.test.ts`
- Test: `tests/auth-contracts.test.ts`

**Interfaces:**
- Produces `RolUsuario`, `EstadoUsuario`, `SolicitudLogin`, `SolicitudCambioContrasena`, `RespuestaUsuarioPublico`, `RespuestaUsuarioAdmin`, and TypeBox schemas for every request/response used by Tasks 3–7.
- Produces `normalizarUsuario(valor: string): string`, `normalizarCorreo(valor: string): string`, `contarPuntosCodigo(texto: string): number`, and `validarNuevaContrasena(valor: string): ResultadoValidacionContrasena`.
- Username normalization accepts only ASCII letters, digits, `.`, `_`, `-`, 3–64 characters, trims and lowercases. Email trims and lowercases. Password validation counts Unicode code points, requires 15–128, and does not trim or truncate.

- [x] **Step 1: Write failing unit tests** for the username/email rules, Unicode code-point length, preserved whitespace, password boundaries, role/status values, and strict rejection of unknown request properties.
- [x] **Step 2: Run `corepack pnpm@12.21.0 exec vitest run tests/auth-policies.test.ts tests/auth-contracts.test.ts`; Expected:** FAIL because the policies/contracts do not exist.
- [x] **Step 3: Implement the contracts and pure policies** with stable Spanish validation errors and TSDoc on every exported declaration.
- [x] **Step 4: Re-run the focused test and `corepack pnpm@12.21.0 test`; Expected:** the focused cases and existing repository tests pass.
- [x] **Step 5: Commit** as `feat(auth): PS-003 agregar contratos y políticas de identidad` with this task's WORKLOG entry.

### Task 2: PostgreSQL schema, migrations, and isolated test foundations

**Files:**
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/migrate.ts`
- Create: `apps/api/drizzle/0000_auth_core.sql`, `apps/api/drizzle/0001_auth_throttle_expiry.sql`
- Create: `apps/api/drizzle/meta/_journal.json`
- Create: `apps/api/drizzle/meta/0000_snapshot.json`
- Create: `drizzle.config.ts`
- Create: `vitest.integration.config.ts`
- Create: `scripts/with-test-postgres.ts`
- Modify: root and API `package.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`
- Create: `tests/integration/auth-migrations.test.ts`
- Create: `tests/unit/auth-schema-pglite.test.ts`
- Create: `tests/unit/auth-db-client.test.ts`, `tests/support/auth-migration-fixture.ts`
- Modify: `scripts/check-dependency-audit.mjs`, its unit tests and `docs/operations/DEPENDENCY_SECURITY.md` to preserve the approved picomatch exception with current pnpm summary semantics.
- Modify: `.prettierignore` and `tsconfig.tests.json` so generated SQL is managed by Drizzle and all tests/helpers are strict-typechecked.

**Interfaces:**
- Produces Drizzle tables `users`, `sessions`, `recoveryTokens`, `authThrottleWindows`, `auditEvents`, and `authInvariants`.
- `authInvariants` has one seeded `id=1` row. `users` includes nullable `emailVerifiedAt`; unique normalized username/email, valid enum/check constraints, foreign keys, token-hash uniqueness, expiry indexes, and audit indexes are versioned in migrations 0000–0001.
- Produces a bounded PostgreSQL pool factory that reads DB settings from environment and rejects non-local/test database settings in test mode.
- PGlite tests cover schema/query simulation only; they do not assert row-lock, race, or PostgreSQL server behavior. `scripts/with-test-postgres.ts` creates a disposable local cluster and `portal_ps003_test` database, runs the selected integration/E2E command, then shuts down and removes only its own temporary directory.

- [x] **Step 1: Write failing PGlite schema tests and real PostgreSQL migration tests** for constraints, nullable pending passwords, uniqueness, one seeded invariant row, clean application from an empty cluster, and migration journal behavior.
- [x] **Step 2: Run the focused tests; Expected:** fail because the schema, migration, and DB setup are absent.
- [x] **Step 3: Add Drizzle/PostgreSQL/PGlite dependencies and implement the schema/migration/client.** Use parametrized ORM queries and a test harness that points only to an ephemeral localhost PostgreSQL cluster/database.
- [x] **Step 4: Run PGlite tests and PostgreSQL integration tests; Expected:** schema checks pass on PGlite and migration/constraint checks pass on the real server.
- [x] **Step 5: Commit** as `feat(auth-db): PS-003 crear esquema de identidad` with migration evidence in WORKLOG.

### Task 3: Password hashing, tokens, sessions, and application ports

**Files:**
- Create: `packages/core/src/auth/ports.ts`
- Create: `apps/api/src/auth/argon2-password-hasher.ts`
- Create: `apps/api/src/auth/token-service.ts`
- Create: `apps/api/src/auth/session-service.ts`
- Create: `apps/api/src/auth/auth-service.ts`
- Create: `apps/api/src/auth/postgres-auth-repository.ts`
- Test: `tests/unit/password-hasher.test.ts`
- Test: `tests/unit/session-service.test.ts`
- Test: `tests/integration/session-repository.test.ts`

**Interfaces:**
- Produces `PasswordHasher` (`hash`, `verify`), `AuthClock`, `AuthMailer`, `AuthAuditWriter`, and `AuthRepository` ports with TSDoc in Spanish.
- Produces `crearTokenOpaco(): TokenOpaco` (32 random bytes, base64url value plus SHA-256 digest), `crearAuthService(dependencias): AuthService`, and session methods `crear`, `resolverVigente`, `revocar`, and `revocarTodasMenos`.
- Session validity checks the current account status/role, `lastUsedAt + 30 minutes`, absolute expiry at `createdAt + 8 hours`, and revocation in PostgreSQL on every protected request.

- [ ] **Step 1: Write failing tests** for Argon2id parameters, unique salts, incorrect-password rejection, 32-byte opaque tokens, session idle/absolute expiry, revocation, current role lookup, and secret-free repository results.
- [ ] **Step 2: Run focused tests; Expected:** FAIL because hash/token/session services are absent.
- [ ] **Step 3: Implement the minimal hasher, token generator, session service, ports, and repository.** Never persist raw session/token values. Provide a process-scoped dummy Argon2 hash for unknown usernames.
- [ ] **Step 4: Run focused tests and all unit/integration repository tests; Expected:** all pass against isolated PostgreSQL, with session expiry/revocation observed from independent requests.
- [ ] **Step 5: Commit** as `feat(auth): PS-003 agregar credenciales y sesiones seguras` with WORKLOG evidence.

### Task 4: API runtime, same-origin proxy, CSRF, proxy trust, login, and logout

**Files:**
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/plugins/cookies.ts`
- Create: `apps/api/src/plugins/csrf.ts`
- Create: `apps/api/src/plugins/authentication.ts`
- Create: `apps/api/src/routes/auth-routes.ts`
- Modify: `apps/api/src/index.ts`, `apps/api/package.json`
- Create: `apps/web/next.config.ts`
- Test: `tests/unit/security-config.test.ts`
- Test: `tests/integration/auth-routes.test.ts`

**Interfaces:**
- Produces `cargarConfiguracionAuth(entorno: NodeJS.ProcessEnv): ConfiguracionAuth`, validating canonical `PUBLIC_APP_ORIGIN`, private `API_INTERNAL_ORIGIN`, distinct production/development cookie names, loopback-only insecure development cookies, and explicit `TRUSTED_PROXY_CIDRS`.
- Produces `validarSolicitudEscritura(request): void`, global before route handlers: exact `Origin`, cookie/header CSRF double-submit with constant-time comparison, and same-origin Fetch Metadata when present. `GET /api/v1/auth/csrf` sets a non-cacheable CSRF cookie/value.
- Produces same-origin `POST /login`, `POST /logout`, `GET /me`; the web browser calls relative `/api/v1/*`, Next.js rewrites server-side to `API_INTERNAL_ORIGIN`, and Fastify never enables public CORS.
- Produces per-route redacted request logging and stable public errors without body/token leakage.

- [ ] **Step 1: Write failing config and API injection tests** for allowed loopback development, HTTPS production, rejected weak cookie/proxy config, exact Origin, CSRF cookie/header match, missing/null Origin, forged headers, cross-site Fetch Metadata, login enumeration, and successful login/logout.
- [ ] **Step 2: Run the focused tests; Expected:** FAIL because runtime, security hooks, and routes are absent.
- [ ] **Step 3: Implement configuration, cookie/CSRF/auth hooks, login/logout/me routes, and Next proxy rewrites.** Trust no proxy unless an explicit IP/CIDR matches the peer; never build links or target origin from request headers.
- [ ] **Step 4: Run focused tests; Expected:** untrusted or incomplete writes return 403 before route logic, invalid credentials share one response, and successful login rotates opaque session state.
- [ ] **Step 5: Commit** as `feat(auth-api): PS-003 implementar login y controles CSRF` with WORKLOG evidence.

### Task 5: User administration, authorization, audit, last-admin invariant, and bootstrap

**Files:**
- Create: `apps/api/src/auth/authorization.ts`
- Create: `apps/api/src/auth/admin-user-service.ts`
- Create: `apps/api/src/auth/bootstrap-admin.ts`
- Create: `apps/api/src/routes/admin-user-routes.ts`
- Modify: `apps/api/src/auth/postgres-auth-repository.ts`
- Test: `tests/integration/admin-user-routes.test.ts`
- Test: `tests/integration/admin-invariant-concurrency.test.ts`
- Test: `tests/unit/bootstrap-admin.test.ts`

**Interfaces:**
- Produces `requireRole(roles: readonly RolUsuario[]): FastifyPreHandler`, deny-by-default backend guard, and `AdminUserService` methods to list/create/update/deactivate/reset/revoke sessions.
- Produces `crearAdministradorInicial(entrada, terminal, repositorio): Promise<void>`; reads the password through a no-echo TTY prompt, never accepts it in process arguments, and serializes first-admin creation.
- All active-admin membership changes begin `READ COMMITTED`, lock `auth_invariants(id=1)` with `SELECT FOR UPDATE`, then re-count active admins in a later statement before commit.
- Audit event and account/session mutations are in the same transaction. `SUPPORT` gets audited 403 on every admin route; password hashes and secrets never enter user DTOs.

- [ ] **Step 1: Write failing API/real PostgreSQL tests** for ADMIN CRUD, SUPPORT 403, input validation, audit atomicity, final-admin demotion/deactivation rejection, concurrent opposing admin mutations, two simultaneous bootstrap invocations, and session revocation after role/status changes.
- [ ] **Step 2: Run focused tests; Expected:** FAIL because user routes and transaction guards do not exist.
- [ ] **Step 3: Implement authorization, application service, routes, audit repository, invariant lock, and no-echo initial bootstrap.** Fail closed if the singleton guard row is missing or locking/querying fails.
- [ ] **Step 4: Run focused tests and PostgreSQL race tests; Expected:** SUPPORT requests return 403; no execution leaves zero active admins; exactly one simultaneous bootstrap succeeds; audit and mutation commit or roll back together.
- [ ] **Step 5: Commit** as `feat(users): PS-003 administrar cuentas y roles` with WORKLOG evidence.

### Task 6: Recovery, invitations, verified email changes, SMTP, and throttling

**Files:**
- Create: `apps/api/src/auth/mailer.ts`
- Create: `apps/api/src/auth/recovery-service.ts`
- Create: `apps/api/src/routes/recovery-routes.ts`
- Modify: `apps/api/src/auth/postgres-auth-repository.ts`, auth contracts and user routes
- Test: `tests/unit/recovery-service.test.ts`
- Test: `tests/integration/recovery-routes.test.ts`

**Interfaces:**
- Produces mail adapter `sendLink({ recipient, purpose, configuredOrigin, token })` that does not log the recipient, message, URL, or token. SMTP is configuration-only; tests inject an in-memory fake.
- Produces request/complete operations for recovery, activation, and email verification/change. An unverified bootstrap admin can request verification of the same email after logging in; URLs are built only from canonical `PUBLIC_APP_ORIGIN` and put the token in `#token=...`, never a query string.
- Recovery responses are identical `202` responses for known/unknown users; unverified email cannot be used for recovery. The token is one-use, expires in 30 minutes, only its SHA-256 hash is persisted, and delivery failures return no account information.
- Voluntary password change requires `currentPassword`; voluntary email-change request also requires it. Admin-initiated email changes remain pending until the target address consumes the verification token.
- Attempt keys use HMAC of normalized username/email and the resolved peer address; thresholds are 5 per identifier/IP and 20 per IP per 15-minute window; never globally lock an account.

- [ ] **Step 1: Write failing tests** for enumeration-resistant responses, SMTP fake delivery, wrong-purpose/expired/replayed token rejection, token absence from response/audit/logs, fragment-only URLs, email unchanged before verification, verified email uniqueness, current-password requirement, and rate limiting.
- [ ] **Step 2: Run focused tests; Expected:** FAIL because recovery and email verification flows are absent.
- [ ] **Step 3: Implement SMTP adapter, token-purpose checks, HMAC throttle repository, transaction-bound token consumption, and routes.** Redact SMTP/auth payloads and send only after DB commit.
- [ ] **Step 4: Run focused tests and real PostgreSQL recovery integration; Expected:** only the correct unexpired token succeeds once; the DB contains hashes only; all unknown-account responses are identical.
- [ ] **Step 5: Commit** as `feat(auth-recovery): PS-003 habilitar recuperación segura` with WORKLOG evidence.

### Task 7: Login, recovery, password, and user-management UI

**Files:**
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/src/app/recover-access/page.tsx`
- Create: `apps/web/src/app/recover-access/complete/page.tsx`
- Create: `apps/web/src/app/profile/password/page.tsx`
- Create: `apps/web/src/app/settings/users/page.tsx`
- Create: focused components under `apps/web/src/components/auth/`
- Modify: `apps/web/src/app/page.tsx`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`
- Test: `tests/e2e/auth-flows.spec.ts`

**Interfaces:**
- Every page/component/hook and request helper has Spanish TSDoc. UI requests use relative same-origin paths, obtain CSRF token before any write, and never cache account/auth data.
- Login uses generic Spanish credential error, keyboard submit, accessible labels/focus/errors, system typography, restrained surfaces, responsive layout, system light/dark, and reduced motion.
- Recovery page removes `#token` from browser history immediately and sends it only in the body of the verified API `POST`; set `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and restrictive CSP without analytics/third-party assets.
- User management displays only admin-authorized fields and offers create, update, disable, reset-link, and revoke sessions; no dashboard route is added.

- [ ] **Step 1: Read `.agents/skills/apple-design/SKILL.md` immediately before UI work** and append its route, applied criteria, visual/accessibility checks, and any `NO EJECUTADO` items to `WORKLOG.md`.
- [ ] **Step 2: Write failing Playwright checks** for login validation/keyboard/focus, generic failures, recovery token cleanup, current password flow, ADMIN user management, and SUPPORT inability to see/use admin operations.
- [ ] **Step 3: Run focused UI checks; Expected:** FAIL because required routes/components are absent.
- [ ] **Step 4: Implement the responsive, accessible pages and minimal shared components** following the loaded skill and approved visual identity; do not add a dashboard.
- [ ] **Step 5: Run Playwright plus keyboard, responsive, light/dark, reduced-motion, and contrast checks; Expected:** required UI flows pass and every incomplete visual check is recorded accurately.
- [ ] **Step 6: Commit** as `feat(auth-ui): PS-003 implementar login y gestión de usuarios` with Apple Design evidence in WORKLOG.

### Task 8: CI, security hardening, full verification, and review handoff

**Files:**
- Modify: root and API `package.json`, `apps/api/tsconfig.json`, `apps/web/next.config.ts`, `.github/workflows/ci.yml`
- Create: `.env.example` with placeholders only, `docs/security/PS-003_AUTHENTICATION.md`
- Modify: `docs/operations/WORKLOG.md`, `docs/operations/TASK_BOARD.md`

**Interfaces:**
- Root scripts provide API build/typecheck, unit/PGlite tests, isolated PostgreSQL integration tests, and Playwright tests without removing existing format/lint/build/secret/dependency CI steps.
- `pnpm test` runs unit/PGlite tests, `pnpm test:integration` runs integration tests through `scripts/with-test-postgres.ts`, and `pnpm test:e2e` runs Playwright through the same disposable-cluster wrapper.
- CI installs PostgreSQL binaries directly on its disposable Ubuntu runner; it must not use a container/service image or connect to a shared database. Integration env uses only local socket/loopback and a dedicated `portal_ps003_test` database.
- Security readiness documentation preserves the open MFA-admin production gate, lack of live SMTP verification, picomatch advisory review/expiry, and no-production limits.

- [ ] **Step 1: Add failing script/config tests** for DB safety guards and CI step presence for integration, browser, typecheck, build, secrets, production audit, and the existing picomatch policy gate.
- [ ] **Step 2: Run the focused tests; Expected:** FAIL because new scripts and pipeline steps are absent.
- [ ] **Step 3: Implement minimal scripts, local PostgreSQL setup instructions, API compilation/build wiring, CI integration setup, and security documentation.** Keep all existing quality/security steps.
- [ ] **Step 4: Run the complete suite:** `corepack pnpm@12.21.0 install --frozen-lockfile`, `verify:skills`, `format:check`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `check:secrets`, production dependency audit, full dependency gate, and `git diff --check`.
- [ ] **Step 5: Review the full diff and scan for secrets, SQL interpolation, auth logging leaks, unguarded write routes, missing TSDoc, UI accessibility gaps, and any change outside scope.** Resolve Critical/Important findings with a test-first fix; log deferred minor findings explicitly.
- [ ] **Step 6: Append `ENTREGA A REVISIÓN` to WORKLOG and update only PS-003 to `EN_REVISION` in TASK_BOARD.** Report actual command outputs, real PostgreSQL version, visual limits, risks, and no-deployment boundary; do not start PS-004.
- [ ] **Step 7: Commit** as `feat(auth): PS-003 entregar núcleo en revisión`; do not push or deploy.
