# Diseño PS-003 — Autenticación y gestión de usuarios

| Campo | Estado |
|---|---|
| Fecha | 2026-11-17 |
| Estado | Propuesta para revisión del propietario; no autoriza todavía la implementación. |
| Aprobación de enfoque | El propietario confirmó redactar la propuesta con sesiones opacas en PostgreSQL, Argon2id y un adaptador SMTP configurable. |
| Límite de autorización | PS-003 está autorizada para iniciar; el propietario aún debe aprobar este documento antes de escribir código de aplicación. |
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

1. **Sesiones opacas en PostgreSQL (seleccionado para esta propuesta).** Token aleatorio de alta entropía en cookie y solo su hash en PostgreSQL. Facilita revocación inmediata, cierre en todos los dispositivos y validación del estado vigente del usuario; corresponde a `PORTAL_CORE.md` §3 y §4. Argon2id protege contraseñas; SMTP configurable transporta invitaciones y recuperación.
2. **JWT autocontenido con tokens de renovación.** Reduce lecturas de sesión, pero requiere una lista de revocación o versiones de credencial para cumplir la revocación inmediata. Añade mecanismos sin beneficio claro en este portal interno.
3. **Sesiones en memoria de proceso.** Menor costo inicial, pero no sobreviven reinicios ni permiten varias instancias con revocación consistente. No satisface los requisitos de PostgreSQL y control server-side.

El propietario confirmó el enfoque 1 como base para preparar esta propuesta. Los valores y reglas de implementación debajo siguen sujetos a revisión del documento.

## Arquitectura propuesta

- **Contratos:** esquemas de entrada/salida y tipos compartidos en `packages/contracts`, validados en runtime con TypeBox/JSON Schema.
- **Dominio y aplicación:** reglas puras, casos de uso y puertos en `packages/core`; el dominio no importa Fastify ni Drizzle.
- **Infraestructura/API:** `apps/api` conecta Fastify, Drizzle/PostgreSQL, Argon2id, correo SMTP y auditoría. Fastify es el único backend con autoridad; ninguna lógica de permisos depende de la UI.
- **Presentación:** `apps/web` usa Next.js para páginas del login, recuperación, cambio de contraseña y administración de usuarios. Las peticiones a Fastify envían cookies con credenciales habilitadas.
- **Persistencia:** migraciones Drizzle del portal en `apps/api/drizzle/`. Tablas previstas: `users`, `sessions`, `recovery_tokens`, `auth_throttle_windows` y `audit_events`. No se ejecutan migraciones fuera de la BD del portal.
- **Pruebas:** dominio con Vitest; API con `fastify.inject`; integración de migraciones y operaciones contra una instancia PostgreSQL aislada en memoria (propuesta: PGlite, sin Docker); UI con flujos de navegador y cuentas sintéticas.

## Flujos y reglas

### Alta y bootstrap

- No existe registro público. Un administrador crea una cuenta con nombre, correo, identificador y rol; recibe estado `PENDING_ACTIVATION` y una invitación de un solo uso. La persona fija su propia contraseña y entonces pasa a `ACTIVE`.
- El primer `ADMIN` se crea con un comando CLI de una sola ejecución que solicita usuario/correo y lee la contraseña sin mostrarla ni pasarla en argumentos. Falla si ya existe un administrador activo; no hay cuenta ni contraseña de ejemplo.
- Roles exactos: `ADMIN` y `SUPPORT`. Estados de cuenta: `PENDING_ACTIVATION`, `ACTIVE` y `DISABLED`.
- **Decisión técnica propuesta tras el builder check:** el nombre de usuario acepta 3–64 caracteres ASCII alfanuméricos, punto, guion o guion bajo; se recorta y convierte a minúsculas antes de guardar/buscar. El correo se recorta y convierte a minúsculas; cada columna tiene unicidad insensible a mayúsculas. El usuario inicia sesión solo con `username`; recuperación se solicita solo con `email`. Al no admitir `@` en `username`, los espacios de nombres no colisionan.
- La administración no puede degradar ni desactivar al último `ADMIN` activo. Toda desactivación o cambio de rol revoca sus sesiones y tokens pendientes.

