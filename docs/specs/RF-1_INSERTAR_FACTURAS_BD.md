# SPEC RF-1 — Insertar facturas en BD

**ID:** `rf-1` · **Nombre oficial:** Insertar facturas en BD · **Versión:** 0.2.0 · **Estado:** contrato funcional aprobado, sujeto a validaciones de DDL y pruebas · **Owner:** por asignar.

## 1. Objetivo y perímetro

Permitir que agentes autorizados inserten una o varias facturas CFDI de ingreso en la tabla remota `factura`, seleccionando cliente/conexión previamente registrados por un administrador y sin ver credenciales MySQL/SSH. El proceso detecta errores, duplicados, asociaciones fiscales ambiguas y discrepancias antes de escribir. Genera trazabilidad y verifica cada resultado.

**Fuentes:** brief actualizado 2026-11-17, PRD de e-Billia y capturas de esquema; seis XML CFDI 4.0 de muestra. Las capturas NO sustituyen `SHOW CREATE TABLE` ni reglas de negocio de cliente.

**Incluye MVP:** CFDI 4.0 `TipoDeComprobante=I`, lectura múltiple `.xml` (extensión mayúscula/minúscula), extracción por namespace + nombre de atributo, compatibilidad con serie/folio opcionales, descuentos, impuestos trasladados, retenciones federales, complementos adicionales ignorados sin alterar original, selección de un cliente BD, datos opcionales, vista previa, validación, confirmación, inserción, SELECT de verificación y reporte por archivo.

**Fuera MVP / requires spec:** CFDI E (notas de crédito, por validar transacción y estatus), CFDI P (complemento de pago), actualización de facturas previas a PAGADA/PARCIAL CON COMPLEMENTO, script SQL manual expuesto a soporte, modificación o reparación de XML/BOM, validación en línea contra SAT, automatización de ingreso por referencia en e-Billia, exportación de XML reales o acceso SQL general. Estas capacidades existen como intención en el PRD, pero NO quedan autorizadas para insertar sin definición independiente.

## 2. Experiencia de usuario

1. Seleccionar **Cliente** y **Conexión/Entorno** en dropdown. El entorno de conexión PROD/TEST no es el `ambienteSap` del catálogo SAP. Solo clientes asignados con perfil MySQL compatible, activo y permitido para `rf-1`; marcar claramente PROD vs PRUEBAS.
2. Subir 1..N XML (drag-and-drop o selector). La interfaz identifica, cuenta y clasifica archivos; no modifica ni guarda automáticamente los originales en Git ni en almacenamiento público.
3. Mostrar una **tabla por CFDI**: archivo, UUID, emisor, receptor, serie+folio, fecha, total, moneda, proveedor/sociedad detectados, estado de validación, `estatus`, `Entrada de Mercancía`, `Orden de Compra`, `Documento Contable`, `Documento de Pago` y detalles expandibles. Cuando el RFC receptor identifique más de un par real sociedad/ambiente SAP, mostrar selector de sociedad/ambiente antes de habilitar la fila. Los campos que no caben se expanden o editan en panel accesible. Debe conservarse una fila por XML aun si falla validación.
4. Permitir `nea` **Entrada de Mercancía** (opcional), `noa` **Orden de Compra** (opcional), `nodocumentocontable` **Documento Contable** (opcional), `nodocumentopago` **Documento de Pago** (opcional, propuesto por PRD). El usuario puede dejar vacío sin inventar un dato. El campo `estatus` es dropdown por fila con **CONTABILIZADO** o **PAGADA**; opción de aplicar el mismo estatus a todas las filas elegibles. No permitir valores arbitrarios.
5. Mostrar **previsualización final, cambios/targets y advertencias**; botón `Confirmar inserción` solo en filas totalmente válidas. Solicitar confirmación expresa con cliente, entorno y cantidad, de forma especialmente visible para producción. Ejecutar trabajo en backend, indicar progreso, resultado por archivo y comprobantes de verificación.
6. Reportar filas `INSERTADA_VERIFICADA`, `YA_EXISTE`, `RECHAZADA`, `ERROR_REVERTIDO`, `INDETERMINADO` o `PENDIENTE`, sin declaraciones falsas de éxito. El usuario puede descargar un resumen **sin secretos**. No reintentar una fila INDETERMINADO hasta conciliar su UUID.

