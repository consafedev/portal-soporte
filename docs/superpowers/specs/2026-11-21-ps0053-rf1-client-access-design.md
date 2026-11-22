# Diseño PS-005.3 / PS-007 / PS-008 — Acceso por cliente y vista previa RF-1

| Campo | Estado |
|---|---|
| Fecha | 2026-11-21 |
| Estado | DISEÑO TÉCNICO APROBADO POR EL PROPIETARIO EL 2026-11-21; builder check sin preguntas importantes pendientes. |
| Tareas | PS-005.3 · PS-007/RF-1 · PS-008 (pantalla de vista previa solicitada en la entrega). |
| Rama/base | `codex/rf-1-preview-post-ps005` · base `8f4d4ba6ef88cae3873fff9be7143a95f93f9b07` · cambios parser locales preservados. |
| Límite | Esta propuesta no autoriza INSERT RF-1, acceso a BD de clientes, migración productiva, despliegue, Cloudflare/DNS, firewall ni servicios ajenos. |

**Decisión de producto aprobada por el propietario:** ADMIN administra. SUPPORT utiliza exclusivamente recursos de clientes asignados y capacidades habilitadas. Cada solicitud backend comprueba sesión/rol, cliente, perfil/conexión y capacidad actual; la revocación se aplica en la siguiente petición. La vista previa y la ejecución de escrituras son capacidades distintas. Las credenciales y llaves no se muestran en texto plano a ningún rol.

**Referencias:** `AGENTS.md`; `docs/product/DECISIONS_APPROVED.md`; `docs/product/OPEN_DECISIONS.md`; `docs/specs/PORTAL_CORE.md`; `docs/specs/RF-1_INSERTAR_FACTURAS_BD.md`; `docs/specs/RF-1_LOOKUP_RULES.md`; `docs/specs/RF-1_FIELD_MAPPING.md`; `docs/architecture/ADR-0002_CUSTODIA_SECRETOS.md`; `docs/standards/CLEAN_CODE.md`; `.agents/skills/apple-design/SKILL.md`.

## Propósito

Completar la custodia de perfiles de conexión conforme a ADR-0002 y llevar RF-1 desde el parser/preview de dominio ya iniciado hasta una vista previa utilizable por ADMIN y por SUPPORT con acceso explícito por cliente. El backend ofrece exclusivamente consultas MySQL de lectura tipadas y permitidas. La interfaz carga CFDI en memoria y devuelve una fila por archivo; no persiste el XML, no confirma ni ejecuta una inserción.

## Objetivos

- Habilitar a ADMIN para gestionar clientes, ambientes, conexiones, asignaciones y capacidades; permitirle usar la vista previa RF-1.
- Permitir a SUPPORT listar y utilizar únicamente clientes asignados, conexiones activas pertenecientes a esos clientes y capacidades habilitadas.
- Registrar asignación, revocación, cambios de capacidades, denegaciones y vistas previas en auditoría sin secretos, SQL ni XML completo.
- Revalidar identidad, cliente, conexión y capacidad en cada solicitud. No guardar autorizaciones de cliente en la sesión ni en caché de larga vida.
- Resolver sociedades, proveedores y UUID duplicado mediante consultas semánticas, parametrizadas, limitadas y fijas dentro de `ClientConnectionBroker`.
- Mantener el parser CFDI 4.0 `I`, lotes con resultados independientes, límites de tamaño y acción de inserción ausente/deshabilitada.
- Activar el keyring solo después de verificar que no hay sobres dependientes de una llave desconocida y probar una copia cifrada recuperable fuera del servidor.

## Fuera de alcance

- Ejecutar INSERT, transacciones de factura, confirmación contable, reintentos o modificación de registros externos.
- Usar credenciales, XML, datos o DDL de clientes reales. El esquema MySQL sintético se deriva del mapeo aprobado solo para comprobar consultas y tipos del fixture; no certifica compatibilidad con instalaciones de clientes.
- Implementar una plataforma genérica de permisos, un catálogo dinámico de módulos, políticas arbitrarias desde PostgreSQL o capacidades editables desde texto libre. La integración futura con PS-006 usará IDs de capacidades tipados y los guardas públicos.
- Cambiar las migraciones 0004/0005/0006 aplicadas, el ledger, tablas de clientes, servicios ajenos, Cloudflare, DNS o firewall.
- Implementar una interfaz para mostrar o exportar secretos, PPK v3/DSA, SMTP o MFA.

