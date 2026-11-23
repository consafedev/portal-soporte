# PS-005.4 — Diseño de destinos MySQL/SSH autoservicio

**Estado:** diseño aprobado por el propietario; implementación terminada en `EN_REVISION`.
**Fecha:** 2026-11-23.
**Base:** `main` en `0adacbe2f69d940ad8fd1941477d213c39bfdea5`.

## Intención

Permitir que ADMIN registre desde el Portal cualquier cliente y perfil MySQL compatible sin solicitar al equipo una edición manual de la allowlist del servidor por cada hostname o puerto. El perfil creado por ADMIN constituye la autorización exacta y auditable para ese destino.

La captura de Arca muestra el rechazo actual `DESTINATION_NOT_ALLOWED`: la interfaz pide hostname/puerto, pero `ServicioPerfilesConexion` exige que coincidan con `PORTAL_CONNECTOR_POLICY_JSON`. No es una solicitud de aprobación al propietario; es una política estática operativa que contradice la meta de autoservicio.

## Objetivos

- Mantener campos familiares de Workbench: hostname, puerto, base, usuario y credenciales separadas para el túnel SSH.
- Hacer que crear o modificar el perfil ACTIVE por ADMIN autorice exclusivamente el endpoint exacto del perfil, ligado a su `clientId` y `profileId`.
- Validar y fijar las direcciones resueltas antes de abrir cada socket, sin usar el resolver implícito del driver después de validar.
- Conservar TLS de MySQL, validación de certificado, fingerprint SSH, cifrado de secretos, CSRF, auditoría y autorización por cliente/capacidad.
- Mantener ADMIN como único rol que configura destinos; SUPPORT recibe solo perfiles redactados y no puede cambiarlos.

## Fuera de alcance

- No habilitar egress TCP arbitrario, URLs, protocolos distintos de MySQL, SQL libre, shell, agente SSH, forwarding general ni túneles SOCKS.
- No habilitar operaciones DML contra las bases de clientes. `SELECT 1` y las lecturas tipadas de RF-1 son el límite vigente; `rf-1:execute` sigue deshabilitado.
- No cambiar firewall, PostgreSQL, Cloudflare, DNS, servicios del servidor ni la política UFW.
- No aplicar migraciones a `portal_soporte` dentro de la implementación de este incremento.

## Enfoques considerados

1. **Mantener allowlist externa por hostname/puerto.** Es el comportamiento actual y conserva el control de infraestructura, pero obliga a modificar configuración del servidor cada vez que ADMIN agrega un cliente. No cumple el requisito de autoservicio.
2. **Permitir cualquier socket saliente sin validación de dirección.** Elimina fricción, pero convierte el Portal en una vía SSRF hacia loopback, redes internas, servicios de nube y otros servicios del host. Se descarta.
3. **Destino autoservicio ligado a cada perfil, con guardas de red en backend.** El alta de perfil por ADMIN es la autorización de negocio; cada socket se valida con reglas de dirección, DNS fijado y destino exacto. El propietario seleccionó este enfoque el 2026-11-23.

## Diseño seleccionado

### Modelo de destino

- Persistir de forma aditiva hostname/puerto de MySQL y, si aplica, hostname/puerto/fingerprint del gateway SSH junto al perfil de conexión. La configuración de destino queda unida al perfil y a su cliente; nunca proviene del request de una prueba o de una operación SUPPORT.
- Mantener los metadatos de credenciales en sobre cifrado. Hostname, puerto y huella son configuración del perfil, no credenciales. Las respuestas ADMIN pueden mostrar los campos necesarios para editar; respuestas SUPPORT y auditoría no exponen IP fijadas, huellas ni secretos.
- La creación del perfil no exige que el servidor pueda conectar en ese momento. La validación de conectividad se ejecuta al pulsar «Probar conexión», para que una caída temporal del DNS o del cliente no impida guardar la configuración.
- El endpoint se considera allowlisted únicamente por pertenecer a un perfil activo creado/modificado por ADMIN. Las pruebas y operaciones posteriores seleccionan el perfil persistido, comprueban cliente, usuario, rol y capacidad de nuevo, y no aceptan host/puerto arbitrarios en sus payloads.

### MySQL directo

