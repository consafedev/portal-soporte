# Diseño PS-003 — Autenticación y gestión de usuarios

| Campo | Estado |
|---|---|
| Fecha | 2026-11-17 |
| Estado | APROBADO por el propietario con cinco ajustes técnicos obligatorios (2026-11-17). |
| Aprobación de enfoque | Sesiones opacas en PostgreSQL, Argon2id, SMTP configurable, login solo por usuario, roles ADMIN/SUPPORT y expiraciones definidas. |
| Límite de autorización | Implementar PS-003 según este diseño y el plan técnico. La entrega queda EN_REVISION; no autoriza producción, PS-004 ni RF-1. |
**Referencias:** `AGENTS.md`, `docs/specs/PORTAL_CORE.md`, `docs/architecture/ADR-0001_STACK.md`, `docs/standards/CLEAN_CODE.md`, `docs/product/OPEN_DECISIONS.md` y la skill `.agents/skills/apple-design/SKILL.md`.

## Propósito

Entregar la identidad mínima operable del portal: el equipo inicia sesión con cuentas individuales, el backend aplica los roles `ADMIN` y `SUPPORT`, las sesiones se pueden expirar o revocar y un administrador puede gestionar cuentas sin conocer ni transmitir contraseñas. El login usa el lenguaje visual Apple-inspired aprobado para el portal. La iteración termina en `EN_REVISION`; no prepara producción.

## Objetivos

- Autenticar por nombre de usuario y contraseña, con mensajes que no revelen si la cuenta existe. El correo es el canal de recuperación, no un alias de inicio de sesión.
- Aplicar autorización en Fastify en cada petición protegida y auditar acciones sensibles.
- Guardar usuarios, sesiones, tokens de recuperación, limitadores y auditoría en PostgreSQL del portal mediante Drizzle y migraciones versionadas.
- Permitir alta/invitación, edición, desactivación, restablecimiento de acceso y revocación de sesiones por `ADMIN`; permitir a ambos roles cambiar su propia contraseña.
- Completar recuperación con token de un solo uso enviado por SMTP configurable, sin devolverlo por API ni registrarlo.
- Entregar login, recuperación, cambio de contraseña y una pantalla acotada de administración de usuarios; no crear dashboard.

## Fuera de alcance

- Dashboard, clientes, conexiones, credenciales externas, RF-1, consultas o escrituras en bases de clientes.
- MFA y liberación productiva. `OPEN_DECISIONS.md` VT-08 conserva MFA de administradores como requisito previo a producción; PS-003 no afirma resolver esa puerta.
- Preferencias completas de perfil, avatar, asignaciones de cliente o permisos por módulo.
- Proveedor SMTP, dominio, cuenta de correo o secretos reales. La aplicación ofrecerá el adaptador y la configuración requerida, pero no se conectará a un servicio externo durante esta tarea.
- Debian, Cloudflare, servicios, túneles o bases productivas.

## Enfoques considerados

1. **Sesiones opacas en PostgreSQL (aprobado).** Token aleatorio de alta entropía en cookie y solo su hash en PostgreSQL. Facilita revocación inmediata, cierre en todos los dispositivos y validación del estado vigente del usuario; corresponde a `PORTAL_CORE.md` §3 y §4. Argon2id protege contraseñas; SMTP configurable transporta invitaciones y recuperación.
2. **JWT autocontenido con tokens de renovación.** Reduce lecturas de sesión, pero requiere una lista de revocación o versiones de credencial para cumplir la revocación inmediata. Añade mecanismos sin beneficio claro en este portal interno.
3. **Sesiones en memoria de proceso.** Menor costo inicial, pero no sobreviven reinicios ni permiten varias instancias con revocación consistente. No satisface los requisitos de PostgreSQL y control server-side.

El propietario aprobó el enfoque 1 y este diseño con cinco ajustes técnicos obligatorios el 2026-11-17. Las expiraciones y reglas aquí descritas forman parte del alcance de implementación aprobado; una incompatibilidad requiere detener el cambio y documentarla.