## Enfoques considerados

1. **RF-1 solo ADMIN en esta entrega.** No requiere alcance por cliente, pero impide que SUPPORT utilice la operación solicitada y posterga una necesidad funcional actual. Se descarta.
2. **Asignación persistente usuario-cliente y capacidades conocidas por cliente.** PostgreSQL del Portal es la fuente vigente de concesión/revocación; los IDs de capacidades se definen estáticamente en contratos/core y se pueden consumir desde el futuro catálogo PS-006. Es el enfoque aprobado por el propietario. Añade migración aditiva y pruebas de autorización inmediatas, sin crear un motor genérico.
3. **Motor dinámico completo de módulos/permisos.** Permitiría administrar nuevos tipos de capacidades sin código, pero duplicaría PS-006, ampliaría superficie y complejidad antes de necesitarla. Se descarta; el diseño reserva compatibilidad mediante IDs y un `CapabilityGuard` pequeño.

Para MySQL también se comparó SQL arbitrario frente a métodos semánticos fijos: solo se admite lo segundo. El frontend nunca envía SQL ni nombres de tabla/columna. La configuración persistente de destinos continúa fuera de las peticiones según ADR-0002.

## Modelo de autorización propuesto

El esquema `portal` recibe una migración nueva, siguiente al ledger vigente (propuesta `0007`); no editar ni regenerar migraciones existentes.

### Asignaciones

`client_user_assignments` conserva concesiones y revocaciones:

- `id` UUID primario; `client_id` y `user_id` con FKs `ON DELETE RESTRICT`.
- `granted_by_user_id`, `granted_at`; `revoked_by_user_id`, `revoked_at` para conservar la evidencia de ciclo de vida.
- Índice único parcial para una sola asignación activa por `(client_id, user_id)`; revocar completa el registro y una concesión posterior crea una fila nueva.
- Solo se asignan usuarios SUPPORT; ADMIN conserva alcance global por rol y no depende de filas de asignación.
- El administrador concede/revoca. No hay asignación automática ni valor predeterminado para SUPPORT; las cuentas inactivas y clientes desactivados siempre se deniegan.

### Capacidades por cliente

`client_capabilities` mantiene el estado permitido de capacidades explícitas, con clave `(client_id, capability_id)`, `enabled`, actor y timestamp de última modificación. Solo el backend acepta IDs que existen en su contrato estático; IDs desconocidos se deniegan y no se ejecuta lógica cargada desde base de datos.

- `rf-1:read`: habilita preview y consultas de catálogo. ADMIN también debe comprobar cliente activo y esta capacidad; SUPPORT requiere además asignación vigente.
- `rf-1:execute`: representa una puerta independiente para la futura escritura. En esta entrega permanece siempre deshabilitada y sin operaciones, incluso si se solicita cambiar su estado; no se crea endpoint de ejecución ni se concede dicho permiso implícitamente.
- El catálogo futuro PS-006 podrá consumir esos IDs y presentar administración/visibilidad de módulos sin una tabla de manifests duplicada. La pantalla de esta entrega no cambia el estado global del catálogo.

ADMIN mantiene alcance global para administrar clientes, asignaciones y capacidades, pero cada operación RF-1 requiere un cliente activo y `rf-1:read` habilitada. SUPPORT requiere simultáneamente cuenta activa, asignación no revocada, cliente activo, capacidad habilitada y, para una conexión, perfil activo perteneciente al mismo `client_id`. `rf-1:execute` no se puede activar ni utilizar en esta entrega.