## 3. Restricciones, controles y semántica de datos

- `uuid` se extrae de `TimbreFiscalDigital.UUID`, no de filename. Exigir emisor/receptor/versión/tipo, identificador de documento, fecha, moneda y montos válidos según perfil soportado. Si serie y/o folio faltan, no truncar ni inventar valor; referencia=`(Serie || '') + (Folio || '')` sin espacios agregados. Si ambos faltan, referencia vacía solo si DDL/reglas lo permiten; UUID sigue siendo identidad.
- `sociedad`: consultar `sap_sociedad` por **RFC receptor** dentro de la BD del cliente y perfil seleccionados. Si hay varios pares (`sociedad`, `ambienteSap`) válidos, el usuario elige explícitamente el adecuado; no se bloquea únicamente por existir otra sociedad/ambiente válido. `creadoPor`: buscar `sap_proveedor.idProveedor` con **RFC emisor + `ambienteSap` de la sociedad seleccionada + `sociedad` de la sociedad seleccionada**. Exigir **una sola coincidencia en ese contexto exacto**; otros registros del mismo RFC en distintos ambientes/sociedades son válidos y se ignoran. **Existencia del registro = activo**, sin filtrar por `marcado_borrado`, `contabilizar` u otras banderas. Si falta proveedor/sociedad o hay múltiples proveedores en el mismo par, bloquear **solo esa fila**, mostrar código/mensaje claro y no insertar. Nunca usar la primera coincidencia arbitraria. Reglas/casos: `RF-1_LOOKUP_RULES.md`.
- `fechaCarga` = instante de operación en servidor, almacenado en `datetime` según zona de BD confirmada (preferencia UTC y conversión documentada); `fecha` = componente AAAA-MM-DD de `Comprobante.Fecha`, sin aplicar desplazamiento por zona horaria al dato fiscal; `ejercicio` = año de `fecha`, salvo confirmación del ERP de otra regla.
- `rutaXml` = texto literal `AgregadoAutomatizado`; `moduloOrigen` = `REF`; `referencia` = concatenación serie/folio sin espacios adicionales. `numctapago`, `nodocumentologistico`, `detraccion_pe` vacíos/NULL **según compatibilidad real de columnas**. `rutaPdf` vacío/NULL porque el primer flujo no carga PDF. No insertar `''` si DDL exige otro comportamiento.
- Extraer `importeIvaFAC` de traslados federales código `002` del nodo fiscal agregado de impuestos; `retencionIsr` 001, `retencionIva` 002, `retencionIeps` 003 desde retenciones federales. No confundir IVA retenido con IVA trasladado ni sumar retención local a retención ISR/IVA. Impuestos locales y conceptos adicionales se preservan en el **análisis** pero no se inyectan en columnas equivocadas. `totalFAC` ya incluye descuentos/retenciones de acuerdo al comprobante: no recomputarlo con fórmula ingenua.
- Comparar/sumar con biblioteca decimal exacta; validar escalas `DECIMAL(12,2)` / `(8,2)` y rangos antes de insertar, con criterio de redondeo fiscal documentado. **No usar float**. `tipoComprobante=I` para este MVP; estados permitidos estrictamente CONTABILIZADO, PAGADA, **ambos válidos directamente en INSERT por decisión del propietario**.
- Validar máximos de longitud según DDL; no truncar RFC/UUID/serie/documentos, ni forzar campos opcionales que no caben; bloquear y describir campo. Ejemplo `serie` VARCHAR(25), `nodocumentocontable` VARCHAR(10), `nodocumentopago` VARCHAR(10), `creadoPor` VARCHAR(10) en capturas, por verificar.
- No interpretar texto libre de conceptos o `NoIdentificacion` como OC/EM de forma automática. En CFDI de muestra aparecen números de pedidos dentro de descripciones; en MVP el usuario indica OC/EM opcionalmente. Una inferencia futura debe exponer confianza y exigir confirmación.

