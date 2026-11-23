# PS-005 — Administración de clientes y conexiones

**Estado:** EN_CURSO · **Base:** `PORTAL_CORE.md`, AP-009..AP-012 y requerimiento del propietario del 2026-11-20.

## Resultado esperado

ADMIN puede registrar y mantener clientes, ambientes SAP y perfiles de conexión autorizados. SUPPORT solo podrá usar las operaciones explícitamente autorizadas por módulo y asignación; nunca administra ni recibe credenciales. Las autorizaciones se vuelven a comprobar en backend en cada solicitud.

## Alcance

- Clientes: alta, consulta, edición y desactivación lógica. Se conserva el identificador y la auditoría.
- Ambientes SAP ligados a un cliente. El código/alias SAP es distinto del entorno de despliegue del perfil (`PRODUCTION`, `TEST` u otro tipo que se apruebe); no se infiere ni se mezcla con el RFC/sociedad de RF-1.
- Perfiles implementados en este alcance: `MYSQL_TCP` y `MYSQL_SSH`, sujetos a pruebas sintéticas de compatibilidad. No se gestionan conexiones SAP; sociedad y ambiente SAP son metadatos consultados desde MySQL. `MYSQL_URL` y `SSH_SERVER` permanecen fuera de alcance.
- Prueba de conexión exclusiva de ADMIN, de solo lectura/no mutante, con límites de tiempo, conexiones y destinos configurados. No se ofrece SQL ni shell libre.
- Auditoría de alta, edición, desactivación, prueba, rotación y fallos sin valores de secretos.

## Contratos y seguridad

- API versionada bajo `/api/v1/admin/clients`; toda escritura usa la protección CSRF ya instalada, sesión vigente y autorización ADMIN en servidor.
- DTOs de respuesta usan allowlist explícita; no incluyen contraseña, URL con credenciales, llave privada, passphrase, certificado cliente ni material descifrado.
- Los errores externos tienen código estable y mensaje español redactado, sin host/puerto/usuario SQL, cadena de conexión, SQL, stack ni credenciales.
- Las entidades tienen estado y borrado lógico; no se permite eliminar físicamente clientes con perfiles o auditoría asociada.
- Las credenciales se guardarán con cifrado autenticado de sobre, con clave fuera de PostgreSQL y Git, versión de clave y procedimiento probado de rotación/revocación. Antes de persistir secretos o habilitar conectores deben aprobarse el proveedor de claves, su operación/rotación y la matriz de datos permitidos/amenazas. El primer incremento no almacena secretos y no abre conexiones de clientes.
- Host SSH debe verificarse por fingerprint configurado. TLS MySQL verifica certificados cuando el perfil lo requiere; nunca degradar TLS o verificación de host para “hacer funcionar” una conexión.
- SSH admite llave privada PEM/OpenSSH o PPK v2 RSA con passphrase opcional, o contraseña SSH. Esta opción de compatibilidad fue aprobada por el propietario el 2026-11-22 y queda desarrollada conforme al addendum de [ADR-0002](../architecture/ADR-0002_CUSTODIA_SECRETOS.md). La interfaz carga archivos `.pem`, `.key` o `.ppk` sin presentar su contenido. PPK v3, DSA y otras variantes se rechazan explícitamente.
- No declarar soporte universal para PEM, OpenSSH o PPK. Cada formato/algoritmo soportado debe pasar fixtures sintéticos y prueba aislada; incompatibilidad falla explícitamente.

## Incremento PS-005.1

Registrar clientes y ambientes SAP en PostgreSQL del Portal, exponer listados y mutaciones ADMIN con auditoría transaccional, e incorporar la pantalla administrativa accesible. El API debe responder 403 a SUPPORT aunque se invoque directamente. No incluye perfiles, credenciales ni conectividad externa.

## Incremento PS-005.2 (posterior a puerta de claves)

Perfiles de conexión, cifrado, reemplazo/rotación de secretos y prueba no mutante mediante `ClientConnectionBroker`. Antes de conectar, completar la matriz VT-11 con destinos de prueba autorizados y demostrar timeouts, cierre de recursos, TLS, fingerprint, límites de pools y redacción.

