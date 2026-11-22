# PS-005.3 Keyring and Synthetic Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable versioned secret custody only after recovery is proven, and verify MySQL TCP/TLS and SSH/PEM paths solely against synthetic infrastructure.

**Architecture:** Reuse `ProveedorClavesMaestrasArchivo` and the AES-GCM envelope service. Keep the key file outside the repository and PostgreSQL, with a separately encrypted recovery copy. Never open client profiles against real destinations.

**Tech Stack:** Node 24, TypeScript, AES-256-GCM, GPG AES-256, systemd-managed Portal services, Vitest, existing Docker MySQL/SSH fixture.

**Spec:** `docs/superpowers/specs/2026-11-21-ps0053-rf1-client-access-design.md`, `docs/architecture/ADR-0002_CUSTODIA_SECRETOS.md`, `docs/operations/KEYRING_RECOVERY.md`.

## Global Constraints

- Master keys are 32 CSPRNG bytes; key file is `root:<service-group>` mode `0640` in a `root:<service-group>` directory mode `0750`, regular files only, no symlinks.
- Recovery material is encrypted separately from the server; its passphrase is captured interactively and held by the owner separately.
- Do not print key bytes, envelope contents, recovery passphrases, connection secrets, or their hashes.
- Do not recreate or rotate any key while an envelope references an unknown version.
- Synthetic MySQL/SSH fixture runs `SELECT 1` only and cleans only resources created by its own run.

## Review Focus

- Existing keyring/profile state differs from the expected empty state: preflight must stop without reading/printing secret payloads (Task 1).
- Keyring owner/group/mode/link mismatch: existing provider rejects with `KEYRING_UNSAFE` (Task 2).
- Recovery passphrase is wrong or archive altered: restore comparison fails without enabling runtime (Task 2).
- Restart affects only the two Portal units (Task 3).
- Wrong synthetic SSH fingerprint/TLS CA/destination or timeout: fixed error is reported and resources close (Task 4).

### Task 1: Preflight keyring and profile envelopes

**Files:**
- Read: `docs/operations/KEYRING_RECOVERY.md`, `apps/api/src/clients/connection-runtime-config.ts`, `apps/api/src/clients/postgres-connection-profile-repository.ts`.
- Update after execution: `docs/operations/KEYRING_RECOVERY.md`, `docs/operations/WORKLOG.md`, `docs/operations/TASK_BOARD.md`.

**Interfaces:**
- Consumes: `PORTAL_MASTER_KEYRING_PATH`, `PORTAL_MASTER_KEYRING_GID`, and `client_connection_profiles.secret_envelope` metadata.
- Produces: Redacted result with keyring presence/safe file metadata, aggregate profile count, and distinct non-secret key IDs only.

- [ ] **Step 1: Inspect the exact configured keyring path and `stat` metadata read-only.** Query only profile count and distinct `secret_envelope->>'idClave'`; never select or print full envelope JSON.
- [ ] **Step 2: Compare versions and permissions.** If any envelope references a missing version or metadata violates ADR-0002, log a blocking result and do not provision, replace, or activate a key.
- [ ] **Step 3: Verify the report contains no key/envelope bytes, credential, DSN, or hashes.** Expected result is either a reconciled version set or an explicit fail-closed stop.

### Task 2: Provision and prove the independent recovery copy

**Files:**
- Update: `docs/operations/KEYRING_RECOVERY.md` only with paths, key version IDs, custody locations, and non-secret outcomes.
- Verify: `packages/connectors/src/master-keyring-provider.ts`, `packages/connectors/src/secret-envelope.ts`, `tests/unit/client-master-keyring.test.ts`, `tests/unit/client-secret-envelope.test.ts`.

**Interfaces:**
- Consumes: `ProveedorClavesMaestrasArchivo.obtenerActiva()`, `.obtener(id)`, and `ServicioCifradoSecretos`.
- Produces: Protected keyring file and encrypted off-host recovery artifact; no secret value is emitted.

- [ ] **Step 1: Add a failing test only if existing tests lack restored-keyring version resolution or AAD mismatch rejection.** Pin the expected code and assert no key material in the error.
- [ ] **Step 2: Run `corepack pnpm@12.21.0 exec vitest run --maxWorkers=2 --no-file-parallelism tests/unit/client-master-keyring.test.ts tests/unit/client-secret-envelope.test.ts`.** Expected: any newly added regression fails before a fix.
- [ ] **Step 3: After Task 1 passes, generate a versioned 32-byte key directly to the protected target with CSPRNG and exclusive create, preserving any existing versions.** Encrypt an independent recovery copy using GPG AES-256 with an interactive passphrase prompt; never passphrase in argv/environment.
- [ ] **Step 4: Restore to a unique restrictive temporary directory.** Compare bytes silently, validate restored permissions using the provider, encrypt/decrypt a synthetic envelope with the same context, and verify a different context fails. Remove only this exact temporary directory.
- [ ] **Step 5: Rerun the focused tests.** Expected: PASS with no key, envelope, passphrase, or hash in output.

### Task 3: Enable runtime keyring with a scoped restart

**Files:**
- Operational config: existing protected Portal environment file/systemd override discovered during preflight.
- Update: `docs/operations/DEPLOYMENT_DEBIAN.md`, `docs/operations/WORKLOG.md`, `docs/operations/TASK_BOARD.md`.

**Interfaces:**
- Consumes: Verified keyring path/GID from Task 2 and `cargarRuntimePerfilesConexion()`.
- Produces: Running API runtime with `custodia !== null`; no change to destinations or other services.

- [ ] **Step 1: Add only `PORTAL_MASTER_KEYRING_PATH` and `PORTAL_MASTER_KEYRING_GID` to protected API runtime configuration.** Back up the exact current file and keep its permissions.
- [ ] **Step 2: Restart only `portal-soporte-api.service` and `portal-soporte-web.service` by exact unit name.** Record active state and restart counts.
- [ ] **Step 3: Verify startup, Portal health, and synthetic envelope encrypt/decrypt.** Expected: both own units active, no customer profile opened, no secret in logs.
- [ ] **Step 4: Exercise rollback using the exact config backup.** Restore the prior environment, restart only those units, and verify custody returns to disabled without changing key files or envelopes.

### Task 4: Run TCP/TLS and SSH/PEM connector fixture

**Files:**
- Verify: `scripts/with-mysql-fixture.sh`, `tests/mysql-fixture/mysql-connector-real.test.ts`, `tests/fixtures/mysql-ssh-gateway/entrypoint.sh`.
- Modify only if a concrete fixture defect is reproduced.

**Interfaces:**
- Consumes: Existing broker `probar(perfil, secretos)` fixed to `SELECT 1`.
- Produces: Results against per-run ephemeral Docker MySQL/SSH/TLS; zero customer DB traffic.

- [ ] **Step 1: Run `corepack pnpm@12.21.0 run test:mysql-fixture`.** Expected: TCP/TLS and SSH/PEM pass; wrong CA/fingerprint/destination and timeout fail closed; this run's containers/network/temp files are cleaned.
- [ ] **Step 2: Record exact test counts/outcome.** If Docker, puttygen, or fixture is unavailable, report `NO EJECUTADO` and proceed only with unaffected work.