### Contraseñas y acceso

- Hash Argon2id con salt único generado por la librería; parámetros iniciales propuestos: memoria 19 MiB, 2 iteraciones, paralelismo 1 (mínimo OWASP). Registrar el formato/versionado del hash para permitir migración; medir latencia y memoria antes de producción.
- Contraseña elegida por la persona: mínimo 15 y máximo 128 puntos de código Unicode; aceptar espacios y Unicode, no recortar, no truncar ni imponer reglas de composición o rotación periódica. Bloquear contraseñas comunes/esperadas localmente sin enviar la contraseña a un tercero.
- Login existente, inexistente, deshabilitado o pendiente devuelve el mismo cuerpo y código de credenciales inválidas. Para usuario inexistente también se realiza una verificación Argon2id contra un hash ficticio para reducir diferencias de tiempo. Respuesta de éxito contiene solo `id`, `username`, `displayName` y `role`.

### Sesiones, cookies y CSRF

- Generar 32 bytes aleatorios con `node:crypto`, codificados base64url. Enviar el token solo en cookie y guardar `SHA-256(token)` en `sessions`; jamás persistir el token en claro.
- Cookie de producción `__Host-portal_session; Secure; HttpOnly; SameSite=Strict; Path=/`, sin `Domain`. En desarrollo local HTTP se permite cookie sin `Secure` solo con `NODE_ENV=development`; configuración de producción falla si `Secure` está desactivado.
- Duración propuesta: 30 minutos de inactividad y 8 horas absolutas. Rotar el identificador al autenticarse. Logout, cambio/restablecimiento de contraseña, desactivación/cambio de rol y revocación administrativa invalidan sesiones; la contraseña propia rota la sesión actual y revoca las demás.
- Cada petición protegida consulta sesión y usuario vigentes en PostgreSQL. No copiar el rol al token; revisar `status` y `role` del usuario en backend para impedir claims obsoletos. Sesión vencida/revocada produce 401 y limpia la cookie.
- Usar `SameSite=Strict`, CORS con origen exacto configurable y comprobación del encabezado `Origin` en toda operación de escritura. Producción debe alojar web y API bajo el mismo site; si eso no se cumple, revisar estrategia CSRF antes del despliegue.

### Autorización, usuarios y auditoría

- Guard de backend deniega por defecto. `ADMIN` puede listar, invitar, editar, activar/desactivar, restablecer y revocar sesiones de usuarios. `SUPPORT` puede consultar su propia sesión/cambiar su contraseña; recibe 403 en rutas de administración y ese intento queda auditado.
- No exponer `passwordHash`, tokens, cookies o secretos en DTOs. No registrar cuerpos de autenticación. Configurar redacción Pino para claves sensibles y límites explícitos de payload.
- Registrar inicio de sesión exitoso/fallido, logout, invitación, modificación de usuario/rol/estado, solicitud y finalización de recuperación, cambio de contraseña, revocación y denegaciones de autorización. Evento incluye timestamp UTC, requestId, actor/rol si se conocen, objetivo, acción, resultado y categoría redactada; nunca contraseña, token, correo completo ni IP sin minimización.
- Acciones que cambian cuenta y su evento de auditoría se confirman en una transacción. Fallos de login/recovery se auditan como eventos separados, incluso cuando no existe usuario.

### Recuperación y limitación de intentos