## Pruebas y límites

- Unitarias para políticas/dominio/cifrado/normalización.
- Integración real en `portal_soporte_test`; PGlite únicamente para simulaciones cuando no sustituya la semántica necesaria de PostgreSQL.
- E2E sintético para rutas administrativas, roles y estados de interfaz; accesibilidad por teclado, foco, responsive, tema claro/oscuro y movimiento reducido.
- Ninguna base MySQL de cliente, servidor cliente, `portal_soporte` persistente o servicio compartido se usa como fixture de prueba.
- Migraciones reversibles/documentadas y probadas contra el destino aislado antes de cualquier solicitud de aprobación para una base permanente.

## Actualización PS-005.2 — Custodia y conectores

- **Estado de diseño:** decisión técnica registrada en [ADR-0002](../architecture/ADR-0002_CUSTODIA_SECRETOS.md); cifrado/envoltura versionados, proveedor recuperable fuera de PostgreSQL/Git, rotación y controles de acceso a archivo son requisitos del incremento.
- El llavero se configura mediante ruta absoluta protegida, no con la clave en variables de entorno. El arranque y las operaciones fallan cerrados si el llavero está ausente, el propietario/permisos no coinciden, la versión de clave no está disponible o la autenticación del sobre falla. El formato operativo y recuperación se describen en [KEYRING_RECOVERY.md](../operations/KEYRING_RECOVERY.md).
- Los secretos por perfil se cifran como un paquete JSON limitado; la API solo recibe valores en operaciones de escritura y nunca devuelve el paquete en claro. Las lecturas usan allowlists sin columnas cifradas. Registro de auditoría contiene acción, actor, perfil, resultado y correlación, nunca valores secretos.
- Para MySQL, el único sondeo de conectividad es `SELECT 1`, una conexión a la vez, timeout acotado y cierre garantizado. TLS usa validación de certificado; no existe opción para ignorar errores TLS. En SSH se verifica la huella configurada y se permite únicamente un forward al destino MySQL exacto autorizado, sin shell ni agente.
- La modalidad SSH se selecciona explícitamente entre contraseña y llave privada. Ambos secretos solo se reciben al guardar o reemplazar credenciales, se cifran antes de persistirse y nunca se recuperan para la interfaz; el selector de llave acepta `.pem`, `.key` y `.ppk` y muestra únicamente el nombre del archivo.
- Host/puerto/fingerprint deben pertenecer a allowlist operacional explícita fuera del request/DB. La resolución se fija a IP validada para impedir DNS rebinding; no se siguen redirecciones ni se aceptan URLs arbitrarias.
- No se crea un llavero de producción ni se guardan secretos de clientes en este incremento sin una copia de recuperación independiente probada. Conectividad efectiva requiere fixture MySQL aislado; la ausencia de ese fixture se registra como `NO EJECUTADO`, no como PASS. RF-1 puede iniciar parser/preview con fixtures sintéticos cuando el contrato del broker exista; inserción permanece separada y bloqueada por VT-01..VT-09.

## Ajuste de interfaz de conexión — 2026-11-23

- ADMIN configura el perfil con campos `MySQL Hostname` y `MySQL Port`; para `MYSQL_SSH` también `SSH Hostname` y `SSH Port`, además de las credenciales propias de cada capa. La interfaz y el contrato HTTP no solicitan IDs opacos de destinos.
- El backend compara exactamente hostname y puerto con la política operacional cargada fuera de PostgreSQL y del request. Solo después de una coincidencia única convierte el endpoint a su referencia interna ya persistida. Los DTOs ADMIN exponen hostname/puerto, nunca las referencias internas, la dirección IP fijada ni fingerprints.
- Un endpoint no configurado o ambiguo se rechaza antes de cifrar o persistir credenciales. La conexión sigue fijada a la IP validada por operaciones, con verificación TLS/fingerprint y sin resolución DNS controlada por el navegador. No se habilitan destinos arbitrarios ni se requieren cambios de esquema.
- Esta presentación se basa en los campos habituales de Workbench y no implica que el Portal deba tener la misma libertad de red: el broker del Portal mantiene su política de destinos, timeouts, operaciones permitidas y auditoría.
