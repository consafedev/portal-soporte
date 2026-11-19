# Borrador local de Pull Request — PS-003

**Estado:** borrador no publicado. Commit local de código: `c3de5a3`. Requiere autorización para `git push`; GitHub Actions y la revisión remota quedan pendientes.

## Título

`feat(auth): PS-003 cerrar núcleo de autenticación y pruebas PostgreSQL aisladas`

## Alcance

- Consolida el esquema autenticado en el esquema PostgreSQL `portal` y alinea el journal Drizzle.
- Refuerza el bloqueo transaccional de operaciones de usuarios/sesiones y limita los diagnósticos PostgreSQL a campos permitidos.
- Adapta integración, migración CLI y E2E para admitir explícitamente PostgreSQL por túnel SSH hacia `portal_soporte_test`, con roles separados, identidad del servidor/rol, revisión del esquema, opt-in exacto de mutación y concurrencia acotada.
- Conserva PostgreSQL local efímero y simulaciones PGlite. Las pruebas remotas no usan `portal_soporte`.
- Registra inventario, riesgos y preparación de despliegue. No implementa dashboard, PS-004, PS-005 ni RF-1.

## Seguridad y no interferencia

- Credenciales locales permanecen fuera de Git; `secretlint` pasó.
- Los cuatro roles PostgreSQL conservan privilegios mínimos y no tienen flags administrativos ni membresías.
- No se modificaron otras bases, ACL de `PUBLIC`, firewall, SSH, unidades systemd, DNS ni configuración de túneles.
- Cloudflare Access queda excluido. El hostname candidato se mantiene como propuesta; las rutas actuales `consafedev.qzz.io` y `renios.consafedev.qzz.io` no se editaron.
- No se realizó despliegue público ni se usaron datos de clientes.

## Verificaciones ejecutadas localmente

- Unitarias: 213/213, 24 archivos.
- Integración remota PostgreSQL aislado: 53/53, 6 archivos.
- CLI de migración remota: PASS; migraciones idempotentes, sin recrear la base.
- E2E remoto con Chromium, un worker: 8/8.
- `format:check`, `lint`, `typecheck`, `build`, `verify:skills`, `secretlint`, `drizzle-kit check`, `git diff --check` y auditoría de producción: PASS.
- Auditoría de dependencias CI: PASS al umbral high/critical; queda un hallazgo moderate de desarrollo.
- El runner local utilizó Node 24.13.0 (dentro de `engines`); la versión exacta `.node-version` 24.22.3 y GitHub Actions requieren verificación remota.

## Riesgos y límites conocidos

- MFA para `ADMIN`, SMTP real, respaldo/restauración verificados y revisión del alcance de PostgreSQL expuesto siguen pendientes antes de producción.
- Existe `CONNECT` heredado por `PUBLIC` en bases preexistentes, sin permisos efectivos de datos para roles Portal; no se cambió ninguna ACL existente.
- El runtime global del servidor es Node 20.20.0 y el proyecto requiere Node 24.22.3; no se cambió el runtime global.
- Picomatch queda en seguimiento: revisión 2026-12-10 UTC y vencimiento de aceptación temporal 2026-12-17 UTC.
- Efectos visuales y pruebas visuales/accesibilidad: NO EJECUTADOS; UI/UX no cambió.
- GitHub Actions: NO EJECUTADO porque no hay PR remoto publicado.

## Publicación y reversión

Los commits locales quedan preparados para revisión. La publicación requiere aprobación explícita. Las migraciones son propias de `portal`; no se propone `DROP` ni rollback destructivo. No añadir DNS ni cambiar/reiniciar el túnel compartido hasta completar las puertas de seguridad y obtener autorización separada.
