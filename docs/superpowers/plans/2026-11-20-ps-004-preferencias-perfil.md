# Plan de implementación: PS-004 — preferencias personales

**Fecha:** 2026-11-20
**Estado:** aprobado por los contratos existentes de `PORTAL_CORE.md`; implementación local lista para revisión (`EN_REVISION`, sin despliegue).
**Base:** rama `codex/deploy-002-postmerge`, commit `42f4fd50428ef15fc3334f09eef8dd2c0d05408e`.

## Objetivo

Completar una parte de la configuración personal permitiendo guardar el tema visual por cuenta y aplicarlo de forma consistente al portal. Mientras SMTP no esté habilitado, el perfil debe informar que la verificación/cambio de correo no se puede completar.

## Alcance

- Preferencia persistida `system | light | dark`, editable por ADMIN y SUPPORT solo para su propia cuenta.
- API `GET /api/v1/me/preferences` y `PATCH /api/v1/me/preferences`; PATCH requiere sesión y CSRF.
- Migración versionada en el esquema `portal` y pruebas únicamente en PostgreSQL de integración aislado/PGlite.
- El navegador conserva la última elección local para aplicar el tema en `/login`; tras autenticar, la preferencia persistida del usuario prevalece.
- Formulario de correo solo cuando el runtime web declara `PORTAL_EMAIL_DELIVERY_ENABLED=true`; por defecto se informa que requiere SMTP. El API conserva la comprobación definitiva y falla cerrado.
- Continuar PS-004 en estado `EN_CURSO`; no desplegar esta iteración.

## Fuera de alcance

Catálogo persistente y activación de módulos (reconciliar con PS-006), avatar, administración de clientes, credenciales externas, RF-1, cambios a `portal_soporte`, Cloudflare, DNS, UFW, servicios systemd y SMTP real.

## Decisión de implementación

Se consideran dos almacenes: una tabla de preferencias separada o una columna de tema en `portal.users`. Se elige `theme_preference` en `users`: el único ajuste cubierto por este incremento es escalar, pertenece exactamente a una cuenta y así se evita crear una tabla adicional. Se limita por CHECK a `system`, `light` y `dark`, con default `system`.

El contrato de apariencia define tres modos explícitos. La capa de presentación usa el tema del sistema como fallback y conserva un valor local solo para el login; el API es la fuente de verdad después de autenticar. No se guardan preferencias de avatar ni datos ajenos al perfil propio.

## Contratos

- `GET /api/v1/me/preferences`: `200 { "theme": "system" | "light" | "dark" }`; requiere sesión vigente.
- `PATCH /api/v1/me/preferences`: body exacto `{ "theme": ... }`; `200` con el mismo DTO; requiere sesión, CSRF y enum cerrado. El ID de usuario se toma exclusivamente del `AuthContext` del servidor.
- Respuestas sin identificadores de otros usuarios, contraseñas, hashes, tokens ni datos de correo.
- La interfaz solo confirma el guardado después de recibir respuesta exitosa. Los errores muestran estado accesible y conservan la selección anterior.
- Sin SMTP, el perfil muestra una explicación permanente y no muestra controles que sugieran que se enviará un enlace. Si SMTP se habilita posteriormente, la configuración visible no sustituye la protección del API.

## Plan TDD

1. **Contrato y dominio.** Escribir primero pruebas de tema permitido, entrada extra rechazada y comportamiento `system` predeterminado; añadir schemas compartidos, tipos de dominio, puerto de repositorio y servicio documentados en español.
2. **Persistencia PostgreSQL.** Escribir prueba de lectura por usuario, actualización propia y rechazo de valores inválidos. Añadir columna/check a Drizzle y migración `0004`, adapter parametrizado y actualizar el inventario estricto de objetos/constraints de `test-database-preflight.ts`. Comprobar el diff de migración y snapshot; no ejecutar migraciones en la base permanente.
3. **API y autorización.** Añadir primero pruebas de integración en `tests/integration/user-preferences-routes.test.ts` para ADMIN y SUPPORT, identidad propia, 401 sin sesión, 403 sin CSRF, entrada inválida y ausencia de datos sensibles. Registrar las rutas bajo el prefijo de perfil autenticado y componer el servicio en runtime.
4. **Disponibilidad de correo.** Añadir pruebas de presentación para ambos modos de `PORTAL_EMAIL_DELIVERY_ENABLED`; corregir la página de perfil para que el modo deshabilitado explique la limitación sin enviar una petición ni sugerir éxito.
5. **Tema visible.** Añadir prueba E2E sintética de preferencia guardada, aplicada, sobreviviente a recarga y disponible como preferencia local en login. Implementar proveedor del tema, selector accesible dentro del perfil y tokens CSS para system/light/dark; asegurar foco, responsive, contraste y reduced-motion.
6. **Validación final.** Ejecutar pruebas unitarias, integración PostgreSQL remota aislada y E2E pertinentes; `format:check`, lint, typecheck y build. Revisar `git diff`, migración, secretos y auditoría de dependencias. Registrar cada resultado y dejar PS-004 `EN_REVISION`; no ejecutar migraciones ni publicar cambios en producción.

## Archivos previstos