## Arquitectura propuesta

- **Contratos:** esquemas de entrada/salida y tipos compartidos en `packages/contracts`, validados en runtime con TypeBox/JSON Schema.
- **Dominio y aplicación:** reglas puras, casos de uso y puertos en `packages/core`; el dominio no importa Fastify ni Drizzle.
- **Infraestructura/API:** `apps/api` conecta Fastify, Drizzle/PostgreSQL, Argon2id, correo SMTP y auditoría. Fastify es el único backend con autoridad; ninguna lógica de permisos depende de la UI.
- **Presentación:** `apps/web` usa Next.js para páginas del login, recuperación, cambio de contraseña y administración de usuarios. El navegador usa rutas relativas `/api/v1/*`; Next.js hace proxy server-side a Fastify mediante `API_INTERNAL_ORIGIN`. La API no expone un origen público ni CORS.
- **Persistencia:** migraciones Drizzle del portal en `apps/api/drizzle/`. Tablas previstas: `users` (con `email_verified_at`), `sessions`, `recovery_tokens` (con propósito y correo destino pendiente cuando corresponda), `auth_throttle_windows`, `audit_events` y la fila singleton `auth_invariants`. No se ejecutan migraciones fuera de la BD del portal.
- **Pruebas:** dominio con Vitest; API con `fastify.inject`; integración de migraciones, transacciones, restricciones y concurrencia contra un proceso PostgreSQL real y desechable con base y rol exclusivos de prueba; PGlite puede usarse para simulaciones rápidas de consultas compatibles, pero nunca sustituye la suite del servidor PostgreSQL. UI con flujos de navegador y cuentas sintéticas.

### Origen público, proxy y cookies

- El único origen visible para el navegador es `PUBLIC_APP_ORIGIN`, configurado como URL absoluta canónica sin credenciales, query, fragmento ni ruta distinta de `/`. En producción debe usar HTTPS. El navegador no llama a Fastify por host o puerto separados: usa `/api/v1/*` en el mismo origen y Next.js reenvía internamente esas rutas a `API_INTERNAL_ORIGIN`. `API_INTERNAL_ORIGIN` se valida al arrancar, permanece del lado servidor y apunta a una dirección privada; la API escucha solo en loopback o red privada. No se habilita CORS.
- Un proxy público de infraestructura, si se usa en el futuro, entrega solo el origen web de Next.js. El proxy interno de Next.js no añade lógica de autenticación ni autorización, conserva correctamente status y `Set-Cookie`, limita tamaño/tiempo de respuesta y nunca registra cuerpos de autenticación. No se configurarán túneles ni servidores en PS-003.
- `PUBLIC_APP_ORIGIN` es la única fuente para validar el origen destino CSRF y para generar enlaces de invitación, recuperación y cambio de correo. Se prohíbe construir URL con `Host`, `X-Forwarded-Host`, `request.hostname` u otros headers suministrados por el cliente.
- Producción: cookie `__Host-portal_session`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, sin `Domain`; la aplicación falla al iniciar si la URL pública no es HTTPS o si esa cookie pudiera emitirse sin `Secure`.
- Desarrollo local: cookie distinta `portal_dev_session`, `HttpOnly`, `SameSite=Strict`, `Path=/`, sin `Domain`, `Secure=false` solo si `NODE_ENV=development` y `PUBLIC_APP_ORIGIN` resuelve a `localhost`, `127.0.0.1` o `[::1]`. Rechazar cualquier origen no loopback en este modo. Producción nunca reduce sus atributos por una variable de desarrollo.
- Pruebas: `portal_test_session` con `Secure=false` solo en `NODE_ENV=test`, URL loopback y cluster/BD PostgreSQL desechable; es un nombre adicional no válido en producción y no reutiliza la cookie de desarrollo.
- La cookie de sesión nunca se expone a JavaScript. La protección CSRF también usa cookie `HttpOnly` y de nombre separado por ambiente: `__Host-portal_csrf` en producción (`Secure`, `SameSite=Strict`, `Path=/`, sin `Domain`) y `portal_dev_csrf` solo en desarrollo loopback. Su valor aleatorio se obtiene mediante `GET /api/v1/auth/csrf`, se entrega en respuesta no cacheable para guardarlo solo en memoria y el cliente lo reenvía en `X-CSRF-Token`; se compara con la cookie en tiempo constante.
- En pruebas se usa el nombre `portal_test_csrf`, limitado al mismo origen loopback y al entorno `test`.
- Toda solicitud de escritura `POST`, `PUT`, `PATCH` o `DELETE`, incluyendo login, logout, recuperación, activación y endpoints administrativos, requiere el token CSRF válido y un `Origin` exactamente igual a `PUBLIC_APP_ORIGIN`. Se rechaza `Origin` ausente o `null`; si llega `Sec-Fetch-Site`, solo se acepta `same-origin`. Ningún endpoint de escritura usa métodos seguros. Los hooks globales de Fastify aplican esta regla antes de ejecutar rutas; pruebas cubren cada clase de operación y rechazo de headers falsificados.
- Fastify configura `trustProxy` con una lista explícita validada de IP/CIDR (`TRUSTED_PROXY_CIDRS`); por defecto no confía en ningún proxy. Se prohíben `true`, conteos de saltos y comodines. Un proxy permitido debe borrar y reescribir los headers `X-Forwarded-*`; la API solo es accesible desde la red privada configurada. Sin proxy confiable, rate limit y auditoría minimizada usan la IP del socket. Con proxy, Fastify deriva la IP solo de la cadena cuya conexión inmediata coincide con la allowlist. Los valores de host/protocolo reenviados no se usan para autorización ni para construir enlaces. Tests intentan falsificar `X-Forwarded-For`, `X-Forwarded-Host` y `X-Forwarded-Proto` desde un peer no confiable.