Toda escritura administrativa de asignación/capacidad se valida con rol ADMIN y CSRF en API, se ejecuta en transacción junto con el evento de auditoría y devuelve solo el estado público. Cada petición de SUPPORT comprueba la sesión vigente y consulta la asignación/capacidad actual; revocar en PostgreSQL bloquea la próxima operación sin que se requiera logout.

## Contratos y arquitectura

Capas previstas: contratos tipados y dominio RF-1 puro; servicio de aplicación de autorización/vista previa; repositorios PostgreSQL y guardas de permisos; adapter de catálogo RF-1 que utiliza `ClientConnectionBroker`; Fastify same-origin y React/Next.js.

### Autorización backend

- Añadir un servicio/puerto pequeño para administrar asignaciones/capacidades y resolver `exigirAccesoCliente(actor, clientId, capabilityId)`. El guard recibe IDs validados y consulta estado actual; no confía en role/client/profile/environment enviados como prueba de autorización.
- ADMIN CRUD permanece admin-only. SUPPORT dispone de endpoints de lectura para sus clientes, entornos y perfiles redactados, y de `POST /api/v1/modules/rf-1/preview` con `rf-1:read`.
- Verificar que `connectionProfileId` pertenezca al cliente autorizado, esté activo y sea del tipo compatible. El entorno operativo `PRODUCTION/TEST` proviene del perfil; nunca se confunde con `sap_sociedad.ambienteSap`.
- La solicitud de preview no acepta `database`, hostname, destino, credenciales, SQL ni selección libre de entorno. El backend carga perfil/cliente autorizados y resuelve destino desde la allowlist operacional.
- `401` indica falta de sesión; `403` deniega rol, asignación, capacidad o el intento de usar un perfil que pertenece a otro cliente. Un identificador ajeno no permite consultar ni abrir el broker. Errores externos quedan redactados y estables.

### Broker de lectura

El puerto público de `ClientConnectionBroker` se amplía de manera aditiva con una sesión de lectura RF-1 limitada, abierta desde el servicio de perfiles solo después de autorizar cliente y perfil. La sesión expone métodos de dominio para:

1. Buscar sociedades por RFC receptor y devolver pares de sociedad/ambiente SAP limitados.
2. Buscar proveedores por RFC emisor + sociedad + ambiente SAP exactos, devolviendo hasta dos candidatos para diferenciar ausencia, único y ambigüedad; nunca elegir el primero.
3. Comprobar existencia de factura por UUID en la base seleccionada. No usar filtros de vigencia adicionales.

El adapter MySQL contiene las consultas preparadas y columnas fijas conforme a `RF-1_LOOKUP_RULES.md` y `RF-1_FIELD_MAPPING.md`. Límite de resultados, timeout de conexión/consulta, máximo de una sesión por preview y cierre `finally`/abort garantizado. No se exporta un objeto `query(sql)` ni se interpolan identificadores provenientes del usuario. Un fallo de catálogo produce `RF1_CATALOG_UNAVAILABLE`, no una respuesta de no existencia.

El contrato RF-1 existente `CatalogoLecturaRf1` permanece en el dominio; un adapter de aplicación lo satisface sin que el módulo conozca credenciales, tablas de PostgreSQL o detalles privados del broker. Las consultas reales se prueban solo contra tablas/filas sintéticas.

## Flujo de vista previa

1. La persona selecciona cliente autorizado y perfil activo; la API revalida relación y capacidad.
2. Se acepta 1–100 archivos XML, máximo 5 MiB por archivo y 25 MiB agregados; extensión no sustituye la validación de contenido.
3. Los bytes se procesan en memoria mediante parser seguro existente; no se almacenan ni registran. DTD/entidades externas están rechazadas, se limita estructura y se devuelve error estable por archivo.
4. La vista previa resuelve sociedad por RFC receptor. Si hay varias opciones reales, la respuesta solicita selección explícita; una nueva petición vuelve a validar la elección dentro del cliente/perfil. Una sola sociedad inequívoca se selecciona automáticamente. Sociedad duplicada indistinguible bloquea.
5. Proveedor se busca por RFC emisor, `sociedad` y `ambienteSap` de la sociedad elegida. La existencia cuenta como activa; no se lee `marcado_borrado` ni `contabilizar`. Proveedor faltante/ambiguo bloquea solo la fila.
6. El UUID se comprueba en la tabla fija `factura`; si existe, la fila indica `YA_EXISTE` y no se modifica.
7. Se devuelve una fila por archivo con UUID, RFC emisor/receptor, sociedad/ambiente, proveedor, duplicidad, estado solicitado `CONTABILIZADO`/`PAGADA`, validaciones y errores bloqueantes. Si el estado se elige en UI, el backend valida una enumeración cerrada. La combinación `rf-1:read` no da `rf-1:execute`.