## 4. Pipeline técnico

`upload -> límites/antivirus policy -> parser XML seguro -> validación CFDI -> extracción tipada -> lectura exclusiva de catálogos -> enriquecimiento -> detección duplicados -> preview -> revalidación bajo la misma autorización y conexión -> confirmación -> transacción por CFDI -> SELECT postcommit -> resultado/auditoría`.

- Parser con namespaces reales: URI `http://www.sat.gob.mx/cfd/4` y TimbreFiscalDigital, no depender del prefijo `cfdi` ni del orden de atributos. DTD y entidades externas deshabilitadas, no-network, límites de tamaño/profundidad y CPU, rechazo explícito de XML mal formado. Detectar BOM/codificación anómala **solo como diagnóstico**, no corregir/reescribir automáticamente.
- Identificar variantes conocidas y no soportadas por version/tipo; no etiquetar automáticamente como válido un CFDI timbrado solo porque contiene UUID. Validación estructural local no sustituye validación SAT/estado tributario.
- Dos capas de pruebas: parser de entrada puro (sin DB) y ejecución remota (broker aislado). No escribir jamás en DB durante upload/preview.
- Endpoint propuesto `POST /api/v1/modules/rf-1/preview` (archivos y perfil, respuesta temporal con `previewId`); `POST /api/v1/modules/rf-1/jobs` (previewId, decisiones, nonce/idempotency key y confirmación); `GET /api/v1/modules/rf-1/jobs/:id` (progreso + evidencias redactadas). API autoriza todas las rutas con `rf-1:read|execute` + client scope.
- En confirmación, reconsultar que el RFC receptor/emisor corresponde al mismo cliente, esquema, sociedad, **ambiente SAP** y proveedor y no haya existido un cambio en datos/estado desde preview. La vista previa **no** garantiza que una escritura posterior sea segura.
- Escribir mediante SQL **parametrizado** y columnas permitidas; tabla `factura` fija por configuración administrada y validada. Esquemas y tabla nunca se interpolan desde datos del usuario. Conexión por servidor con privilegios mínimos necesarios (SELECT en `sap_sociedad`, `sap_proveedor`, `factura`; INSERT exclusivamente en `factura`, si el esquema lo soporta).
- Duplicados: antes de cada escritura hacer SELECT del UUID en esquema/cliente correctos. Serializar trabajos concurrentes del portal por `(connectionProfileId, uuid)` mediante mecanismo transaccional/advisory lock si compatible. **Importante:** sin índice `UNIQUE` en el esquema remoto no hay garantía global de exactly-once frente a procesos externos; confirmar índices y diseñar reconciliación. Si UUID existe, `YA_EXISTE`, nunca UPDATE implícito.
- Lotes 1..N con límites configurables por admin (propuesta inicial 100 XML, 5 MiB c/u, 25 MiB por petición; afinar con pruebas). Una transacción por CFDI, no transacción larga que retenga locks por todo lote. No bloquear event loop; control de concurrencia 2-4 por conexión, según carga del servidor.
- Si falla commit/timeout/SSH tras enviar operación, hacer SELECT de conciliación con conexión válida. `0` puede indicar no inserción solo si hay evidencia confiable y no hay transacciones en vuelo; si no puede establecerse resultado inequívoco -> `INDETERMINADO`, sin retry automático. No decir que no se afectó BD cuando la red impide verificar.
- Guardar en auditoría user, cliente, perfil, hash SHA-256 del original, UUID, estado previo, intento, filas afectadas, verificación y timestamp; no registrar el XML completo ni strings de secretos. Manejar retención temporal y borrado seguro sujeto a políticas.

## 5. Caso de los seis CFDI reales aportados (observación read-only)