## Flujos y reglas

### Alta y bootstrap

- No existe registro público. Un administrador crea una cuenta con nombre, correo, identificador y rol; recibe estado `PENDING_ACTIVATION` y una invitación de un solo uso. La persona fija su propia contraseña y entonces pasa a `ACTIVE` con `email_verified_at` establecido porque consumió el enlace enviado al correo.
- El primer `ADMIN` se crea con un comando CLI de una sola ejecución que solicita usuario/correo y lee la contraseña sin mostrarla ni pasarla en argumentos. Falla si ya existe un administrador activo; no hay cuenta ni contraseña de ejemplo. Su correo queda sin verificar hasta que reciba y consuma un enlace, por lo que la recuperación no se habilita para ese correo antes de verificarlo.
- Roles exactos: `ADMIN` y `SUPPORT`. Estados de cuenta: `PENDING_ACTIVATION`, `ACTIVE` y `DISABLED`.
- **Decisión técnica propuesta tras el builder check:** el nombre de usuario acepta 3–64 caracteres ASCII alfanuméricos, punto, guion o guion bajo; se recorta y convierte a minúsculas antes de guardar/buscar. El correo se recorta y convierte a minúsculas; cada columna tiene unicidad insensible a mayúsculas. El usuario inicia sesión solo con `username`; recuperación se solicita solo con `email`. Al no admitir `@` en `username`, los espacios de nombres no colisionan.
- La administración no puede degradar ni desactivar al último `ADMIN` activo. Toda desactivación o cambio de rol revoca sus sesiones y tokens pendientes.

### Contraseñas y acceso

- Hash Argon2id con salt único generado por la librería; parámetros iniciales propuestos: memoria 19 MiB, 2 iteraciones, paralelismo 1 (mínimo OWASP). Registrar el formato/versionado del hash para permitir migración; medir latencia y memoria antes de producción.
- Contraseña elegida por la persona: mínimo 15 y máximo 128 puntos de código Unicode; aceptar espacios y Unicode, no recortar, no truncar ni imponer reglas de composición o rotación periódica. Bloquear contraseñas comunes/esperadas localmente sin enviar la contraseña a un tercero.
- Login existente, inexistente, deshabilitado o pendiente devuelve el mismo cuerpo y código de credenciales inválidas. Para usuario inexistente también se realiza una verificación Argon2id contra un hash ficticio para reducir diferencias de tiempo. Respuesta de éxito contiene solo `id`, `username`, `displayName` y `role`.