RF-1 conserva la extracción decimal exacta, no repara bytes/BOM ni recalcula `Total`, y no promete validación SAT. Los campos complementarios editables de factura y los mapeos incompletos de escritura quedan fuera de esta vista previa si no son necesarios para comprobar sociedad/proveedor/duplicado.

## Custodia y conectividad PS-005.3

- Antes de generar/rotar claves, un preflight read-only verifica la ruta de keyring, versión activa y número de sobres de perfiles sin leerlos ni revelar valores. Si hay sobres y falta una clave referenciada, detenerse; nunca reemplazar ni regenerar.
- Si no existen sobres ni keyring, generar una llave versionada CSPRNG de 256 bits en el servidor; archivo absoluto separado de PostgreSQL, regular/no symlink, root:grupo de servicio `0640`, directorio root:grupo `0750`, conforme a ADR-0002. La aplicación no crea el archivo al arrancar.
- Producir un artefacto de recuperación cifrado AES-256 fuera del servidor y del repositorio. La frase de recuperación se captura solo mediante prompt seguro/local, nunca argv/env/log/chat, y queda bajo custodia separada del propietario en su gestor de secretos/medio offline. El flujo debe descifrar a un destino temporal restringido y verificar bytes/versión con resultado booleano, limpiar temporales y no imprimir material.
- Activar `PORTAL_MASTER_KEYRING_PATH` y reiniciar solo las unidades propias del Portal después de probar encrypt/decrypt/AAD con un sobre sintético, incluyendo versión y restauración de la copia. Si falla recuperabilidad, no activar descifrado de sobres persistidos.
- Las pruebas MySQL TCP y SSH PEM viven en el fixture CI desechable: allowlist de destino, TLS `rejectUnauthorized`, fingerprint, `PermitOpen`, timeout, cancelación/cierre; query de prueba exclusivamente `SELECT 1`. Luego el broker RF-1 ejecuta las lecturas fijas sobre el esquema MySQL sintético. No se utilizan conexiones/secretos de clientes.
- PPK v2 RSA conserva solamente soporte ya probado; la interfaz indica el alcance y rechaza variantes no soportadas sin bloquear el flujo TCP/PEM.

## UI/UX

La administración se integra en las pantallas actuales de clientes/conexiones: asignación de usuarios SUPPORT y toggle explícito por cliente para preview (`rf-1:read`); inserción (`rf-1:execute`) permanece apagada y sin acción ejecutable. La pantalla RF-1 se presenta dentro del shell autenticado existente con:

- Cliente y perfil/entorno, señalando claramente PRUEBAS o PRODUCCIÓN.
- Selector múltiple/arrastrar para XML, contador y límites; opción explícita de analizar.
- Estado de proceso y tabla simple por factura, con resultado, sociedad/proveedor, UUID y causas accionables; selección explícita por fila si hay más de una sociedad.
- Aviso persistente de «Solo vista previa; no se modifica la base» y ninguna acción de insertar.
- Errores, vacíos, carga y ausencia de permisos explicados en español sin datos de conexión.

Apple Design: simplicidad centrada en la tarea, jerarquía tipográfica de sistema, feedback inmediato/estados explícitos, selección/control directo, tema claro/oscuro existente, layout adaptable y movimiento reducido. No agregar motion decorativo ni materiales que reduzcan contraste. Evidencia visual pendiente hasta el implementation prototype; verificar teclado/focus y lectores de pantalla, viewport escritorio/móvil, temas y `prefers-reduced-motion`.

