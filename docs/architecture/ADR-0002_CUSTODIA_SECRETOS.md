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
11. La autenticación del gateway SSH para PS-005.2 admite llave privada PEM/OpenSSH y PPK v2 RSA que pase validación criptográfica del parser fijado; la contraseña SSH no se acepta. PPK v3, DSA y otras variantes no verificadas se rechazan explícitamente. PPK v2 tiene menor resistencia al ataque de fuerza bruta de passphrase que v3; para llaves cifradas se exige una passphrase de alta entropía, y se prefiere OpenSSH cuando el origen permita exportarlo de forma segura.

## Alternativas consideradas

- **Credenciales en PostgreSQL sin sobre:** rechazada porque un volcado de base revelaría secretos y no soportaría custodia/rotación independientes.
- **Clave maestra en variables de entorno:** rechazada porque aumenta exposición en configuración de procesos y no proporciona custodia recuperable versionada.
- **Clave al lado del cifrado o con despliegue automático:** rechazada porque no separa dominios de fallo y puede hacer irrecuperables o extraíbles los secretos.
- **KMS externo:** opción válida futura, pero no existe proveedor/servicio aprobado ni configurado para este entorno; la interfaz permitirá adaptarlo sin cambiar el contrato del sobre.

## Límites y riesgos pendientes

- La selección del formato y del algoritmo criptográfico está implementable; **no** autoriza crear/instalar llavero, sobres reales o credenciales en Debian.
- Recuperabilidad depende de una copia independiente custodiada por el propietario. Hasta probarla, los perfiles secretos permanecen deshabilitados.
- La allowlist debe ser provisionada por infraestructura en archivo de configuración protegido. No se inferirá de un host recibido por API.
- El soporte anunciado de PPK se limita a v2 RSA. El fixture sintético aún debe ejecutar el handshake SSH/MySQL real antes de declarar compatibilidad end-to-end.
- La implementación y los tests no habilitan RF-1 ni operaciones sobre bases de clientes; escrituras RF-1 tienen puertas separadas.

## Reversión

El código de proveedor/cifrado puede retirarse antes de persistir perfiles. Una vez que existan sobres en una base, retirar el código sin descifrado y copia de respaldo puede causar pérdida permanente de credenciales; la reversión requiere exportación cifrada, verificación y conservación de llaves/versiones, seguida de migración aditiva/revisada.