### Sesiones, cookies y CSRF

- Generar 32 bytes aleatorios con `node:crypto`, codificados base64url. Enviar el token solo en cookie y guardar `SHA-256(token)` en `sessions`; jamás persistir el token en claro.
- La selección de cookie y atributos se rige por “Origen público, proxy y cookies”; no se permite que un origen de desarrollo o una cabecera forwarded degrade la configuración de producción.
- Expiración aprobada: 30 minutos de inactividad y 8 horas absolutas. Rotar el identificador al autenticarse. Logout, cambio/restablecimiento de contraseña, desactivación/cambio de rol y revocación administrativa invalidan sesiones; la contraseña propia rota la sesión actual y revoca las demás.
- Cada petición protegida consulta sesión y usuario vigentes en PostgreSQL. No copiar el rol al token; revisar `status` y `role` del usuario en backend para impedir claims obsoletos. Sesión vencida/revocada produce 401 y limpia la cookie.
- Usar el proxy interno de mismo origen, `SameSite=Strict`, token CSRF de doble envío, comprobación exacta de `Origin` y `Sec-Fetch-Site` en toda operación de escritura. CORS se mantiene deshabilitado. No hay excepción para rutas públicas de autenticación.

### Autorización, usuarios y auditoría

- Guard de backend deniega por defecto. `ADMIN` puede listar, invitar, editar, activar/desactivar, restablecer y revocar sesiones de usuarios. La respuesta administrativa puede contener username, correo, estado de verificación, nombre, rol y estado de cuenta, pero nunca hashes, tokens o secretos. `SUPPORT` puede consultar su propia sesión/cambiar su contraseña; recibe 403 en rutas de administración y ese intento queda auditado.
- No exponer `passwordHash`, tokens, cookies o secretos en DTOs. No registrar cuerpos de autenticación. Configurar redacción Pino para claves sensibles y límites explícitos de payload.
- Fastify excluye o redacta cuerpos, parámetros y headers sensibles en rutas de autenticación; los filtros cubren `password`, `currentPassword`, `passwordHash`, tokens, `Cookie`, `Set-Cookie`, `Authorization`, `X-CSRF-Token` y datos SMTP. Nunca se audita un token completo ni una URL de recuperación.
- Registrar inicio de sesión exitoso/fallido, logout, invitación, modificación de usuario/rol/estado, solicitud/finalización de cambio o verificación de correo, solicitud/finalización de recuperación, cambio de contraseña, revocación y denegaciones de autorización. Evento incluye timestamp UTC, requestId, actor/rol si se conocen, objetivo, acción, resultado y categoría redactada; nunca contraseña, token, correo completo ni IP sin minimización.
- Acciones que cambian cuenta y su evento de auditoría se confirman en una transacción. Fallos de login/recovery se auditan como eventos separados, incluso cuando no existe usuario.

### Recuperación y limitación de intentos