- `packages/contracts/src/user-preferences.ts`
- `packages/core/src/preferences/` (modelos, puerto y servicio)
- `apps/api/src/db/schema.ts`, `apps/api/drizzle/0004_user_theme_preference.sql` y metadatos Drizzle
- `apps/api/src/preferences/`, `apps/api/src/routes/user-preferences-routes.ts`, `apps/api/src/server.ts`, `apps/api/src/runtime.ts`
- `apps/api/src/db/test-database-preflight.ts`
- `apps/web/src/lib/auth-api.ts`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, componentes de tema y perfil
- `tests/unit/`, `tests/integration/`, `tests/e2e/`
- `docs/operations/TASK_BOARD.md` y `docs/operations/WORKLOG.md`

## Diseño y validación UI/UX

Leída `.agents/skills/apple-design/SKILL.md` antes de analizar la interfaz. Se aplican propósito, familiaridad, sencillez, flexibilidad y feedback: opciones con nombres claros, valor actual reconocible, guardado explícito, navegación por teclado y respuesta que respeta movimiento reducido. Verificación realizada: capturas sintéticas en claro/oscuro y móvil; selección con teclado/Space; contraste computado en navegador igual o superior a 4.5:1 en claro y oscuro; ancho de 360 px sin desbordamiento horizontal; reduced-motion respetado. Evidencia visual en `.superpowers/sdd/2026-11-19-deploy-002-publicacion/perfil-ps004-sintetico.png` y `perfil-ps004-movil-sintetico.png`. Sin datos de cuentas reales.

## Riesgos

- La nueva migración no estará en `portal_soporte` hasta una autorización y revisión posterior.
- La apariencia guardada localmente en dispositivos sin sesión puede diferir de la preferencia del perfil hasta que el usuario vuelva a autenticarse.
- `PORTAL_EMAIL_DELIVERY_ENABLED` del runtime web debe permanecer en `false` mientras API carezca de SMTP; el API sigue siendo la barrera de seguridad si ambas configuraciones divergen.
- El catálogo persistente de módulos sigue sin implementarse y debe ubicarse con PS-006 antes de comenzar esa tarea.

## Ajuste solicitado por el propietario — 2026-11-20

- El perfil conserva la preferencia persistida `system|light|dark`.
- Añadir un botón global con iconos SVG propios de sol y luna, estado accesible (`aria-label`, `aria-pressed`), destino dinámico claro/oscuro y transición breve de opacidad/rotación; el tema autenticado se guarda por el API con CSRF y en login usa únicamente `localStorage`.
- La vista principal muestra un saludo breve sin métricas ni paneles de información; las rutas de módulos permanecen en navegación y su contenido aparece al abrirlos.
- La transición debe ser inmediata al clic, interrumpible por clics posteriores cuando no hay escritura en curso y convertirse en cambio estático con `prefers-reduced-motion`.
- No desplegar la migración 0004 ni cambios de código en producción hasta PR revisado y aprobación expresa de merge/deploy, como exige la etapa adjunta.
## Plan de ejecución del ajuste visual

1. Extender E2E con saludo personalizado, dashboard sin tarjetas/gráficas, botón sol/luna, persistencia autenticada vía CSRF y fallback local en login; confirmar RED antes del código.
2. Crear componente de alternancia del tema con SVG, estado semántico, lectura de `prefers-color-scheme`, persistencia y aviso accesible de error.
3. Actualizar el proveedor para alternar localmente en rutas públicas y aplicar el tema de inmediato con rollback visual si falla la escritura del API.
4. Permitir al marco autenticado renderizar contenido con la identidad ya validada; reducir dashboard a saludo sin segunda consulta de sesión.
5. Añadir transiciones breves de color/opacidad/rotación y neutralizarlas bajo `prefers-reduced-motion`.
6. Ejecutar E2E enfocado y suite E2E completa aislada, Prettier dirigido, lint, typecheck y build; revisar formato base, migración 0004 y diff/secretos. No instalar cambios en producción en esta iteración.

## Resultado de ejecución — 2026-11-20

- Se completaron las preferencias personales con sesión/CSRF, el saludo limpio y el botón global sol/luna; no se agregaron tarjetas ni gráficas al inicio.
- La migración 0004 se aplicó y verificó únicamente en `portal_soporte_test`. La base permanente no recibió DDL.
- Unitarias 234/234, integración PostgreSQL 57/57, E2E 10/10 y CLI de migración de pruebas pasaron. Lint, typecheck, build, `check:secrets`, `check:dependencies:ci` y Prettier con EOL auto pasaron.
- `format:check` estándar continúa marcando 27 archivos; se confirmó que no son errores de formato: `core.autocrlf=true` y `endOfLine=lf`; Prettier con `--end-of-line auto` verifica todo el repositorio sin cambios masivos.
- La skill Apple Design fue leída. Evidencia visual/accesible: capturas de dashboard sintéticas desktop/móvil, foco de teclado, contraste AA, transición y movimiento reducido registradas en WORKLOG.
- **Estado:** `EN_REVISION`; no publicado ni desplegado. El siguiente paso es el PR revisable; PS-005 se inicia separado según la autorización posterior del propietario.
