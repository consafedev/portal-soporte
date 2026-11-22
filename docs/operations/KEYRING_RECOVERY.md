# Procedimiento operativo — Recuperación del llavero de clientes

**Estado:** keyring provisionado; recuperación independiente, activación de runtime, rollback exacto y reactivación final verificados el 2026-11-22. No se han creado perfiles ni sobres de clientes.
**Ámbito:** PS-005.2; llaves maestras de cifrado de credenciales de conexiones.
**Última revisión:** 2026-11-21.

## Límites

- El archivo del llavero no es un secreto de prueba ni una configuración que deba versionarse. Se instala fuera del repositorio y PostgreSQL.
- El Portal valida directorio `root:<grupo_del_servicio>` modo `0750`, archivo regular `root:<grupo_del_servicio>` modo `0640`, sin enlaces simbólicos ni enlaces duros adicionales.
- PostgreSQL guarda los sobres cifrados, no la clave maestra. El respaldo del llavero debe estar cifrado con una clave de recuperación independiente y conservarse fuera del servidor.
- La recuperación no autoriza abrir conexiones a destinos reales, reemplazar credenciales de clientes ni restaurar una base en producción.
- No almacenar la contraseña de la clave de recuperación junto al respaldo cifrado. No copiarla a shell history, logs, Git, Worklog o chat.

## Contenido y nombres

El documento JSON operativo tiene versión de formato `1`, un `activeKeyId` y entre una y ocho claves. Cada clave contiene un identificador de versión y 32 bytes aleatorios codificados en Base64. El nombre de archivo y el contenido no son valores aceptados desde una solicitud HTTP.

Ejemplo estructural con marcadores no utilizables:

```json
{
  "version": 1,
  "activeKeyId": "<identificador-de-version>",
  "keys": [{ "id": "<identificador-de-version>", "key": "<material-base64-no-real>" }]
}
```

## Provisionamiento controlado

Antes de almacenar credenciales, el responsable de operaciones debe aprobar la ubicación, el grupo de servicio y el medio independiente de recuperación. Después:

1. Crear un directorio dedicado con propietario `root`, grupo del servicio y modo `0750`.
2. Generar material aleatorio criptográfico de 32 bytes directamente en el archivo protegido, sin imprimirlo ni ponerlo en argumentos de procesos.
3. Guardar el JSON conforme al formato anterior con `root:<grupo_del_servicio>` y modo `0640`; validar UID, GID, modo, tipo de archivo, enlaces y tamaño antes de iniciar el servicio.
4. Cifrar una copia del llavero con una clave de recuperación separada del host. Proteger esa clave mediante el procedimiento institucional aprobado; su tecnología y custodios deben quedar documentados por operaciones.
5. Restaurar una copia de ensayo en un directorio temporal aislado, comprobar permisos/formato con el validador local del Portal y comprobar que la versión activa puede descifrar un sobre sintético. Borrar solo los recursos temporales identificados por la prueba.
6. No habilitar la creación de sobres de clientes mientras no se haya verificado la copia de recuperación y su acceso por los custodios designados.

## Rotación sin pérdida de acceso

1. Hacer respaldo cifrado y verificar su restauración antes de cambiar el llavero.
2. Añadir una versión nueva y seleccionarla como `activeKeyId`; conservar la versión anterior.
3. Reenvolver las DEK existentes con la versión activa, ligando cada operación al mismo contexto de cliente, perfil y propósito. No registrar el sobre ni el material descifrado.
4. Comparar cantidades y resultados agregados antes/después; comprobar por ID que no queden sobres que referencien la versión anterior, sin exponer sus secretos.
5. Hacer y probar un nuevo respaldo recuperable. Solo entonces solicitar aprobación separada para retirar la versión anterior.

## Recuperación

1. Aislar el respaldo y confirmar su hash, fecha y custodios antes de descifrarlo.
2. Recuperar el cifrado mediante el mecanismo independiente autorizado en un host controlado, con salida redirigida directamente a un archivo temporal protegido, nunca a terminal.
3. Validar que el archivo resultante tenga la estructura y permisos exigidos por el proveedor del Portal; no imprimir el contenido.
4. Probar el acceso únicamente con sobres sintéticos en un entorno aislado. No conectar módulos a bases de clientes durante la prueba.
5. Si la prueba falla, preservar respaldo y llaves, detener el cambio y escalar. No generar una llave nueva sobre sobres existentes ni sustituir el respaldo.
6. Registrar fecha, versión recuperada, resultado agregado y custodios, nunca material criptográfico.

## Reversión y respuesta ante incidentes

- Si no se han creado sobres, deshabilitar la custodia y retirar únicamente el archivo nuevo siguiendo su ruta exacta y una revisión operativa.
- Si ya existen sobres, no borrar ni recrear el llavero. Restaurar todas las versiones requeridas desde el respaldo aprobado y validar con una copia de BD aislada.
- Si hay sospecha de exposición de una llave, preservar evidencia, revocar el acceso al archivo y planificar reenvoltura/rotación; retirar una versión solo después de verificar cobertura.
- No se habilita este mecanismo para SUPPORT ni para descifrado de perfiles salvo por operaciones de negocio autorizadas del backend.

