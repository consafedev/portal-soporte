# Procedimiento operativo — Recuperación del llavero de clientes

**Estado:** procedimiento preparado; no provisionado ni probado en Debian.
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
- Estado actual: no hay evidencia de llavero productivo provisionado, credenciales de clientes guardadas ni respaldo de llavero recuperable probado por esta tarea.
