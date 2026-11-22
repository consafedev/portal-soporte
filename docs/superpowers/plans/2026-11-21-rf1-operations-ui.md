# PS-008 RF-1 Operations UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let ADMIN assign/revoke SUPPORT access and configure per-client preview capability; let SUPPORT choose an authorized client/profile and run read-only RF-1 preview.

**Architecture:** Reuse the authenticated shell, current client-management patterns, typed contract schemas, and same-origin API helpers. Add one fixed RF-1 route/link, not a dynamic catalog; no invoice insertion action is rendered or implemented.

**Tech Stack:** Next.js App Router, React, strict TypeScript, existing CSS/design tokens, TypeBox contracts, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-ps0053-rf1-client-access-design.md`, `.agents/skills/apple-design/SKILL.md`, `docs/standards/CLEAN_CODE.md`.

## Global Constraints

- Before the first UI edit, read `.agents/skills/apple-design/SKILL.md` and log its applied criteria and visual/accessibility evidence in `docs/operations/WORKLOG.md`.
- ADMIN screens manage assignments and the per-client `rf-1:read` switch; `rf-1:execute` remains unavailable with no action.
- SUPPORT sees only redacted clients/profiles from authorized APIs; no secret, host, connection-auth, envelope, or SQL detail appears.
- Preview files stay in browser memory, limited to 100 XML, 5 MiB each, 25 MiB total; no XML is persisted or logged.
- Keep dashboard greeting clean; no charts, new global catalog, or unrelated PS-004 changes.

## Review Focus

- API returns no assigned clients: accessible empty state and no profile/preview actions (Task 2).
- Capability is revoked while a screen is open: next API operation fails closed and UI shows a safe permission state (Task 3).
- File list exceeds per-file, aggregate, or count limits: block before upload and announce the reason (Task 3).
- Keyboard-only person selects client, uploads XML, chooses society, and previews: stable labels/focus; drag/drop is not required (Tasks 2–3).
- Reduced-motion, dark/light theme, narrow viewport, and long RFC/result data do not hide actions or status (Task 4).

### Task 1: Add typed same-origin clients for access and preview

**Files:**
- Create: `apps/web/src/lib/client-access-api.ts`, `apps/web/src/lib/rf1-preview-api.ts`, `tests/unit/web-client-access-api.test.ts`, `tests/unit/web-rf1-preview-api.test.ts`.
- Modify: `apps/web/src/lib/client-admin-api.ts` only if existing CSRF/error helpers must be exported.

**Interfaces:**
- `listarClientesAutorizados(): Promise<readonly ClienteAccesibleContrato[]>`.
- `listarAsignacionesCliente(clientId: string): Promise<ResumenAccesoClienteContrato>`.
- `concederAccesoCliente(clientId: string, userId: string): Promise<void>`; `revocarAccesoCliente(...)`; `establecerCapacidadCliente(clientId: string, capability: CapacidadClienteContrato, enabled: boolean): Promise<void>`.
- `previsualizarRf1(clientId: string, profileId: string, estatus: EstatusRf1Contrato, files: readonly File[]): Promise<readonly VistaPreviaRf1Contrato[]>` uses same-origin multipart plus CSRF, no caching.

- [ ] **Step 1: Write failing tests** for exact URL/method, CSRF, multipart field names, schema validation, safe errors, and no filename/XML leakage.
- [ ] **Step 2: Run focused tests:** `corepack pnpm@12.21.0 exec vitest run --maxWorkers=2 --no-file-parallelism tests/unit/web-client-access-api.test.ts tests/unit/web-rf1-preview-api.test.ts`. Expected: missing client functions fail.
- [ ] **Step 3: Implement Spanish-documented API clients** following the current `client-admin-api.ts` same-origin patterns.
- [ ] **Step 4: Rerun focused unit tests and `corepack pnpm@12.21.0 --filter @portal-soporte/web run typecheck`.** Expected: all client contract/error cases pass.

### Task 2: Add ADMIN access management in existing client settings

**Files:**
- Modify: `apps/web/src/app/settings/clients/page.tsx`, `apps/web/src/components/clients/client-management.tsx`.
- Create: `apps/web/src/components/clients/client-access-management.tsx`, `tests/e2e/client-access-admin.spec.ts`.

**Interfaces:**
- `ClienteAccesoAdminProps` contains `clientId`, `onError`, `onSaved`; component loads eligible SUPPORT accounts and current assignment/capability state via typed API.
- Only SUPPORT users can be granted/revoked; each mutation confirms server state before showing success.

- [ ] **Step 1: Reread Apple Design before changing components.** Record the route, principles applied, keyboard/theme/responsive/reduced-motion checks in WORKLOG.
- [ ] **Step 2: Write failing E2E tests** for assign/revoke, `rf-1:read` toggle, loading/error/empty state, no secrets, and API 403 for SUPPORT on all admin routes.
- [ ] **Step 3: Implement a client-scoped access section** in current settings; do not add a general permissions catalog or show encrypted envelopes/destination auth details.
- [ ] **Step 4: Run the named Playwright spec against synthetic PostgreSQL user/client data.** Expected: ADMIN can assign, revoke, toggle; database audit follows API results.

### Task 3: Add the ADMIN/SUPPORT read-only preview screen

**Files:**
- Create: `apps/web/src/app/modules/rf-1/page.tsx`, `apps/web/src/components/rf-1/rf1-preview.tsx`, `tests/e2e/rf1-preview.spec.ts`.
- Modify: `apps/web/src/components/auth/auth-shell.tsx` for the fixed RF-1 navigation link only.

**Interfaces:**
- Page uses `MarcoAutenticado`; backend authorization remains authoritative.
- ADMIN reads active clients from existing ADMIN API; SUPPORT reads only assigned clients from `listarClientesAutorizados`; environment/profile data are redacted DTOs.
- Preview consumes `previsualizarRf1`. There is no insert button, confirm flow, or call to any DML endpoint.

- [ ] **Step 1: Write failing Playwright flows** for ADMIN and assigned SUPPORT, unassigned 403, foreign profile, society selection, duplicate UUID, malformed XML, mixed file results, and absence of insert affordance.
- [ ] **Step 2: Implement the module page** with accessible file input plus optional drag/drop, explicit Analyze action, progress, result table, and Spanish safe errors. Enforce count/size limits before upload.
- [ ] **Step 3: Run named RF-1 E2E against `portal_soporte_test` and synthetic MySQL.** Expected: no persistent MySQL writes/XML persistence; API reauthorizes each request.

### Task 4: Verify visual behavior, accessibility, and release checks

**Files:**
- Create: `tests/e2e/visual/rf1-preview.visual.spec.ts`.
- Update: `docs/operations/WORKLOG.md`, `docs/operations/TASK_BOARD.md`, and `docs/specs/PS-005_CLIENTES_CONEXIONES.md` only with finalized user/client authorization contract.

- [ ] **Step 1: Capture synthetic visual cases** at 1280px desktop, narrow mobile, light, and dark; exercise keyboard-only and reduced motion; assert no overflow or clipped state.
- [ ] **Step 2: Run `corepack pnpm@12.21.0 run test:e2e:visual`.** Expected: tests pass or a reviewed baseline is deliberately updated; no silent snapshot refresh.
- [ ] **Step 3: Run final checks:** bounded unit suite, `test:integration:remote`, `test:mysql-fixture`, `test:e2e:remote`, lint, typecheck, build, Prettier on changed files, secret scan, dependency audit, and `git diff --check`.
- [ ] **Step 4: Review the full diff; verify 0004–0006 unchanged and no production migration/customer writes; record exact outcomes in board/log; create scoped commits and prepare PR against `main`.** Owner merges manually; no deploy.
