# Política de respaldos PostgreSQL — Portal de Soporte e-Billia

**Versión:** 0.1 · **Vigente desde:** 2026-11-20 · **Responsable:** propietario del Portal.

## Alcance y estado

- El respaldo incluye exclusivamente el esquema `portal` de `portal_soporte`, con datos, definiciones y objetos migratorios. No incluye roles globales, otras bases, configuraciones PostgreSQL ni datos de clientes.
- La captura es un respaldo manual consistente de `pg_dump` en formato custom, PostgreSQL 15.20, cifrado con GnuPG AES-256 e integridad activada antes de escribirse a disco.
- No hay todavía una programación periódica confirmada. Este artefacto demuestra una ejecución y una restauración de verificación; no demuestra una política de recuperación ante desastres completa.

## Artefactos actuales

- Host Debian verificado; base: `portal_soporte`; esquema: `portal`.
- Las rutas exactas del artefacto cifrado remoto/local y del archivo de custodia DPAPI están en el manifiesto local fuera del repositorio.
- La custodia DPAPI local está protegida para la cuenta propietaria de Windows y SYSTEM.
- El manifiesto local registra tamaño, fecha, SHA-256 y rutas; la huella local y remota coincidieron. El tamaño del cifrado es 4,996 bytes.
- Retención: mantener cifrado y revisar el 2026-12-19; no hay borrado automático configurado.

El directorio remoto tiene propietario de despliegue y modo `0700`; el archivo cifrado tiene el mismo propietario y modo `0600`. La carpeta local restringe acceso a la cuenta propietaria y SYSTEM. Ningún dump en claro se conserva.

## Recuperación comprobada

1. Ejecutar bajo la misma cuenta y perfil de Windows que protege el archivo DPAPI; DPAPI `CurrentUser` no se puede recuperar desde otro perfil sin migrar la clave por un canal seguro.
2. Recuperar el secreto únicamente en memoria mediante DPAPI, sin imprimirlo. Transmitirlo por entrada estándar a GnuPG sobre el canal SSH con host verificado; nunca pasarlo como argumento de proceso, guardarlo en Git ni incluirlo en registros.
3. Desencriptar como flujo y comprobar el catálogo con `pg_restore --list`; no crear un dump en claro persistente.
4. Restaurar solo en un destino PostgreSQL nuevo, aislado y expresamente autorizado. Verificar inventario, ledger y datos sin mostrar credenciales, hashes ni filas personales.
5. Eliminar el destino temporal solo después de comprobar su identidad exacta y ausencia de sesiones, sin terminar sesiones ajenas.

La recuperación se probó con la clave DPAPI local y `pg_restore --list`; el restore completo se verificó en `portal_soporte_restore_verify_20261119`, se compararon tablas/contenido/índices/constraints/ledger y después se eliminó solo esa base temporal. `portal_soporte` y `portal_soporte_test` permanecieron disponibles con sus OID originales.

## Riesgos y mantenimiento

- La clave cifrada es recuperable con la cuenta/perfil Windows actual; aún no existe custodia de clave de recuperación independiente en un vault administrado. Antes de depender de este artefacto para recuperación ante pérdida del equipo, el propietario debe guardar una copia protegida del secreto mediante su gestor de secretos, sin transmitirlo al chat ni al repositorio.
- Revisar mensualmente tamaño, huella, permisos, estado de cifrado, edad, copia independiente de clave y una restauración aislada. Mantener al menos una copia cifrada fuera del servidor de origen.
- En la fecha de revisión, decidir retención/borrado con autorización del responsable; no purgar automáticamente ni borrar la única copia verificada.
- Los registros de verificación no contienen contraseñas, hashes de contraseña, filas, tokens ni contenido del dump.
