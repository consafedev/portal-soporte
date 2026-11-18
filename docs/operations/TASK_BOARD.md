# Tablero de trabajo — Portal e-Billia

**Versión:** 0.2 · **Actualizado:** 2026-11-17 · **Significado:** `PENDIENTE`, `EN_CURSO`, `EN_REVISION`, `BLOQUEADO`, `HECHO`.

| ID | Etapa | Tarea y entregable verificable | Estado | Responsable | Bloqueantes |
|---|---|---|---|---|---|
| PS-000 | F0 | Establecer línea base documental v0.2 y decisiones funcionales aprobadas | HECHO (fuera de Git) | ChatGPT | Integrar en repo; validaciones técnicas diferidas a tareas posteriores |
| PS-001 | F0 | Inventario **read-only** de repo y, si hay acceso explícito, Debian/túneles; metadatos DDL solo si hay autorización expresa, sin secretos | HECHO | Codex · 2026-11-17 · `main` | Revisión del propietario completada; servidores y BD productivas no inspeccionados |
| PS-002 | F1 | Inicializar monorepo, CI, tipos, lint, estándares JSDoc en español y apps vacías | HECHO | Codex · 2026-11-17 · `main` | Cierre administrativo aprobado por el propietario el 2026-11-17; docs commit `1ce22324333`; GHSA-fc5q-39xc-vjpf sigue abierto solo para desarrollo; revisión 2026-12-10 UTC y vencimiento 2026-12-17 UTC |
| PS-002.1 | F1 | Estabilización, revisión de seguridad y cierre del bootstrap | HECHO | Codex · 2026-11-17 · `main` | Cierre administrativo aprobado por el propietario el 2026-11-17; aceptación condicionada del riesgo de picomatch limitada a desarrollo |
| PS-002.2 | F1 | Cierre documental, publicación controlada y validación de CI | HECHO | Codex · 2026-11-17 · `main` | Cierre administrativo aprobado por el propietario el 2026-11-17; commit 41217b534ef23a9c12515c29d2f25011185f720a; GitHub Actions run 44215839204 success; riesgo sigue abierto con revisión 2026-12-10 UTC y vencimiento 2026-12-17 UTC |
| PS-003 | F1 | Login, autenticación, sesiones, autorización ADMIN/SUPPORT, usuarios, recuperación y cambio de contraseña; sin dashboard completo | EN_CURSO | Codex · 2026-11-17 · `codex/ps-003-auth` | Diseño aprobado con cinco ajustes; Tasks 1–3 comprometidas hasta `df78bbc`; Task 4 verificada localmente (62 unitarias, 13 PostgreSQL 18.7 aisladas), pendiente de commit. Login same-origin, cookies por entorno, proxy confiable explícito y CSRF global ya implementados. Siguen administración/RBAC, recuperación, UI y E2E. MFA admin bloquea producción; picomatch dev sigue abierto (revisión 2026-12-10 UTC, vence 2026-12-17 UTC); SMTP real, servidores, túneles, PS-004 y RF-1 fuera de alcance |
| PS-004 | F1 | Identidad, sessions, roles, administración de usuarios, MFA, perfil | PENDIENTE | Sin asignar | PS-002, DEC-014 |
| PS-005 | F1 | Clientes, perfiles direct/URL/SSH, secretos cifrados y test solo admin | PENDIENTE | Sin asignar | PS-004, DEC-013/023 |
| PS-006 | F1 | Dashboard, catálogo y matriz de activación por rol/cliente | PENDIENTE | Sin asignar | PS-003/004/005 |
| PS-007 | F2 | Parser seguro CFDI 4.0 I + tests con datos sintéticos | PENDIENTE | Sin asignar | PS-002 |
| PS-008 | F2 | UI lote/inputs y lookup contextual de proveedor/sociedad + preview read-only | PENDIENTE | Sin asignar | PS-005/007, DDL verificado; negocio aprobado |
| PS-009 | F2 | Ejecutor INSERT seguro + duplicados + transacción + conciliación | BLOQUEADO | Sin asignar | Puertas técnicas VT-01..VT-09; PS-008, revisión independiente |
| PS-010 | F2 | E2E/Multiusuario/concurrencia/errores/seguridad/monedas | PENDIENTE | Sin asignar | PS-009 |
| PS-011 | F4 | Auditoría, backup/rollback, hardening, systemd, Cloudflare y piloto | BLOQUEADO | Sin asignar | PS-010, DEC-015/024 |

## Reglas del tablero

- En cada tarea deben existir objetivo, owner (persona/agente), fecha, rama, criterios de aceptación, evidencia y PR/commit en el `WORKLOG.md`.
- Nadie puede mover a `HECHO` sin especificar pruebas reales. `PS-000` significa **documentos generados**, no fusionados en repositorio ni aprobados.
- Para trabajo paralelo, dividir `PS-###` en sub-tareas con propietario único, respetando APIs/paths de módulos.
- Nunca colocar un agente ejecutor en una tarea `BLOQUEADO` si eso implica saltarse decisiones P0.
