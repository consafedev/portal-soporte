# PS-005.3 / RF-1 Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement these plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver recoverable profile-key custody, per-client authorization, safe RF-1 read-only preview, and usable ADMIN/SUPPORT screens without writing to client databases.

**Architecture:** Execute three bounded plans in order: (1) keyring/recovery and synthetic connector validation; (2) persistent authorization, typed MySQL reads, and the preview API; (3) ADMIN/SUPPORT UI. The current parser and batch-preview code in `modules/rf-1` is existing local work to preserve and consume, not replace.

**Tech Stack:** Strict TypeScript, Fastify, Next.js/React, PostgreSQL/Drizzle, Vitest, Playwright, existing AES-256-GCM keyring and MySQL/SSH connector.

**Spec:** `docs/superpowers/specs/2026-11-21-ps0053-rf1-client-access-design.md`; approved business decision AP-014 in `docs/product/DECISIONS_APPROVED.md`.

## Global Constraints

- ADMIN manages; SUPPORT uses only currently assigned clients and explicitly enabled capabilities; authorization is checked in backend on every request.
- `rf-1:read` never grants `rf-1:execute`; no invoice INSERT route is implemented in these plans.
- Deny by default; unauthorised client/profile/capability requests return uniform `403` without revealing resource existence.
- PostgreSQL schema changes are additive, versioned, and tested only in `portal_soporte_test`; never alter migrations 0004–0006 or apply new migrations to `portal_soporte` in this delivery.
- MySQL/SSH tests use only isolated synthetic fixtures and fixed parameterized reads; never connect to customer databases.
- Keys, envelopes, passwords, XML, tokens, raw SQL, connection details, and personal data never enter responses, logs, Git, tests, or WORKLOG.
- API and services remain separated into contracts, domain/application, infrastructure, and presentation; every function/class/method/component/contract gets Spanish TSDoc/JSDoc.
- Before UI edits, reread `.agents/skills/apple-design/SKILL.md` and record criteria plus visual/accessibility evidence in WORKLOG.
- Do not modify Cloudflare, DNS, firewall, customer data, shared services, or production database schema; no PS-006 catalog, PS-009 write path, or PS-004 work.

## Review Focus

- An existing envelope depends on a missing key version: preflight must halt without rotating, replacing, or exposing envelope contents (Plan 1, Task 1).
- Recovery backup decrypts to different bytes or wrong metadata: test must fail and runtime keyring must remain inactive (Plan 1, Task 2).
- A revoked assignment/capability is reused with the same live session: next request must return 403 before opening the connector (Plan 2, Tasks 2–4).
- An uploaded request is truncated, malformed, too large, or has too many files: the route must settle within a bounded time, release resources, return controlled errors, and create no temporary files (Plan 2, Task 5).
- Client/profile/environment identifiers are mixed across clients: no query is issued against the foreign profile and the response remains a uniform 403 (Plan 2, Tasks 3–5; Plan 3, Task 3).

## Execution Order and Gates

1. **Plan A — keyring and fixtures:** read-only preflight; create or activate a keyring only if existing envelopes can be resolved and independent recovery succeeds; validate TCP/TLS and SSH/PEM only against the ephemeral fixture.
2. **Plan B — access and preview backend:** migration 0007, contracts, repository/service, role/capability checks, fixed SQL broker methods, multipart preview API, PostgreSQL/MySQL integration tests. `rf-1:execute` stays unused.
3. **Plan C — UI:** ADMIN assignment/capability controls and SUPPORT preview flow, followed by visual and accessibility validation.
4. **Delivery:** run the relevant full checks, review secrets/diff, make scoped commits, update the board/log, and prepare a PR for the owner's manual merge. No production migration or deployment.

**Operational gate:** If keyring preflight finds an unknown version, a profile envelope that cannot be matched, unsafe filesystem permissions, or an unverified recovery copy, stop only keyring activation and continue synthetic backend work without enabling secret decryption.

**Database gate:** Remote migration/integration/E2E commands must pass the existing preflight for exact `portal_soporte_test` identity and test role. Do not run destructive commands against any other database.

**UI gate:** The fixed RF-1 route is not a general module registry. Keep any link limited to this implemented module; leave catalogue registration and visibility management to PS-006.

## Plan Documents

- Plan A: `docs/superpowers/plans/2026-11-21-ps0053-keyring-fixtures.md`
- Plan B: `docs/superpowers/plans/2026-11-21-rf1-client-access-api.md`
- Plan C: `docs/superpowers/plans/2026-11-21-rf1-operations-ui.md`

## Approval Gate

The owner approved the technical design after the builder check. These plans still require review before code changes. Suggested execution method: native, sequential work in this checkout, with commits after each independently tested increment and one fresh full-branch review before a PR. This avoids parallel edits to shared migrations, Fastify registration, and the authenticated shell. No new-scope tests have been run or claimed.