- Los seis ejemplos son CFDI 4.0 de ingreso `I` con TimbreFiscalDigital.
- Dos no tienen **ni Serie ni Folio**; otro tiene folio pero no serie. La `referencia` puede ser vacía o igual a folio, sin error de parsing.
- Hay documentos con descuento e IEPS federal; otros incluyen retenciones federales IVA/ISR e impuesto local (cedular). El parser debe clasificar conceptos y niveles de impuestos sin contarlos dos veces.
- Uno incorpora complemento de hidrocarburos a nivel concepto: el parser del comprobante debe ignorar complementos no mapeados de forma segura sin rechazar una factura válida solo por su presencia.
- Estos archivos **no son fixtures públicas**: sustituir por ejemplos sintéticos anonimizados; no añadirlos al repositorio ni a los logs.

## 6. Criterios de aceptación RF-1

Además de los criterios siguientes, son obligatorios los diez casos L-01 a L-10 de `RF-1_LOOKUP_RULES.md`, los errores estructurados de `DECISIONS_APPROVED.md` y las pruebas de ambos estatus durante un INSERT de laboratorio. Toda implementación sigue `docs/standards/CLEAN_CODE.md`.

| ID | Prueba | Resultado esperado |
|---|---|---|
| RF1-01 | Subir 1 y N XML CFDI 4.0 válidos | Una fila por XML con UUID y campos correctos |
| RF1-02 | Sin serie/folio | Preview correcto; referencia vacía o folio, según origen |
| RF1-03 | Con IVA, IEPS y retención ISR/IVA/local | Mapeo federal correcto; impuestos locales sin contaminación |
| RF1-04 | Campos OC/EM/contable/pago vacíos | Permitidos si columna/regla BD lo permite |
| RF1-05 | Aplicar estatus global y editar fila | Solo dos valores autorizados; prevalece edición final por fila |
| RF1-06 | RFC receptor inexistente o sociedad seleccionada ajena a cliente | Bloqueo por fila; si receptor tiene distintas sociedades válidas, solicitar selección, sin INSERT hasta resolver |
| RF1-07 | RFC emisor no coincide con un proveedor único **dentro** de sociedad + ambiente SAP seleccionados | Bloqueo por fila, sin INSERT; otros ambientes no cuentan como duplicados |
| RF1-08 | UUID ya existente en cliente/schema | `YA_EXISTE`, sin modificar registro |
| RF1-09 | Soporte deshabilitado/cliente no asignado | 403 desde API aun con request manual |
| RF1-10 | Operador cancela preview | Cero modificaciones remotas |
| RF1-11 | Confirmación exitosa | Transacción + SELECT correcto + auditoría por UUID |
| RF1-12 | Error SQL antes del commit | Rollback verificado y estado claro |
| RF1-13 | Corte SSH/BD durante commit | Conciliación; resultado INDETERMINADO si no hay certeza |
| RF1-14 | XML mal formado, DTD, entidades, oversized | Rechazado sin red/XML reparado ni acceso externo |
| RF1-15 | CFDI E o P y versión no soportada | Diagnóstico explicativo; cero INSERT en MVP |
| RF1-16 | Columnas exceden tamaños/decimal | Rechazo, nunca truncado implícito |
| RF1-17 | Dos trabajos simultáneos mismo UUID | No duplicación entre trabajos propios; documentar límite externo |
| RF1-18 | Cliente PROD en operación masiva | Confirmación expresa con cliente, entorno y contador |

## 7. Dependencias y validaciones técnicas previas a escrituras

Decisiones de estatus, actividad y lookup **CERRADAS** en `DECISIONS_APPROVED.md`. Antes de implementar `INSERT`: obtener DDL real `factura`, `sap_proveedor`, `sap_sociedad`; índices/constraints y triggers; permisos y reglas de negocio; validez de `NULL`/cadena vacía; dato a guardar en `noa`/`nea`; prueba del lookup contextual para `creadoPor` por RFC + sociedad + ambiente SAP; compatibilidad técnica de `estatus=PAGADA` con DDL/triggers (regla de negocio **ya aprobada**); zona de `fechaCarga`; mapeo de `rutaPdf`, `importeIvaFAC`, impuestos; destino/retención de XML. Ver `OPEN_DECISIONS.md` y `RF-1_LOOKUP_RULES.md`.
