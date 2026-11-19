# Registro del Pull Request #1 — PS-003

**Estado:** abierto para revisión, no fusionado. Rama `codex/ps-003-auth`, head revisado `75d2b74b537427fad5699fe62eea36e41530a7e6`. [Pull Request #1](https://github.com/consafedev/portal-soporte/pull/1). No se ha autorizado el merge.

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
- La ejecución local registrada utilizó Node 24.13.0; GitHub Actions confirmó la versión fijada `.node-version` 24.22.3.

## Riesgos y límites conocidos

- MFA para `ADMIN`, SMTP real, respaldo/restauración verificados y revisión del alcance de PostgreSQL expuesto siguen pendientes antes de producción.
- Existe `CONNECT` heredado por `PUBLIC` en bases preexistentes, sin permisos efectivos de datos para roles Portal; no se cambió ninguna ACL existente.
- El runtime global del servidor es Node 20.20.0 y el proyecto requiere Node 24.22.3; no se cambió el runtime global.
- Picomatch queda en seguimiento: revisión 2026-12-10 UTC y vencimiento de aceptación temporal 2026-12-17 UTC.
- Efectos visuales y pruebas visuales/accesibilidad: NO EJECUTADOS; UI/UX no cambió.
- GitHub Actions run de código `44620840776` sobre `5c15ddc` y revalidaciones documentales `44622103331` (`8438c5b`) y `44622825003` (`75d2b74`): PASS en todos los pasos, incluidas unitarias, integración PostgreSQL aislado, CLI de migración, build, typecheck, E2E, secretlint y gates de auditoría. El run anterior `44618550814` detectó un permiso denegado del socket Unix del clúster temporal; se corrigió configurando `unix_socket_directories` en su carpeta privada y el nuevo run pasó. El gate de dependencias de desarrollo conserva el alcance/umbral aprobado; no declara resuelto el riesgo residual de `esbuild`/picomatch.

## Publicación y reversión

La rama ya está publicada y el PR #1 queda pendiente de revisión independiente y aprobación del propietario para fusionar. Las migraciones son propias de `portal`; no se propone `DROP` ni rollback destructivo. No añadir DNS ni cambiar/reiniciar el túnel compartido hasta completar las puertas de seguridad y obtener autorización separada.
