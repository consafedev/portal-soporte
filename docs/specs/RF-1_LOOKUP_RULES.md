# RF-1 — Resolución de sociedad y proveedor por ambiente SAP

**Contrato funcional aprobado**: 2026-11-17 · **Versión**: 0.2.0 · **Estado**: aprobado para implementación tras validar DDL.

## Objetivo

Obtener `factura.sociedad` y `factura.creadoPor` sin cruzar proveedores entre ambientes SAP ni asignar una coincidencia equivocada. **Los RFC no son identificadores únicos globales de proveedor**: el mismo RFC puede figurar en diversos ambientes SAP.

## Dos dimensiones que nunca deben confundirse

- **Entorno de conexión** (`ConnectionProfile.environment`): `PROD`, `TEST`, etc.; definido en el portal por el administrador.
- **Ambiente SAP** (`sap_sociedad.ambienteSap` / `sap_proveedor.ambienteSap`): código propio de e-Billia/SAP, p. ej. `E1P`, `OPE`. **No derivarlo del valor PROD/TEST ni solo del nombre del cliente.**

## Flujo exacto

1. El usuario autorizado elige cliente y conexión BD. Toda consulta se realiza **dentro de esa base de datos**, nunca en otro cliente.
2. Normalizar solo el RFC para búsqueda (`trim`, mayúsculas); no modificar el XML recibido.
3. Consultar `sap_sociedad` por `rfc = RFC receptor` en esa BD. Si no hay fila: `RF1_SOCIETY_NOT_FOUND`.
4. Si hay varias opciones de sociedad/ambiente para el receptor, pedir selección de `sociedad` y `ambienteSap` válidos. La interfaz podrá sugerir valores **solo de las filas realmente encontradas**. Si hay un único par válido, seleccionarlo de modo automático; si existen dos filas duplicadas indistinguibles en el par, bloquear y reportar inconsistencia de catálogo.
5. Confirmar que el par seleccionado (`sap_sociedad.sociedad`, `sap_sociedad.ambienteSap`) existe en ese cliente/conexión y está autorizado. La existencia constituye el criterio de actividad; **ningún filtro adicional de activo**.
6. Consultar `sap_proveedor` restringiendo obligatoriamente las tres columnas: `rfc = RFC emisor`, `ambienteSap = ambienteSap de sociedad seleccionada`, `sociedad = sociedad seleccionada`.
7. Si hay **una fila** en este contexto, mapear `idProveedor -> factura.creadoPor`. Si hay **cero filas**, `RF1_SUPPLIER_NOT_FOUND`; si hay **dos o más**, `RF1_SUPPLIER_AMBIGUOUS`, sin usar `LIMIT 1` para decidir.
8. Si el RFC emisor también existe en **otros ambientes o sociedades**, eso es válido: esos registros no forman parte del conjunto consultado y **nunca son motivo de bloqueo**.
9. Antes de cada INSERT, revalidar estas relaciones en la misma conexión. Si cambiaron, bloquear con `RF1_CONTEXT_MISMATCH` sin modificar la BD.

### Consultas conceptuales (solo lectura; adaptar al DDL verificado)

```sql
-- Obtiene opciones de sociedad únicamente dentro de la conexión elegida.
SELECT sociedad, ambienteSap
FROM sap_sociedad
WHERE rfc = ?;

-- Obtiene el proveedor exclusivamente en la sociedad y ambiente SAP seleccionados.
SELECT idProveedor
FROM sap_proveedor
WHERE rfc = ?
  AND ambienteSap = ?
  AND sociedad = ?;
```

**Nota:** el SQL anterior es una referencia documental, no un script listo para ejecutar en producción. La elección de collation/normalización se verificará con el DDL. Cero interpolación de RFC en SQL. No usar `marcado_borrado` o `contabilizar` como filtro de actividad.

### Transporte de selección explícita por archivo

La primera petición de vista previa omite selección societaria. Si una factura responde `NEEDS_SELECTION`, el backend devuelve únicamente los pares `(sociedad, ambienteSap)` obtenidos en esa consulta autorizada. La interfaz permite elegir entre esos pares y reenvía el mismo lote de archivos en memoria mediante el campo multipart opcional `seleccionesSociedad`, con este contrato:

```json
[
  { "indiceArchivo": 1, "sociedad": "2000", "ambienteSap": "ERP-DEV" }
]
```

`indiceArchivo` es cero basado y se refiere al orden de los campos `files` del mismo multipart; no se usa el nombre del archivo como identidad porque puede repetirse. El campo debe ser un arreglo JSON de 1 a 100 elementos, con índice entero dentro del lote y sin índices duplicados. La selección debe contener únicamente `indiceArchivo`, `sociedad` y `ambienteSap`. El backend valida su forma y límites antes de abrir el broker y el dominio verifica otra vez que el par exacto siga presente en `sap_sociedad` de la misma conexión autorizada. Una opción ajena al catálogo produce `RF1_CONTEXT_MISMATCH`; no se infiere sociedad ni ambiente a partir del nombre del cliente, el entorno PROD/TEST o campos enviados por el navegador. El flujo no persiste XML ni realiza DML.

## Casos de prueba obligatorios

| Caso | Datos sintéticos de catálogo | Esperado |
|---|---|---|
| L-01 | Emisor RFC A en E1P/sociedad 1000 y OPE/sociedad 2000; receptor elige E1P/1000 | Éxito con idProveedor de E1P/1000; NO ambigüedad |
| L-02 | Emisor RFC A solo en OPE/2000, receptor eligió E1P/1000 | `RF1_SUPPLIER_NOT_FOUND` y sin INSERT |
| L-03 | Receptor RFC B ausente de `sap_sociedad` | `RF1_SOCIETY_NOT_FOUND`, sin INSERT |
| L-04 | Receptor RFC B aparece en E1P/1000 y OPE/2000 | Selección explícita sociedad/ambiente; sin INSERT antes de elegir |
| L-05 | Emisor RFC A tiene dos registros para E1P/1000 | `RF1_SUPPLIER_AMBIGUOUS`, sin INSERT |
| L-06 | Emisor RFC A en E1P/1000 con `marcado_borrado='X'` | Cuenta como existente/activo para RF-1; no filtrar por ese campo |
| L-07 | Receptor/sociedad seleccionado cambia antes de confirmar | Bloqueo y re-previsualización, sin INSERT |
| L-08 | Existe proveedor en sociedad distinta pero mismo ambiente SAP | Se ignora; exigir match también por sociedad |
| L-09 | Conexión al catálogo falla o carece de permiso SELECT | `RF1_CATALOG_UNAVAILABLE`, no afirmar que está inactivo |
| L-10 | Dos filas idénticas de sociedad para mismo par, si el DDL lo permitiera | Bloqueo por catálogo ambiguo, nunca escoger arbitrariamente |

## Respuesta API por factura (contrato orientativo)

El backend devuelve `resolution.status = RESOLVED | NEEDS_SELECTION | BLOCKED`, `errorCode` opcional, `sociedad`, `ambienteSap` e `idProveedor` solo cuando estén validados. El frontend muestra mensajes de `DECISIONS_APPROVED.md`, sin exponer credenciales ni datos de otras conexiones. Valores elegidos por el usuario siempre se vuelven a comprobar en servidor.
