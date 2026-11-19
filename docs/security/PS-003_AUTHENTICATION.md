# PS-003 — Modelo de seguridad y operación del núcleo de autenticación

**Estado:** implementación local en revisión; no habilitada para producción

**Alcance:** login por nombre de usuario, roles, cuentas, sesiones, correo de recuperación/verificación, auditoría y controles HTTP del portal.

## Arquitectura y límites

- `packages/contracts` valida los contratos de entrada y salida; `packages/core` define identidad, políticas y puertos; `apps/api` compone Fastify, PostgreSQL, Argon2id, SMTP y auditoría; `apps/web` presenta las pantallas mínimas y usa el proxy de Next.js.
- El navegador solo conoce `PUBLIC_APP_ORIGIN` y llama a rutas relativas `/api/v1/*`. Next.js reenvía internamente a `API_INTERNAL_ORIGIN`; Fastify no habilita CORS.
- Fastify escucha por defecto en `127.0.0.1:4100`. Para una topología separada debe indicarse una IP privada explícita mediante `API_LISTEN_HOST`. `0.0.0.0`, IPs públicas y nombres DNS no verificables se rechazan.
- La web usa un servidor Node que inspecciona `socket.remoteAddress`. Solo si ese peer coincide con `TRUSTED_EDGE_PROXY_CIDRS` procesa la cadena `X-Forwarded-For` desde el salto más cercano; en caso contrario usa la IP del socket. Antes del rewrite same-origin elimina `Forwarded`, aliases de IP y todas las cabeceras `X-Forwarded-*`, y envía al API únicamente la IP canónica calculada. Una lista de borde vacía en cualquier entorno significa confiar en nadie.
- Fastify acepta cabeceras reenviadas solo desde peers internos declarados en `TRUSTED_PROXY_CIDRS`; una lista vacía en cualquier entorno significa confiar en nadie y usar el peer del socket. Configure únicamente las IP/CIDR de Next.js que llegan al listener privado del API; ambos allowlists rechazan `/0`, direcciones no especificadas y rangos no-loopback fuera de producción.
- El listener web usa `WEB_LISTEN_HOST` (loopback por defecto) y `PORT` (3000); solo permite loopback o IP privada explícita. No se usa `Host`, `X-Forwarded-Host` o `X-Forwarded-Proto` para enlaces, origen CSRF ni autorización.
- Las cuatro clases de escritura (`POST`, `PUT`, `PATCH`, `DELETE`) requieren `Origin` exacto, doble envío CSRF y, cuando existe, `Sec-Fetch-Site: same-origin`. El backend vuelve a comprobar sesión vigente y rol actual en cada solicitud protegida.

## Credenciales, tokens y sesiones

- Login admite exclusivamente username normalizado. Roles permitidos: `ADMIN` y `SUPPORT`; la autorización efectiva es deny-by-default en servidor.
- Las contraseñas se hashean con Argon2id (19 MiB, dos iteraciones, paralelismo 1 y sal aleatoria). La contraseña se valida entre 15 y 128 puntos de código Unicode y no se recorta ni trunca.
- Las sesiones usan 32 bytes aleatorios opacos. PostgreSQL conserva únicamente el digest SHA-256, consulta estado/rol vigentes en cada petición y aplica 30 minutos de inactividad y 8 horas absolutas. Logout, revocación administrativa y cambios de credencial invalidan sesiones en PostgreSQL.
- Tokens de invitación, recuperación y correo también son opacos, de un solo uso, con 30 minutos de vida y digest únicamente persistido. Las URLs se generan desde `PUBLIC_APP_ORIGIN`; el token está en el fragmento, se elimina antes de transmitirlo y viaja al API solo en `POST`.
- La recuperación devuelve la misma respuesta para correo inexistente, no verificado o activo; los límites HMAC persistentes restringen intentos por cuenta/red sin guardar username, email o IP en claro. No se devuelven ni registran contraseñas, hashes, cookies, tokens, URLs de recuperación o contenido SMTP.
- Cambios voluntarios de contraseña y de correo exigen la contraseña actual. El nuevo correo queda pendiente hasta que se consuma un enlace de verificación; la respuesta de cambio no revela si un email de tercero ya existe.

## Cookies y orígenes