## Pruebas de aceptación

- Migración aditiva probada en PostgreSQL aislado real; PGlite solo para simulación rápida donde aplique, nunca como sustituto de la integración real.
- SUPPORT autorizado con asignación activa y `rf-1:read` obtiene preview en el cliente asignado; sin asignación, revocado, cliente desactivado o capacidad apagada recibe `403` con respuesta uniforme que no revela si el recurso existe.
- Revocar asignación o capacidad, y enviar una petición posterior con la misma cookie, deniega inmediatamente. No depende de nueva autenticación.
- SUPPORT no puede gestionar clientes, ambientes, conexiones, asignaciones, credenciales ni caps; no aparece material secreto en JSON/logs/errores.
- connectionId de otro cliente, clientId manipulado o environmentId no perteneciente no abre acceso al broker.
- `rf-1:read` no concede `rf-1:execute`; ningún endpoint de escritura está registrado en esta entrega.
- ADMIN administra clientes/perfiles/asignaciones y utiliza RF-1; auditoría transaccional registra concesión, revocación, cambios de capacidad, denegaciones y preview sin cuerpo XML.
- MySQL TCP y SSH PEM sintéticos prueban consultas preparadas, casos L-01..L-10, UUID duplicado, ausencia/ambigüedad, múltiples ambientes, timeouts y cierre. No pruebas con clientes.
- UI: escritorio, móvil, claro/oscuro, teclado/focus y `prefers-reduced-motion`; tests E2E con usuarios, clientes y XML sintéticos.
- `lint`, typecheck, unitarias, integración PostgreSQL/MySQL, E2E, build, formato y escaneo de secretos; ningún skip no esperado.

## Despliegue, rollback y gates

- Crear una migración Drizzle nueva, revisar el SQL y probarla en `portal_soporte_test`; el ledger y migraciones 0004–0006 permanecen intactos. No aplicar en `portal_soporte` durante esta entrega local.
- Aislar los commits de parser, broker/fixture, autorización/migración, UI y documentación sin secretos. Abrir PR separado contra `main`; publicar la rama solo cuando checks finales estén verdes. El propietario hace el merge manual.
- La migración 0007 es aditiva; rollback de aplicación vuelve al release previo sin bajar columnas/tablas ni borrar asignaciones. Una reversión de esquema exige respaldo y autorización separada, no forma parte de rollback normal.
- No despliegue en esta fase. Tras merge, requerir revisión de migración, backup/restore según política y autorización antes de aplicarla en PostgreSQL persistente; comprobar compatibilidad de runtime y rollback.
- VT-01, VT-02, VT-03, VT-05, VT-06, VT-07, VT-08, VT-09, VT-11 y VT-12 siguen bloqueando inserciones reales o producción aunque la vista previa sintética pase.

## Riesgos y decisiones que conserva

- Las columnas/tablas RF-1 provienen del mapeo/capturas; probar con fixture no valida DDL real, collation ni triggers de clientes. Se requiere evidencia read-only autorizada antes de fase transaccional.
- El acceso a MySQL `factura` podría carecer de permiso `SELECT`; el resultado será error de catálogo, jamás «no duplicado».
- El archivo de recuperación del keyring puede perderse; el feature queda cerrado si la prueba de restauración no funciona.
- MFA continúa fuera por AP-013; SMTP y Cloudflare Access continúan deshabilitados/excluidos. UFW actual no se cambia.
- `esbuild` moderado y seguimiento temporal de `picomatch` conservan sus fechas en `DEPENDENCY_SECURITY.md`; PPK v3/DSA siguen sin soporte.

## Revisión

El builder check no encontró preguntas importantes pendientes. La decisión funcional de acceso SUPPORT por cliente/capacidad está cerrada; si una incompatibilidad técnica exige cambiarla, detener ese cambio y documentar la causa. Hasta aprobación de este documento no se modifica código.