- Crear una invitación, recuperación, verificación de correo o cambio de correo genera 32 bytes aleatorios, almacena solo SHA-256 del token, asigna propósito y expiración de 30 minutos, invalida tokens anteriores del mismo propósito y lo envía por el adaptador SMTP. Consumo de un solo uso, cambio de estado/correo, revocación y auditoría se realizan en una transacción. Para cambio de correo se conserva el nuevo correo como pendiente y no sustituye al correo verificado hasta consumir el token correcto; se aplica unicidad transaccional al confirmar.
- `POST /api/v1/auth/password` es un cambio voluntario y exige `currentPassword` más la nueva contraseña; la comparación Argon2id se completa antes de mutar estado. Recuperación e invitación son flujos distintos de restablecimiento y no solicitan la contraseña anterior, porque prueban posesión del token de un solo uso. Los endpoints de cambio voluntario de correo también exigen contraseña actual. Una administración de correo iniciada por ADMIN solo genera solicitud verificable; no marca el nuevo correo como verificado.
- La tabla `users` distingue el correo verificado con `email_verified_at`. La recuperación por correo solo emite mensaje al correo verificado; si el bootstrap inicial dejó el correo sin verificar, el ADMIN usa el endpoint autenticado de cambio de correo con el mismo email actual y contraseña vigente para recibir el enlace de verificación. La activación de invitación verifica el correo al mismo tiempo que activa la cuenta.
- Recuperación e invitación se crean con URL derivada exclusivamente de `PUBLIC_APP_ORIGIN`, con token en el fragmento, por ejemplo `/recover-access/complete#token=<token>`, nunca en query. El documento de esa página establece `Referrer-Policy: no-referrer`, `Cache-Control: no-store` y una CSP sin recursos de terceros; el código cliente lee el fragmento y lo elimina inmediatamente del historial antes de enviar el token por `POST`. No se habilitan analytics, pixel, redirecciones externas ni logging de la URL/cuerpo en esas rutas. Las respuestas no repiten el token. El adaptador SMTP y sus fallos tampoco registran el mensaje o enlace.
- `POST /api/v1/auth/recovery/request` responde siempre `202` con el mismo mensaje, exista o no la cuenta. Nunca devuelve un token. SMTP no configurado o caído no altera el mensaje público; el evento interno registra solo `RECOVERY_DELIVERY_FAILED`. La readiness de producción requiere SMTP válido, por lo que no se puede declarar recuperación lista sin configuración.
- Protección propuesta en PostgreSQL: contador de fallos por identificador normalizado + IP y contador por IP, ventana de 15 minutos; umbrales iniciales 5 por combinación y 20 por IP. Claves se almacenan como HMAC con secreto del servicio, no con identificadores/IP en claro. Al exceder umbral responder 429 genérico para cualquier identificador; no bloquear globalmente una cuenta por intentos ajenos. Éxito reinicia la ventana pertinente. Aplicar límites también a solicitudes de correo.

## API pública propuesta

- `GET /api/v1/auth/csrf`, `POST /api/v1/auth/login` (`username`, `password`), `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`.
- `POST /api/v1/auth/password` (`currentPassword`, `newPassword`), `POST /api/v1/auth/email-change/request` (`currentPassword`, `newEmail`), `POST /api/v1/auth/email-change/complete` (`token`), `POST /api/v1/auth/recovery/request`, `POST /api/v1/auth/recovery/complete`.
- `POST /api/v1/auth/activation/complete` para que una cuenta invitada establezca su primera contraseña.
- `GET|POST /api/v1/admin/users`, `PATCH /api/v1/admin/users/:id` (los cambios de correo se marcan pendientes y requieren verificación), `POST /api/v1/admin/users/:id/reset`, `POST /api/v1/admin/users/:id/email-change`, `POST /api/v1/admin/users/:id/sessions/revoke`.
- Contratos tipados, respuestas estables y sin detalles internos. Mutaciones solo vía `POST`/`PATCH`; errores no incluyen SQL, stack trace, secretos o datos de otra cuenta.

### Invariantes de administradores y transacciones

- La migración crea una fila singleton `auth_invariants(id=1)` que actúa como cerrojo transaccional del conteo de administradores. En transacciones `READ COMMITTED`, bootstrap inicial, alta que pueda crear `ADMIN`, cambio de rol y activación/desactivación de una cuenta `ADMIN` adquieren primero `SELECT ... FOR UPDATE` sobre esa fila; después, en una sentencia posterior, vuelven a consultar los administradores activos y aplican la regla. La fila falta o no puede bloquearse: la operación falla cerrada.
- Ninguna operación de democión/desactivación puede dejar cero `ADMIN` activos. El bootstrap CLI adquiere el mismo cerrojo, consulta estado actual e inserta el primer admin con su hash de contraseña; solicitudes simultáneas se serializan y solo una puede completarse. Evento de auditoría y modificación de usuario comparten transacción. El correo se envía después del commit manteniendo token y mensaje solo en memoria; un fallo se registra sin secreto y permite que un admin vuelva a solicitar el envío.
- Este cerrojo no pretende restringir consultas de lectura. Todas las rutas y el comando bootstrap reutilizan un servicio de dominio/aplicación que impone el orden de bloqueo y evita implementar variantes sin el invariante. La prueba contra PostgreSQL real crea transacciones concurrentes y demuestra que no se puede eliminar el último administrador ni crear dos iniciales.