`PUBLIC_APP_ORIGIN` es obligatorio y canónico. En producción debe ser HTTPS; en desarrollo y pruebas solo se aceptan hosts loopback. La cookie de sesión es `HttpOnly`, `SameSite=Strict`, `Path=/`, no tiene `Domain` y usa nombre distinto por entorno. `Secure` se activa siempre en producción y solo puede omitirse en loopback de desarrollo/pruebas. Los enlaces de recuperación llevan `no-store`, `no-referrer` y una CSP sin terceros.

## Configuración externa

- `DATABASE_URL`: conexión de ejecución del API con el rol `portal_app`, limitado a DML de las tablas de autenticación dentro de `portal`; el cliente fija `search_path=portal` y el ORM cualifica las entidades. Las migraciones futuras deben usar por separado el rol `portal_migrator`; ese secreto no debe entrar al API. La CLI disponible sigue limitada a pruebas aisladas y no constituye un runner de migraciones persistentes. Las conexiones remotas usan TLS con `rejectUnauthorized: true`; `DATABASE_SSL_CA` permite proporcionar una CA privada en PEM. Solo PostgreSQL loopback de pruebas/desarrollo puede usar TLS desactivado. El DSN no admite parámetros `ssl*` que contradigan la política del servidor. No incluirlo en logs, capturas o documentación compartida.
- `PUBLIC_APP_ORIGIN` y `API_INTERNAL_ORIGIN`: origen público canónico y destino privado del proxy, respectivamente.
- `API_LISTEN_HOST` y `API_LISTEN_PORT`: listener loopback/privado; por defecto `127.0.0.1:4100`.
- `WEB_LISTEN_HOST`, `PORT`: listener privado de Next.js; host loopback por defecto, puerto 3000.
- `TRUSTED_EDGE_PROXY_CIDRS`: allowlist IP/CIDR del peer TCP que entrega solicitudes a la web; vacía o ausente significa usar solo `socket.remoteAddress`.
- `TRUSTED_PROXY_CIDRS`: allowlist IP/CIDR de peers Next.js que llegan a Fastify; vacía o ausente significa no confiar en ningún proxy y usar el peer del socket.
- `AUTH_THROTTLE_HMAC_KEY`: obligatorio, 32 bytes base64url; gestionar fuera del repositorio y rotar de forma planificada.
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM` y, si aplica, el par `SMTP_USER`/`SMTP_PASSWORD`. TLS implícito o STARTTLS son obligatorios. En desarrollo, si SMTP falta, los envíos fallan cerrados y sin exponer el motivo al navegador; en producción la configuración es obligatoria.
- `.env.example` contiene solo valores locales sintéticos sin contraseña ni secreto real. El API no imprime configuración ni URL de DB al fallar.

## Reversión de migración de invitaciones

`apps/api/drizzle/0002_invitation_lifecycle.down.sql` revierte únicamente el cambio de estado de invitación: las cuentas deshabilitadas sin contraseña ni correo verificado vuelven a `PENDING_ACTIVATION`, sin restaurar sus tokens invalidados. Tras una reversión, el administrador debe emitir un enlace nuevo. El script se prueba en un esquema desechable de PostgreSQL y no se ejecuta automáticamente ni se ha aplicado a una base operativa.

## Migraciones y arranque

- Las migraciones SQL versionadas viven en `apps/api/drizzle/` y se aplican explícitamente. El arranque de Fastify no migra automáticamente.
- `db:migrate:test` exige `NODE_ENV=test`, el marcador interno que solo configura el harness PostgreSQL y `TEST_DATABASE_URL` sin contraseña, con usuario `ps003_test`, host loopback y base exacta `portal_ps003_test`. El harness rechaza un DSN local proporcionado externamente; crea un clúster efímero y pasa el marcador solo después de crearlo. Las conexiones de prueba y migraciones fuera del harness fallan cerradas.
- El modo remoto de pruebas usa `TEST_DATABASE_MODE=ssh-tunnel`, `TEST_DATABASE_ALLOW_MUTATIONS=portal_soporte_test`, `TEST_DATABASE_URL` para `portal_test_app` y `TEST_MIGRATOR_DATABASE_URL` para `portal_test_migrator`, ambas en `127.0.0.1:15432/portal_soporte_test`. El runner valida el forward SSH fijado, identidad, rol, permisos y estado exacto del esquema antes de migrar o probar; si algo no coincide, se detiene. Solo el proceso migrador recibe su DSN; el API E2E recibe únicamente el DSN del rol de ejecución.
- La ejecución remota de PS-003 del 2026-11-19 pasó integración (53 pruebas), CLI de migración de pruebas y E2E (8 pruebas); la base de pruebas terminó con el esquema `portal` migrado y sin filas sintéticas. El modo remoto no usa `initdb` ni `pg_ctl` ni elimina o recrea bases completas.
- `.env.infra-001.local` está ignorado por Git y se debe proteger con ACL del usuario. `.env.infra-001.example` contiene campos vacíos sintéticos. Comandos explícitos: `pnpm test:integration:remote`, `pnpm test:migrate-cli:remote`, `pnpm test:e2e:remote`. Estos comandos pueden escribir únicamente en `portal_soporte_test`; no ejecutar antes de aprobar el plan de aprovisionamiento, validar el acceso y completar el inventario.
- La CLI anterior existe para validar el esquema con datos aislados; no es un procedimiento de despliegue ni habilita migraciones productivas.
- Estado posterior del 2026-11-19: tras autorización explícita del propietario, se otorgó `CREATE` temporal únicamente a `portal_migrator` en `portal_soporte`; Drizzle aplicó las cuatro migraciones, el grant se revocó inmediatamente y el postflight confirmó seis tablas de aplicación, veinte índices, ledger completo y cero tablas en `public`. El rol `portal_app` obtuvo DML mínimo por tabla y no puede leer el ledger. No repetir esa concesión para futuras migraciones sin aprobación expresa.
- El comando `start` ejecuta el build del API. Un fallo al escuchar libera servidor y pool; `SIGINT`/`SIGTERM` cierran ambos de forma coordinada.

## Comprobaciones locales/CI

Los comandos de la tarea se ejecutan solo con pruebas sintéticas y un PostgreSQL efímero/CI aislado:

- `pnpm test` — unitarias y simulaciones PGlite; no demuestra bloqueos o carreras del servidor PostgreSQL.
- `pnpm test:integration` — suite contra proceso PostgreSQL real efímero en loopback; incluye migraciones, rutas, RBAC, expiración/revocación, carrera de último ADMIN y throttling.
- `pnpm test:migrate-cli` — compila y ejecuta la CLI de migración dentro del mismo harness PostgreSQL efímero loopback.
- `pnpm test:e2e` — Chromium local contra Next, Fastify y PostgreSQL desechable con cuentas aleatorias en memoria, además de pruebas de presentación simuladas; no contacta un SMTP real.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm format:check`, `pnpm verify:skills`, `pnpm check:secrets`, `pnpm check:dependencies` y `pnpm check:dependencies:ci` forman parte de la verificación. `pnpm check:dependencies` debe distinguirse del gate temporal de CI.

