# DEPLOY-002 — Preparación de publicación segura

> **Para ejecución asistida:** aplicar `superpowers:executing-plans` en orden, con TDD para cada comportamiento; esta sesión usa ejecución nativa en la rama `codex/deploy-002-ps004`.

**Objetivo:** preparar un release verificable del Portal en Debian y un candidato de ingress seguro, sin aplicar cambios a Cloudflare hasta aprobación del propietario.

**Arquitectura:** mantener Next.js y Fastify como servicios separados de loopback; el navegador usa un único origen HTTPS y el servidor web reenvía `/api/v1/*` al API privado. Runtime usa solamente `portal_app`; las migraciones usan `portal_migrator`. Las cabeceras reenviadas se aceptan únicamente desde los peers explícitos del proxy local.

**Pila:** TypeScript estricto, Next.js, Fastify, PostgreSQL 15/Drizzle, Argon2id, systemd y Cloudflare Tunnel existente `consafedev-root`; no Docker.

**Autoridad:** petición DEPLOY-002 del propietario (2026-11-19), `docs/security/PS-003_AUTHENTICATION.md`, `docs/specs/PORTAL_CORE.md`, `docs/operations/DEPLOYMENT_DEBIAN.md`, `docs/operations/TEST_STRATEGY.md` y `AGENTS.md`.

## Restricciones globales

- No cambiar Cloudflare, DNS, firewall ni unidades/configuración de servicios compartidos; el candidato se valida fuera de la configuración efectiva.
- No modificar bases de clientes; pruebas destructivas solo en `portal_soporte_test`.
- Runtime solo `portal_app`; migraciones solo con `portal_migrator`; nunca incluir credenciales en código, logs o Git.
- Email, activación, recuperación y cambio de correo no pueden simular entrega; si falta SMTP deben responder como deshabilitados y no crear tokens.
- Login sigue usando username, roles `ADMIN`/`SUPPORT`, sesiones opacas y expiraciones aprobadas.
- Cloudflare Access queda excluido. RF-1 no recibe operaciones reales.
- Cada tarea termina con pruebas de su alcance; la rama termina con format, lint, typecheck, unitarias, integración PostgreSQL, E2E, build, controles de seguridad y revisión documental.

## Foco de revisión

1. Autenticación ADMIN/SUPPORT password-only por AP-013: conservar controles de Argon2id, rate limit, CSRF, sesiones, autorización backend y auditoría; MFA no se implementa ni se simula.
2. Credenciales de alta/restablecimiento — contraseñas jamás en respuestas/logs/auditoría y sesiones anteriores revocadas.
3. Fuerza bruta y enumeración de usuarios — verificar respuestas uniformes y límites de intentos para login y recuperación.
4. Host, Origin, `X-Forwarded-Proto`, `X-Forwarded-Host` o `Forwarded` falsificados — no deben cambiar origen/cookie ni confiar en proxy no permitido.
5. Restore de respaldo con roles/esquema incorrectos — destino debe ser aislado y la base compartida no debe limpiarse ni modificarse.

---

### Tarea 1: dependencia runtime directa de TypeBox

**Archivos:** modificar `apps/api/package.json` y `pnpm-lock.yaml`; validar `apps/api/src/auth/admin-user-service.ts` y artefacto de despliegue.

**Interfaces:** el API importa TypeBox desde contratos en runtime; debe depender de `@sinclair/typebox@0.34.52` de forma directa y fijada.

- [x] Declarar la dependencia exacta en `apps/api` y actualizar lockfile con pnpm 12.21.0.
- [x] Ejecutar `pnpm install --frozen-lockfile`, typecheck/build del API y verificar el paquete desplegable sin resolución transitiva.
- [x] Verificar el artefacto `pnpm --filter @portal-soporte/api deploy --prod` y leer su manifiesto instalado: `@sinclair/typebox@0.34.52`.
- [x] Ejecutar suite unitaria de auth afectada: 5 archivos, 29 pruebas aprobadas.

