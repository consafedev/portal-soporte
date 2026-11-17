# RF-1 — Diccionario y mapeo fiscal a MySQL

**Versión:** 0.2.0 · **Estado:** reglas funcionales aprobadas; columnas derivadas de capturas aportadas y XML de ejemplo. NO validado contra `SHOW CREATE TABLE`. No ejecutar SQL productivo basándose únicamente en este documento.

## A. `factura` — correspondencia propuesta

| Columna MySQL (según captura) | Tipo mostrado | Fuente/regla RF-1 | Notas |
|---|---|---|---|
| `uuid` | varchar(40) PK | `TimbreFiscalDigital.UUID` | Normalizar mayúsculas; no usar filename |
| `nodocumentocontable` | varchar(10) | Input «Documento Contable» | Opcional, sin truncar |
| `ejercicio` | varchar(4) | Año de CFDI `Fecha` | Pendiente confirmar ejercicio ERP |
| `rfcReceptor` | varchar(15) | `Receptor.Rfc` | Validar sociedad para cliente/ambiente |
| `rfcEmisor` | varchar(15) | `Emisor.Rfc` | Validar proveedor correspondiente |
| `folio` | varchar(100) | `Comprobante.Folio` | Puede faltar |
| `serie` | varchar(25) | `Comprobante.Serie` | Puede faltar |
| `fecha` | varchar(10) | Fecha de emisión AAAA-MM-DD | Sin cambio de zona horaria |
| `monedaFAC` | varchar(5) | `Comprobante.Moneda` | Validar contra negocio |
| `totalFAC` | decimal(12,2) | `Comprobante.Total` | Decimal exacto |
| `subtotalFAC` | decimal(12,2) | `Comprobante.SubTotal` | Es anterior a descuento |
| `importeIvaFAC` | decimal(12,2) | Traslados código `002` a nivel comprobante | No sumar IVA retenido |
| `rutaXml` | varchar(196) | Literal `AgregadoAutomatizado` | Trazabilidad de portal |
| `rutaPdf` | varchar(196) | Vacío/NULL | A confirmar reglas DB |
| `estatus` | varchar(25) | Input enum `CONTABILIZADO`/`PAGADA` | Ambos autorizados al insertar; verificar solo compatibilidad técnica real |
| `version` | varchar(5) | `Comprobante.Version` | MVP `4.0` |
| `fechaCarga` | datetime | Instante del servidor | UTC/local DB por confirmar |
| `nea` | varchar(2000) | Input «Entrada de Mercancía» | Opcional |
| `tipoComprobante` | varchar(20) | `Comprobante.TipoDeComprobante` | MVP `I` |
| `metododepago` | varchar(100) | `Comprobante.MetodoPago` | Puede venir vacío según versión |
| `formadepago` | varchar(100) | `Comprobante.FormaPago` | Puede faltar; no inventar |
| `numctapago` | varchar(50) | Vacío/NULL | Confirmar nulos |
| `referencia` | varchar(100) | `(Serie ?? '') + (Folio ?? '')` | Sin espacios extra; validar <=100 |
| `nodocumentopago` | varchar(10) | Input «Documento de Pago» | Opcional (PRD) |
| `noa` | varchar(2000) | Input «Orden de Compra» | Opcional |
| `creadoPor` | varchar(10) | `sap_proveedor.idProveedor` | Lookup único **dentro** de RFC emisor + sociedad + ambiente SAP; otros ambientes legítimos |
| `nodocumentologistico` | varchar(10) | Vacío/NULL | Confirmar nulos |
| `sociedad` | varchar(8) | `sap_sociedad.sociedad` | Lookup unívoco por RFC receptor |
| `retencionIsr` | decimal(8,2) | Retenciones federales `001` | No impuestos locales |
| `retencionIva` | decimal(8,2) | Retenciones federales `002` | No traslados |
| `retencionIeps` | decimal(8,2) | Retenciones federales `003` | No IEPS trasladado |
| `moduloOrigen` | varchar(4) | Literal `REF` | Regla solicitada |
| `detraccion_pe` | decimal(7,2) | Vacío/NULL | Tipo numérico: no forzar cadena vacía |