## Riesgos y puertas pendientes

- **picomatch:** GitHub retiró `GHSA-fc5q-39xc-vjpf`/`CVE-2026-112366` el 2026-11-18 y la clasificación sigue disputada públicamente. El riesgo técnico se conserva abierto para reevaluación del propietario; el retiro no se toma como corrección ni extiende la aceptación temporal. Revisión programada: **2026-12-10 UTC**. Vencimiento registrado: **2026-12-17 UTC**.
- **esbuild:** `pnpm audit --audit-level low --json` reporta `GHSA-67mh-4wv8-2f99` moderado en la dependencia de desarrollo `esbuild@0.18.20` de `drizzle-kit`. No se agregó excepción ni override. Está fuera del umbral alto del gate actual, pero queda como riesgo de desarrollo pendiente de actualización compatible.
- SMTP está implementado pero su entrega real no se verificó ni se configuró un proveedor.
- MFA para `ADMIN` sigue como condición previa a producción. También faltan revisión independiente, política operativa de retención de auditoría, gestión/rotación real de secretos, checklist de despliegue y piloto aprobado.
- El servidor Node personalizado de Next.js permite validar el peer del socket antes de aceptar direcciones reenviadas; implica prescindir de optimizaciones del servidor integrado que se deben medir en el futuro despliegue.
- No se configuró ni consultó una base productiva o de cliente. No se tocó Debian, Cloudflare, túneles ni servicios desplegados. Dashboard, conexiones a clientes, RF-1 y PS-004 no forman parte de esta tarea.