### Tarea 2: capacidades de correo apagadas y gestión directa por ADMIN

**Archivos:** contratos de `packages/contracts/src/auth.ts`; dominio/puertos de `packages/core/src/auth`; `apps/api/src/auth/admin-user-service.ts`, rutas y repositorio; UI `apps/web/src/components/auth/user-management.tsx`; pruebas unitarias/integración/E2E; migración versionada si el estado de contraseña temporal la requiere.

**Interfaces:** conservar autorización backend ADMIN, auditoría y DTO sin hashes. Crear cuentas directamente desde ADMIN con contraseña inicial introducida en formulario seguro; restablecimiento directo por ADMIN; el soporte cambia su propia contraseña. Correo de la cuenta queda sin verificar mientras SMTP esté apagado.

- [ ] Añadir tests para alta ADMIN directa y reset, persistencia del hash Argon2id, auditoría, invalidación de sesiones y ausencia de password/hash en DTO/logs.
- [ ] Verificar que invitación, recuperación, verificación/cambio de correo no configuran tokens ni anuncian entrega sin SMTP; responder error estable `EMAIL_DELIVERY_DISABLED`/503 y presentarlo como deshabilitado en UI.
- [ ] Implementar el flujo mínimo directo, sin exponer password en respuesta; validar entrada estricta y conservar protección de último ADMIN.
- [ ] Ejecutar unitarias, integración aislada y E2E afectadas.

### Tarea 3: decisión MFA y controles de login

**Estado:** cerrada por AP-013 y su aclaración expresa del propietario. No implementar MFA para ADMIN ni SUPPORT. Se retiraron del candidato la migración, las tablas y las primitivas criptográficas MFA no aprobadas; no se crean flujos de enrolamiento, challenge o assurance ni se presenta MFA como activo.

- [x] Registrar el riesgo residual de autenticación de ambos roles por un factor y conservar controles efectivos de contraseña, sesión, rate limit, CSRF, autorización y auditoría.
- [x] Retirar las tablas/primitivas MFA no aprobadas y conservar una prueba que impida incorporar migraciones MFA sin nueva decisión expresa.
- [ ] Revisión de seguridad independiente de la configuración password-only antes de la publicación.

### Tarea 4: runtime HTTPS, proxy y controles HTTP

**Archivos:** configuración de `apps/api/src/config.ts`, custom server y proxy de `apps/web`, systemd/env files privados en Debian y tests de seguridad HTTP.

- [ ] En producción exigir `PUBLIC_APP_ORIGIN=https://soporte.consafedev.qzz.io`, cookies Secure/HttpOnly/SameSite/Path sin Domain y cache privado/no-store en autenticación.
- [ ] Configurar allowlists con el peer loopback observado, no con redes amplias; testear `Host`, `X-Forwarded-Proto`, `X-Forwarded-Host`, `Forwarded`, Origin, CSRF, redirects y protocolo HTTPS detrás de proxy.
- [ ] Dejar correo ausente válido únicamente cuando las funciones dependientes están explícitamente apagadas. Mensajes de error de producción no exponen stack, SQL o secreto.
- [ ] Mantener Next.js en `127.0.0.1:18840`, Fastify en `127.0.0.1:18841` y runtime con `portal_app` únicamente.
- [ ] Ejecutar suite HTTP/API y E2E con servidor HTTPS de prueba aislado; no abrir puerto compartido ni cambiar el túnel.

### Tarea 5: respaldo, restauración y PostgreSQL

**Archivos:** procedimientos bajo `docs/operations`; helper de respaldo/restore si es necesario, sin incluir secretos.

