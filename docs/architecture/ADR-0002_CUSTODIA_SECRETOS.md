# ADR-0002 — Custodia de secretos de conexiones de clientes

- **Estado:** aceptada para implementación; verificación operativa pendiente.
- **Fecha:** 2026-11-20.
- **Contexto:** PS-005 requiere administrar perfiles MySQL/SSH sin revelar contraseñas, llaves privadas o certificados. PostgreSQL almacena metadatos del Portal, por lo que no debe ser la única custodia de la clave maestra.
- **Decisión aprobada:** el propietario solicitó el 2026-11-20 implementar un proveedor recuperable versionado, cifrado autenticado, rotación y conectores limitados a pruebas de solo lectura.

## Decisión

1. Cifrar cada paquete de secretos con una clave de datos aleatoria (DEK) de 256 bits y AES-256-GCM. Cada cifrado usa un nonce nuevo de 96 bits y etiqueta de autenticación de 128 bits.
2. Envolver la DEK con una clave maestra versionada (KEK) también de 256 bits y AES-256-GCM. El sobre conserva `keyId` para recuperar la versión exacta durante rotación/restauración.
3. Vincular ambos cifrados a contexto canónico autenticado: UUID de cliente, UUID de perfil y propósito. Copiar el sobre a otro perfil o contexto debe fallar al descifrar.
4. Mantener la interfaz del proveedor de claves en el núcleo y el proveedor de archivo fuera de PostgreSQL. La ruta se configura como archivo absoluto fuera del repositorio; el archivo no se crea ni se completa automáticamente durante el arranque.
5. En Debian, el archivo debe ser regular, sin enlace simbólico, propiedad de `root`, grupo de servicio autorizado, modo `0640` como máximo y ubicado en un directorio administrado con permisos restrictivos. La implementación falla cerrada si no puede probar estas condiciones.
6. El archivo de llavero contiene solo identificadores de versión y claves aleatorias codificadas; nunca se imprime ni se incluye en Git, variables de entorno, errores o bitácoras. La recuperación exige una copia cifrada e independiente del host y una prueba de restauración; tener el archivo junto a la BD no es respaldo independiente.
7. La rotación agrega una nueva versión activa, reenvuelve DEK sin descifrar paquetes de credenciales y conserva las versiones anteriores hasta verificar que ningún sobre las referencia. La revocación de una versión antigua ocurre solo después de inventariar/re-envolver todos los sobres y probar backup/restauración.
8. No persistir o probar credenciales si el llavero falta, tiene permisos inesperados, la versión no está disponible o el contexto de descifrado no coincide.
9. Los destinos de conectores se aceptan únicamente desde una lista exacta configurada fuera de la petición y de PostgreSQL. Se resuelven y fijan direcciones antes de conectar; host, puerto, fingerprint SSH y TLS se validan sin fallback. SSH permite solo un forward TCP a MySQL aprobado; nunca shell, agent forwarding ni destinos arbitrarios.
10. La prueba MySQL ejecuta exclusivamente `SELECT 1`, con máximo una conexión, límite de tiempo y cierre garantizado. No ejecuta DDL, limpieza ni escrituras.
11. **Decisión inicial, supersedida por la aclaración del propietario del 2026-11-22:** la autenticación SSH admitía solo llave privada PEM/OpenSSH y PPK v2 RSA; rechazaba la contraseña. Se conserva esta línea como historial de la decisión previa.

## Alternativas consideradas

- **Credenciales en PostgreSQL sin sobre:** rechazada porque un volcado de base revelaría secretos y no soportaría custodia/rotación independientes.
- **Clave maestra en variables de entorno:** rechazada porque aumenta exposición en configuración de procesos y no proporciona custodia recuperable versionada.
- **Clave al lado del cifrado o con despliegue automático:** rechazada porque no separa dominios de fallo y puede hacer irrecuperables o extraíbles los secretos.
- **KMS externo:** opción válida futura, pero no existe proveedor/servicio aprobado ni configurado para este entorno; la interfaz permitirá adaptarlo sin cambiar el contrato del sobre.

## Límites y riesgos pendientes

- La selección del formato y del algoritmo criptográfico está implementable; **no** autoriza crear/instalar llavero, sobres reales o credenciales en Debian.
- Recuperabilidad depende de una copia independiente custodiada por el propietario. Hasta probarla, los perfiles secretos permanecen deshabilitados.
- La allowlist debe ser provisionada por infraestructura en archivo de configuración protegido. No se inferirá de un host recibido por API.
- El soporte anunciado de PPK se limita a v2 RSA; el handshake SSH/MySQL se validó extremo a extremo con credenciales y servicios efímeros sintéticos en [Actions run `44885452443`](https://github.com/consafedev/portal-soporte/actions/runs/44885452443), head `543f3ba658f8b0d45e30190976e5206db329670b`. Esta evidencia no valida conexiones a destinos reales. PPK v3, DSA y variantes no verificadas continúan rechazándose.
- La implementación y los tests no habilitan RF-1 ni operaciones sobre bases de clientes; escrituras RF-1 tienen puertas separadas.

## Reversión

El código de proveedor/cifrado puede retirarse antes de persistir perfiles. Una vez que existan sobres en una base, retirar el código sin descifrado y copia de respaldo puede causar pérdida permanente de credenciales; la reversión requiere exportación cifrada, verificación y conservación de llaves/versiones, seguida de migración aditiva/revisada.

## Aclaración de compatibilidad autorizada — 2026-11-22

- El propietario solicitó compatibilidad práctica con los métodos de conexión de MySQL Workbench y aclaró que no se administrarán conexiones SAP. Esta aclaración sustituye únicamente la prohibición de contraseña SSH del punto 11; el resto de los controles permanece vigente.
- Los únicos perfiles implementados en esta entrega son `MYSQL_TCP` y `MYSQL_SSH`, siempre hacia un destino MySQL y un gateway exactos de la allowlist operacional. Sociedad y ambiente SAP son metadatos consultados dentro del MySQL elegido; no representan perfiles ni conexiones SAP. No se añaden URL arbitraria, shell, socket local, named pipe ni destinos libres.
- `MYSQL_SSH` admite exactamente una modalidad por credencial: llave privada PEM/OpenSSH o PPK v2 RSA, con passphrase opcional; o contraseña SSH. La llave se carga desde archivo `.pem`, `.key` o `.ppk` y su contenido nunca se presenta como texto en la interfaz. El método alternativo no cambia el almacenamiento: el paquete se cifra con el proveedor versionado AES-256-GCM y no se devuelve en respuestas ni se registra.
- Ambas modalidades mantienen fingerprint SSH obligatoria, resolución y destino fijados, un único forward TCP a MySQL autorizado, sin agente, teclado interactivo ni shell; TLS MySQL continúa validándose sin degradación. El broker aplica timeouts/cierre y la API redacta errores.
- La aceptación de contraseña aumenta el riesgo de fuerza bruta y reutilización de credenciales frente a llave pública. El Portal limita destino y método de uso, cifra el secreto y exige un gateway SSH controlado por operaciones. La compatibilidad solo se considera validada después de un handshake sintético extremo a extremo; VT-11 permanece abierto hasta que ese fixture pase en CI.