- Aceptar hostname, IPv4 o IPv6 globalmente enrutable y puerto válido; rechazar esquemas, userinfo, rutas, caracteres de control, zonas IPv6, loopback, privado, link-local, no especificado, multicast, reservado y direcciones de metadatos.
- En cada conexión, resolver A/AAAA una sola vez con límites de tiempo/respuestas; rechazar el resultado completo si cualquiera de las direcciones elegibles no es globalmente enrutable. Elegir una dirección ya validada y conectarse a esa IP literal, evitando una segunda resolución/DNS rebinding en el driver.
- Conservar el hostname original para verificación TLS/SNI y validar certificado según el contrato MySQL. No permitir desactivar TLS ni la verificación del hostname.
- Una dirección cambia solo en una nueva resolución y nueva validación por intento; así se tolera failover de DNS del proveedor sin reutilizar una IP antigua.

### MySQL mediante SSH

- El gateway debe ser público/globalmente enrutable, con DNS resuelto y pin de IP por intento. El perfil guarda una fingerprint SHA-256 que ADMIN provee/verifica; no se acepta confianza silenciosa TOFU.
- Autorizar exactamente un `direct-tcpip` hacia el hostname/puerto MySQL guardado en el perfil. No exponer shell, comandos, agent forwarding, listeners, proxy SOCKS ni reenvío a otros destinos.
- Permitir como destino MySQL remoto loopback (por ejemplo `127.0.0.1`) y direcciones privadas únicamente dentro de ese forward SSH verificado, para cubrir el patrón Workbench. Rechazar siempre link-local y rangos de metadatos; rechazar nombres de metadatos conocidos. Si el host privado no se puede validar de forma segura con las capacidades disponibles, el broker fallará cerrado y ADMIN recibirá un error claro.
- Para un hostname MySQL público, resolverlo y validarlo en el Portal y enviar la IP literal fijada al forward; conservar el hostname para TLS MySQL cuando el driver lo permita. Para targets privados detrás del gateway, aceptar IP literal privada o loopback; no permitir que el gateway resuelva un nombre arbitrario que el Portal no pudo validar.

### Autorización, errores y auditoría

- Cada endpoint de guardar/editar exige sesión ADMIN, CSRF, validación estricta y auditoría. Cada prueba exige que el perfil siga activo, el cliente esté activo y el actor mantenga el alcance ADMIN; el backend obtiene la configuración del perfil persistido.
- SUPPORT mantiene acceso deny-by-default por cliente y capacidades aprobadas; nunca recibe los hostnames internos, fingerprints, credenciales o sobres.
- Mensajes diferencian hostname inválido, destino de red no permitido, DNS no disponible, SSH fingerprint incorrecta, fallo TLS, autenticación MySQL y permisos insuficientes. No devuelven dirección resuelta, SQL, stack ni credenciales.
- Auditar actor, cliente, perfil, acción, resultado, categoría sanitizada y correlación. No registrar contraseñas, llaves, sobre, IP resuelta ni payloads completos.

### Persistencia y compatibilidad

- Crear migración `0009` aditiva en `portal`; no editar byte por byte migraciones `0004`–`0008` ya aplicadas.
- Mantener temporalmente columnas/contratos internos de identificadores si se necesitan para perfiles antiguos; el request y la UI nunca presentan IDs técnicos.
- Pruebas de migración destructivas y de concurrencia únicamente en `portal_soporte_test`; integración de resolución con DNS falso controlado y fixtures MySQL/SSH sintéticos. Sin cliente real durante el desarrollo.
- En producción se requerirá PR/merge, respaldo y aprobación de migración/despliegue independientes.

## Validación esperada

- ADMIN registra direct MySQL y SSH sin editar configuración del host ni usar IDs; puede guardar offline y probar después.
- SUPPORT no puede crear/editar perfiles ni modificar endpoints; su uso verifica asignación y capacidad en cada solicitud.
- Direct MySQL bloquea direcciones privadas/especiales, DNS mixto o cambiante y rebinding; el socket conecta a la IP validada y TLS conserva la identidad del hostname.
- SSH acepta loopback/privado solo como destino del único forward bajo fingerprint exacta; rechaza fingerprint incorrecta, metadata/link-local, shell y forward alternativo.
- Credenciales nunca aparecen en respuesta, errores, interfaz después de guardar o logs; `SELECT 1` es la única prueba de conectividad.
- Pruebas unitarias, integración PostgreSQL real aislada, fixture MySQL/SSH, E2E API/visual; lint, typecheck, format, build y escaneo de secretos/dependencias.

## Riesgos y límites