**Cuidado:** la captura señala `uuid` como PK; verificar en DDL si es PK efectiva, sus collation/índices y unicidad por schema. La captura muestra `importeIvaFAC` con ese nombre/case: validar nombre exacto contra DB. Las columnas con nombre camelCase pueden ser case-insensitive según plataforma, pero evitar suposiciones.

## B. `sap_proveedor` (según captura)

- Llave primaria compuesta aparente: `ambienteSap` `varchar(3)`, `idProveedor` `varchar(10)`, `sociedad` `varchar(4)`.
- Atributos visibles: `numero_de_cuenta char(10)`, `idGlobal varchar(10)`, `nombre varchar(255)`, `contabilizar char(1)`, `rfc varchar(15)`, `email varchar(141)`, `pais varchar(3)`, `tipo varchar(1)`, `cpd varchar(10)`, `retencion varchar(1)`, `repse varchar(1)`, `marcado_borrado varchar(1)`, `id_usuario int UN`, `autodetraccion_pe varchar(1)`.
- Para elegir `creadoPor`, buscar candidatos por RFC normalizado, filtrar por **`sociedad` y `ambienteSap` de la fila de `sap_sociedad` seleccionada**. `ambienteSap` NO equivale a PROD/TEST de la conexión. Un mismo RFC en otros ambientes o sociedades es legítimo; no genera bloqueo. **Existencia = activo**; no filtrar por `marcado_borrado`, `contabilizar` u otros indicadores. Si hay más de una fila dentro del contexto exacto, bloquear sin elegir el primero.

## C. `sap_sociedad` (según captura)

- `sociedad varchar(4)` PK; `rfc varchar(48)`; `razonSocial varchar(80)`; `pais varchar(3)`; `ambienteSap varchar(3)`; `pac_config_id bigint`.
- `sociedad` se obtiene por RFC receptor en la conexión elegida. Si hay más de un par válido (`sociedad`, `ambienteSap`) solicitar selección explícita entre opciones reales. Una vez elegida, filtrar `sap_proveedor` por ese mismo par. No deducir el ambiente de PROD/TEST ni de nombre del archivo.

## D. Reglas fiscales

- `cfdi:Comprobante` namespace 4.0; leer atributos del elemento por nombre, sin depender de orden/estilo de serialización.
- `TimbreFiscalDigital` dentro de `Complemento` aporta UUID; `Complemento` puede además contener impuestos locales y/o otros complementos.
- Agregación de impuestos: usar impuestos **del comprobante** para evitar doble conteo de nodos repetidos por concepto. Si no existen y el perfil admite agregación por concepto, aplicar algoritmo probado; de otro modo bloquear y diagnosticar.
- En los ejemplos aportados se observaron (sin conservar contenido real): IVA 16 %, IEPS trasladado 8 %, IVA e ISR retenidos, retención local, descuentos y folios ausentes. Aceptar estos formatos sin sobrescribir información financiera.
- La compatibilidad con monedas distintas a MXN y tipo de cambio queda sujeta a confirmación de comportamiento en BD; no realizar conversiones monetarias implícitas.

## E. Validación previa al primer `INSERT`

Contrato de lookup detallado: [`RF-1_LOOKUP_RULES.md`](RF-1_LOOKUP_RULES.md). Decisión de actividad y estatus: [`DECISIONS_APPROVED.md`](../product/DECISIONS_APPROVED.md).

El administrador debe obtener metadatos reales **mediante SELECT/SHOW read-only**: `SHOW CREATE TABLE`, índices y collation; columnas NOT NULL/default/foreign keys/triggers; un ejemplo aprobado del flujo actual por cada tipo; permisos del usuario de servicio; y reglas para relación entre factura, pagos y complementos. Registrar evidencia sin credenciales ni datos privados. Actualizar esta spec y una ADR si cambia el contrato.