- Crear una invitación o recuperación genera 32 bytes aleatorios, almacena solo SHA-256 del token, asigna propósito y expiración de 30 minutos, invalida tokens anteriores del mismo usuario y lo envía por el adaptador SMTP. Consumo de un solo uso y cambio de contraseña/revocación se realizan en una transacción.
- `POST /api/v1/auth/recovery/request` responde siempre `202` con el mismo mensaje, exista o no la cuenta. Nunca devuelve un token. SMTP no configurado o caído no altera el mensaje público; el evento interno registra solo `RECOVERY_DELIVERY_FAILED`. La readiness de producción requiere SMTP válido, por lo que no se puede declarar recuperación lista sin configuración.
- Protección propuesta en PostgreSQL: contador de fallos por identificador normalizado + IP y contador por IP, ventana de 15 minutos; umbrales iniciales 5 por combinación y 20 por IP. Claves se almacenan como HMAC con secreto del servicio, no con identificadores/IP en claro. Al exceder umbral responder 429 genérico para cualquier identificador; no bloquear globalmente una cuenta por intentos ajenos. Éxito reinicia la ventana pertinente. Aplicar límites también a solicitudes de correo.

## API pública propuesta

- `POST /api/v1/auth/login` (`username`, `password`), `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`.
- `POST /api/v1/auth/password`, `POST /api/v1/auth/recovery/request`, `POST /api/v1/auth/recovery/complete`.
- `POST /api/v1/auth/activation/complete` para que una cuenta invitada establezca su primera contraseña.
- `GET|POST /api/v1/admin/users`, `PATCH /api/v1/admin/users/:id`, `POST /api/v1/admin/users/:id/reset`, `POST /api/v1/admin/users/:id/sessions/revoke`.
- Contratos tipados, respuestas estables y sin detalles internos. Mutaciones solo vía `POST`/`PATCH`; errores no incluyen SQL, stack trace, secretos o datos de otra cuenta.

## Interfaz y Apple Design

- Rutas mínimas: `/login`, `/recover-access`, `/recover-access/complete`, `/profile/password` y `/settings/users`. No crear `/dashboard`.
- Login: tarjeta centrada y breve, marca textual e-Billia, tipografía `system-ui`, jerarquía clara, superficies neutras para claro/oscuro según preferencia local/sistema, sin copiar recursos de Apple. Campos con labels, mensajes en español, foco visible, envío por Enter y error genérico sin enumeración.
- Gestión: tabla/listado comprensible con acción cercana a cada usuario; formularios etiquetados y estados de carga, éxito y error. Acciones destructivas piden confirmación solo al desactivar una cuenta.
- Responsive con reflujo en pantalla angosta, contraste AA, teclado completo, `prefers-reduced-motion` y `prefers-reduced-transparency`. Feedback breve por opacidad/color; sin movimiento decorativo. Comprobar visualmente desktop/móvil, claro/oscuro, teclado/foco y movimiento reducido; registrar lo que no pueda ejecutarse.

## Criterios de aceptación y riesgos

- Tests muestran ADMIN login/gestión; SUPPORT login/cambio propio/403; sesión expirada y revocada deniegan; token vencido o usado no sirve; no hay contraseña/token en respuestas ni logs; cada acción sensible relevante produce auditoría.
- Migraciones aplican y revierten en BD aislada; consultas son parametrizadas; CI conserva gates existentes y se ejecutan format, lint, typecheck, tests, build, análisis de secretos y auditorías.
- El canal SMTP y credenciales de servicio no existen en el repositorio. Hasta que el propietario de operación los configure no se prueba entrega real ni se declara recuperación lista para producción.
- El umbral temporal de picomatch permanece exclusivo de desarrollo, revisión 2026-12-10 UTC y vencimiento 2026-12-17 UTC.
- MFA admin sigue pendiente y bloquea producción aunque PS-003 cumpla sus criterios de revisión.

## Fuentes de seguridad consultadas

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): parámetros mínimos Argon2id.
- [NIST SP 800-63B, sección 3.1.1](https://pages.nist.gov/800-63-4/sp800-63b.html): longitud, aceptación de caracteres y ausencia de reglas de composición.
- [NIST SP 800-63B, throttling](https://pages.nist.gov/800-63-4/sp800-63b.html): limitación de intentos en línea.
- `docs/product/OPEN_DECISIONS.md` VT-08: MFA de administradores antes de producción.
