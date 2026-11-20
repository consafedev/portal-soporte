# PS-005 — Administración de clientes y conexiones

**Estado:** EN_CURSO · **Base:** `PORTAL_CORE.md`, AP-009..AP-012 y requerimiento del propietario del 2026-11-20.

## Resultado esperado

ADMIN puede registrar y mantener clientes, ambientes SAP y perfiles de conexión autorizados. SUPPORT solo podrá usar las operaciones explícitamente autorizadas por módulo y asignación; nunca administra ni recibe credenciales. Las autorizaciones se vuelven a comprobar en backend en cada solicitud.

## Alcance

- Clientes: alta, consulta, edición y desactivación lógica. Se conserva el identificador y la auditoría.
- Ambientes SAP ligados a un cliente. El código/alias SAP es distinto del entorno de despliegue del perfil (`PRODUCTION`, `TEST` u otro tipo que se apruebe); no se infiere ni se mezcla con el RFC/sociedad de RF-1.
- Perfiles previstos: `MYSQL_TCP`, `MYSQL_URL`, `MYSQL_SSH` y `SSH_SERVER`, sujetos a pruebas de compatibilidad por tipo, TLS, autenticación, algoritmos de llave y versiones PPK.
- Prueba de conexión exclusiva de ADMIN, de solo lectura/no mutante, con límites de tiempo, conexiones y destinos configurados. No se ofrece SQL ni shell libre.
- Auditoría de alta, edición, desactivación, prueba, rotación y fallos sin valores de secretos.

## Contratos y seguridad

- API versionada bajo `/api/v1/admin/clients`; toda escritura usa la protección CSRF ya instalada, sesión vigente y autorización ADMIN en servidor.
- DTOs de respuesta usan allowlist explícita; no incluyen contraseña, URL con credenciales, llave privada, passphrase, certificado cliente ni material descifrado.
- Los errores externos tienen código estable y mensaje español redactado, sin host/puerto/usuario SQL, cadena de conexión, SQL, stack ni credenciales.
- Las entidades tienen estado y borrado lógico; no se permite eliminar físicamente clientes con perfiles o auditoría asociada.
- Las credenciales se guardarán con cifrado autenticado de sobre, con clave fuera de PostgreSQL y Git, versión de clave y procedimiento probado de rotación/revocación. Antes de persistir secretos o habilitar conectores deben aprobarse el proveedor de claves, su operación/rotación y la matriz de datos permitidos/amenazas. El primer incremento no almacena secretos y no abre conexiones de clientes.
- Host SSH debe verificarse por fingerprint configurado. TLS MySQL verifica certificados cuando el perfil lo requiere; nunca degradar TLS o verificación de host para “hacer funcionar” una conexión.
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