## Interfaz y Apple Design

- Rutas mínimas: `/login`, `/recover-access`, `/recover-access/complete`, `/profile/password` y `/settings/users`. No crear `/dashboard`.
- Login: tarjeta centrada y breve, marca textual e-Billia, tipografía `system-ui`, jerarquía clara, superficies neutras para claro/oscuro según preferencia local/sistema, sin copiar recursos de Apple. Campos con labels, mensajes en español, foco visible, envío por Enter y error genérico sin enumeración.
- Gestión: tabla/listado comprensible con acción cercana a cada usuario; formularios etiquetados y estados de carga, éxito y error. Acciones destructivas piden confirmación solo al desactivar una cuenta.
- Responsive con reflujo en pantalla angosta, contraste AA, teclado completo, `prefers-reduced-motion` y `prefers-reduced-transparency`. Feedback breve por opacidad/color; sin movimiento decorativo. Comprobar visualmente desktop/móvil, claro/oscuro, teclado/foco y movimiento reducido; registrar lo que no pueda ejecutarse.

## Criterios de aceptación y riesgos

- Tests muestran ADMIN login/gestión; SUPPORT login/cambio propio/403; sesión expirada y revocada deniegan; token vencido o usado no sirve; no hay contraseña/token en respuestas ni logs; cada acción sensible relevante produce auditoría.
- Migraciones aplican y revierten contra PostgreSQL real efímero y aislado; suite de integración confirma SQL, constraints, sesión, transacciones y concurrencia. PGlite sirve solo a simulaciones rápidas cuando su compatibilidad es suficiente. Consultas parametrizadas; CI conserva gates existentes y se ejecutan format, lint, typecheck, tests, build, análisis de secretos y auditorías.
- El canal SMTP y credenciales de servicio no existen en el repositorio. Hasta que el propietario de operación los configure no se prueba entrega real ni se declara recuperación lista para producción.
- El umbral temporal de picomatch permanece exclusivo de desarrollo, revisión 2026-12-10 UTC y vencimiento 2026-12-17 UTC.
- MFA admin sigue pendiente y bloquea producción aunque PS-003 cumpla sus criterios de revisión.

## Fuentes de seguridad consultadas

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): parámetros mínimos Argon2id.
- [NIST SP 800-63B, sección 3.1.1](https://pages.nist.gov/800-63-4/sp800-63b.html): longitud, aceptación de caracteres y ausencia de reglas de composición.
- [NIST SP 800-63B, throttling](https://pages.nist.gov/800-63-4/sp800-63b.html): limitación de intentos en línea.
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): enlaces seguros, no confiar en Host, política `no-referrer`, token robusto y limitación.
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): validación Origin/Fetch Metadata, tokens y prefijo de cookie `__Host-`.
- [Fastify Server — `trustProxy`](https://fastify.dev/docs/latest/Reference/Server/): proxy explícito por IP/CIDR y riesgo de confiar en cabeceras reenviadas o conteos de saltos.
- [Next.js Rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites): proxy URL server-side para el origen único.
- [PostgreSQL Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html): `SELECT FOR UPDATE` para serializar transacciones que modifican el invariante.
- [PGlite](https://pglite.dev/docs/about): motor PostgreSQL embebido útil para simulación; no reemplaza la integración con servidor PostgreSQL real.
- `docs/product/OPEN_DECISIONS.md` VT-08: MFA de administradores antes de producción.