- [x] Inventariar solo el puerto 5432, TLS, roles/grants efectivos y retención en modo read-only; Debian 12.15, PostgreSQL 15.20, TLS activo/min 1.2, listener `*`, UFW 5432 abierto en IPv4/IPv6, HBA loopback y `10.18.170.0/24`, cinco atributos administrativos desactivados en roles Portal. Sin política programada previa.
- [x] Generar respaldo consistente cifrado con permisos restrictivos; conservar el manifiesto, SHA-256 y fecha, nunca contenido sensible. Custodia DPAPI y retención documentadas en `docs/operations/POSTGRES_BACKUP_POLICY.md`.
- [x] Restaurar el dump a `portal_soporte_restore_verify_20261119`; comparar datos/objetos/ledger y dejar intactos `portal_soporte`, `portal_soporte_test` y bases ajenas. Eliminar después únicamente la base temporal exacta, con cero sesiones.
- [x] No cambiar UFW, `pg_hba.conf`, parámetros globales ni permisos preexistentes. El cambio de UFW para revisión se presenta como propuesta independiente y no aplicada.

### Tarea 6: release interno y rollback

**Archivos:** scripts/unidades exclusivas de `/opt/portal-soporte` y `/etc/portal-soporte`, `docs/operations/DEPLOYMENT_DEBIAN.md`, tablero y bitácora.

- [ ] Construir release nuevo e inmutable desde rama revisada; `@sinclair/typebox@0.34.52` ya es dependencia directa de `apps/api`; compilar producción local pasó. Aún falta empaquetar/verificar el árbol de producción remoto y publicar el PR antes de actualizar servicios.
- [ ] Aplicar migraciones del portal solo tras respaldo/restauración probados; reiniciar únicamente `portal-soporte-api.service` y `portal-soporte-web.service`.
- [ ] Validar login/password, ADMIN, SUPPORT 403, cambio de contraseña, logout/revocación, rate limits, DB/auditoría y reinicio controlado de las unidades propias.
- [ ] Documentar cambio de symlink/unidades y rollback a `c86af469bdb8f9d10a940ecce29d0e64110a1a57`; sin migración inversa automática.

### Tarea 7: candidato Cloudflare (sin aplicar)

**Archivo:** `docs/operations/DEPLOYMENT_DEBIAN.md` y candidato temporal fuera de `/etc/cloudflared`.

- [ ] Verificar la configuración efectiva indicada por la unidad `cloudflared-consafedev`, backup/metadata y DNS actual sin revelar credenciales del túnel.
- [ ] Insertar solo la ruta `soporte.consafedev.qzz.io -> http://127.0.0.1:18840` antes del catch-all; mantener intactas las dos rutas y su orden.
- [ ] Ejecutar validate/match sobre el candidato y preparar rollback/hash.
- [ ] No copiar candidato a configuración efectiva, no crear DNS, no reiniciar/reload. Presentar diff exacto y pedir autorización final.

### Gate para PS-004

El propietario pidió continuar el dashboard en paralelo para no detener el producto por los controles de publicación. Se autoriza este incremento acotado de PS-004 mientras DEPLOY-002 permanece EN_REVISION: dashboard, navegación, accesos existentes y estado vacío de módulos, con `apple-design`. La instrucción explícita ubica este trabajo bajo PS-004 aunque el baseline PS-006 incluya el catálogo; no modifica `AGENTS.md` y el remanente de catálogo/activación se reconciliará antes de PS-006. Esta secuencia no habilita exposición pública ni da por superado MFA/respaldo/TLS. PS-005 y RF-1 permanecen sin iniciar; RF-1 no tendrá escrituras reales hasta superar sus pruebas.

## Verificación de cobertura

- Dependencia de runtime directa: tarea 1.
- SMTP ausente y alta/admin/reset directos: tarea 2.
- MFA excluido para ADMIN y SUPPORT por AP-013; controles de contraseña únicamente: tarea 3.
- Cookies/proxy/CSRF/errores/caché: tarea 4.
- Backup/restauración/permisos/retención/PostgreSQL: tarea 5.
- Release, servicios, pruebas y rollback: tarea 6.
- Túnel/DNS/rollback/aprobación final: tarea 7.
- PS-004/PS-005/RF-1 respetan la secuencia solicitada y límites de negocio: gate final y AGENTS.