## Preflight PS-005.3 — 2026-11-21

- Identidad validada mediante la llave SSH dedicada y `StrictHostKeyChecking`: `serverAlcazar` (`daniel@10.18.170.44`).
- `portal-soporte-api.service`: `active`; archivo protegido de entorno `/etc/portal-soporte/api.env`.
- No están configuradas `PORTAL_MASTER_KEYRING_PATH` ni `PORTAL_MASTER_KEYRING_GID`.
- Consulta agregada de solo lectura en `portal_soporte.portal.client_connection_profiles`: 0 perfiles y 0 referencias a versiones de llave. No se seleccionó ni leyó ningún sobre.
- No se modificaron archivos, servicios ni bases de datos. El preflight repetible quedó en `.superpowers/sdd/2026-11-21-ps0053-keyring-fixtures/task-1-preflight.ps1` (archivo local ignorado).
- Resultado: no hay llaves ni sobres existentes que puedan sobrescribirse; el aprovisionamiento aún requiere completar y probar una copia independiente de recuperación antes de habilitar custodia.

## Aprovisionamiento y recuperación verificada PS-005.3 — 2026-11-21

- Servidor validado con llave SSH dedicada y comprobación estricta de host: `serverAlcazar` (`daniel@10.18.170.44`).
- Archivo operativo: `/etc/portal-soporte/client-keyring.json`; versión `psk-20261121-a867d43d8f266051`; `root:portal-soporte`, modo `0640`, un enlace duro, 160 bytes. El directorio sigue siendo `root:portal-soporte`, modo `0750`.
- La llave se creó únicamente después del preflight que encontró cero perfiles y cero referencias de versión. No se sobrescribió una llave preexistente; los perfiles siguen siendo cero.
- Respaldo cifrado GPG AES-256, fuera del repositorio: `C:\Users\GLOUU\AppData\Local\PortalSoporte\KeyringRecovery\20261121T204519Z-1ef6f0c4\portal-client-keyring.json.gpg`.
- La credencial de recuperación se guarda en Windows Credential Manager, bajo la cuenta local de la propietaria, con destino `PortalSoporte-KeyringRecovery-20261121T204519Z-1ef6f0c4`. No se guardó junto al archivo cifrado, en Git, WORKLOG ni chat.
- Restauración verificada el 2026-11-21: el archivo cifrado se descifró hacia un directorio temporal exclusivo en Debian; el proveedor real `ProveedorClavesMaestrasArchivo` aceptó la versión restaurada y sus permisos. El `ServicioCifradoSecretos` cifró/descifró una carga sintética y rechazó el mismo sobre al cambiar el contexto autenticado. No se imprimieron bytes ni hashes; las cargas y directorios temporales se limpiaron y la comprobación posterior confirmó que no quedaron directorios remotos `restore-verify-*`.
- La configuración de runtime aún no contiene `PORTAL_MASTER_KEYRING_PATH` ni `PORTAL_MASTER_KEYRING_GID`; no se ha habilitado custodia en API ni se han creado sobres de clientes.
- Un primer intento de generar el respaldo dejó el archivo cifrado `C:\Users\GLOUU\AppData\Local\PortalSoporte\KeyringRecovery\20261121T203611Z-58865da0\portal-client-keyring.json.gpg` sin una credencial recuperable asociada. Se conserva sin alterarlo; no es el respaldo válido ni fue usado para restaurar.
- Un directorio local de prueba anterior contiene únicamente material sintético; una solicitud de limpieza fue bloqueada por la política automática. Se deja sin tocar y se reporta como residuo de prueba, no como material productivo.

## Activación final y rollback verificado — 2026-11-22

- Se verificó de nuevo la recuperación independiente desde `C:\Users\GLOUU\AppData\Local\PortalSoporte\KeyringRecovery\20261121T204519Z-1ef6f0c4\portal-client-keyring.json.gpg`; el material restaurado se usó solo en un directorio remoto temporal exacto, con limpieza comprobada.
- Se ejerció una prueba de rollback restaurando byte por byte `/etc/portal-soporte/api.env` desde `/etc/portal-soporte/api.env.ps0053-20261122T071752Z.bak`; la API arrancó con el proveedor desactivado y los healthchecks locales pasaron.
- Después se habilitó la configuración final mediante `PORTAL_MASTER_KEYRING_PATH` y `PORTAL_MASTER_KEYRING_GID`; la copia protegida previa es `/etc/portal-soporte/api.env.ps0053-20261122T072519Z.bak` (`root:portal-soporte`, modo `0640`). Solo se reiniciaron `portal-soporte-api.service` y `portal-soporte-web.service`.
- Tras la reactivación, ambos servicios quedaron `active`, `/login` y CSRF locales respondieron 200 y los listeners siguieron en `127.0.0.1:18840/18841`. El runtime cargó la configuración del archivo real; el servicio cifró/descifró datos sintéticos y rechazó un AAD distinto.
- El keyring tiene un respaldo recuperable independiente. No se creó ningún sobre, perfil ni credencial de cliente; la allowlist operacional de destinos continúa vacía. Esta verificación no autoriza ni habilita conexiones a bases de clientes.