- Un ADMIN autorizado puede registrar un endpoint externo; el broker limita esa facultad a los perfiles y protocolos implementados, pero la conectividad debe seguir sujeta a reglas de red del entorno. El control de destino no reemplaza ACL de cliente ni capacidades.
- DNS de gateways y MySQL debe ser confiable durante el intento; resolver y fijar antes de abrir socket reduce rebinding, no garantiza disponibilidad ni identidad del servidor. TLS y fingerprint siguen siendo necesarios.
- El acceso a host privado a través de SSH es funcionalmente necesario y aumenta el alcance de red del gateway; se limita a una sola conexión MySQL, puerto/host exactos y sin shell. Los rangos link-local y metadata quedan excluidos.
- Al volver al release anterior, perfiles creados bajo el nuevo modelo pueden quedar temporalmente no conectables si la versión anterior solo reconoce IDs del JSON externo. El rollback de código no elimina perfiles ni sobres; el procedimiento debe advertirlo y verificarse antes de desplegar.

## Decisiones de implementación realizadas

- Se guardan hostname, puerto, gateway y fingerprint en columnas aditivas del mismo perfil; las referencias legacy se conservan como fallback solo cuando las columnas nuevas son `NULL`.
- La clasificación IPv4/IPv6 y la resolución acotada usan `node:net` y `node:dns`; callbacks inyectables mantienen deterministas las pruebas y el broker fija la dirección elegida por intento.
- Cambiar endpoint o fingerprint actualiza la huella del perfil y las operaciones posteriores leen el endpoint persistido; la conexión no acepta un destino alterno en el request.

## Resultado de implementación y verificación — 2026-11-23

- Commits de incremento: `38b2b62` (política/contratos), `589b2e9` (persistencia y migraciones 0009/0010), `8da90b9` (broker y socket fijado), `1f752ff` (servicio/API por perfil), `c6e036a` (formulario ADMIN y E2E visual). El ajuste final de pruebas y documentación queda en commits separados sobre la rama de trabajo.
- Integración remota en `portal_soporte_test`: 10 archivos, 93/93 PASS; CLI de migraciones remota PASS; E2E remoto 19/19 PASS; E2E visual 2/2 PASS; unitarias acotadas 48 archivos, 426/426 PASS, sin skips reportados ni errores de memoria. Un E2E visual focal adicional para el mensaje de destino pasó 1/1.
- La revisión de seguridad encontró que una prueba de conexión consultaba el estado activo del perfil pero no el del cliente. Se añadió una regresión PostgreSQL que lo reprodujo (200 antes del fix, 404 esperado); `obtenerParaPrueba` ahora exige que cliente y perfil estén activos. La regresión focal pasó 2/2, la integración completa 93/93, y no se invoca el broker para clientes desactivados.
- La revisión estática final de solo lectura no encontró hallazgos accionables adicionales en SSRF/pinning, TLS/fingerprint, vínculo cliente/perfil, redacción SUPPORT, secretos, migraciones o compatibilidad legacy. No se intentó convertir el fixture Docker no ejecutado en PASS.
- La primera regresión detectó conteos heredados de 9 migraciones en tres tests; el ledger actual contiene 11. Se actualizaron las expectativas y la suite pasó. Un E2E aún esperaba el rechazo de allowlist; ahora comprueba el cierre seguro por falta de keyring, con borrado del secreto, y pasa focalmente y en la suite completa.
- `lint`, `typecheck`, `build`, escaneo de secretos y `check:dependencies:ci` pasan; lint final sin warnings. Auditoría de dependencias: cero altas/críticas y un hallazgo moderado.
- `format:check` del workspace falla por diferencias de formato de amplio alcance preexistentes en Windows (211 archivos con `endOfLine: lf` frente a `core.autocrlf=true` y 165 archivos aún con diferencias estructurales al comprobar CRLF). El formato de los archivos documentales y de test tocados pasa con Prettier configurado para CRLF; no se reformateó el resto del repositorio.
- El fixture MySQL/SSH no se ejecutó localmente: Docker Engine no está disponible. No hubo conexiones a clientes ni DDL/DML externo.
- Se retiró del frontend el texto heredado que describía el destino como sujeto a aprobación manual del servidor; las pruebas del cliente API y del resultado visual verifican el mensaje neutral basado en el estado del perfil.
- Los hashes de `0004`–`0008` son idénticos a la base `0adacbe2`; 0009 y 0010 se ejecutaron solo en la base aislada `portal_soporte_test`. No se aplican en `portal_soporte` ni se despliega este incremento en esta tarea.
- Estado del incremento: `EN_REVISION`; riesgos pendientes: ejecución del fixture MySQL/SSH en CI/Docker, validación de destino real autorizada y posible indisponibilidad de hosts/DNS. La actualización de código es forward-compatible con migraciones y perfiles guardados; revertir código a una versión previa puede dejar temporalmente inoperables perfiles nuevos, pero no se deben borrar migraciones ni datos.
