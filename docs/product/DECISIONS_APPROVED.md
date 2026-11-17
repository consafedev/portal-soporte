# Decisiones funcionales aprobadas — Línea base v0.2

**Fecha:** 2026-11-17  · **Estado:** APROBADAS POR EL PROPIETARIO EN CONVERSACIÓN  · **Alcance:** producto y contratos de RF-1.

Este documento **sí cierra decisiones de negocio**. No declara verificadas las tablas ni las conexiones de los clientes. Los datos reales deberán comprobarse antes de implementar escrituras y, en especial, antes de activar la función en producción. Ver `OPEN_DECISIONS.md`.

| ID | Decisión aprobada | Consecuencia para desarrollo |
|---|---|---|
| AP-001 | El primer módulo se llama **Insertar facturas en BD**, ID técnico `rf-1`. | No desarrollar complementos en RF-1. |
| AP-002 | **Complementos** será otro módulo, con spec/manifest/permisos independientes. | Se permite reutilizar parser/broker mediante interfaces compartidas; no dependencia directa entre módulos. |
| AP-003 | Estatus elegibles: `CONTABILIZADO` y `PAGADA`. Ambos se permiten al crear registros. | No exigir registro previo en `factura_pagos` para insertar con `PAGADA` por criterio del propietario; validar igualmente integridad técnica del esquema. |
| AP-004 | Un proveedor se considera **activo si existe en BD** en el contexto correcto. | No interpretar `marcado_borrado`, `contabilizar` ni otros indicadores como filtros de vigencia para RF-1. |
| AP-005 | Una sociedad se considera **activa si existe en BD** en el contexto correcto. | No exigir columna `activo` inexistente en capturas. |
| AP-006 | El mismo RFC de proveedor puede aparecer en **varios ambientes SAP**, legítimamente. | La unicidad se evalúa **dentro del ambiente SAP de la sociedad** y de la propia sociedad, nunca globalmente por RFC. |
| AP-007 | Resolver primero `sap_sociedad` por RFC receptor; después proveedor por RFC emisor + `ambienteSap` de esa sociedad + clave de sociedad. | No escoger primer registro ni cruzar ambientes/sociedades. Selección explícita de sociedad/ambiente cuando haya varias sociedades válidas. |
| AP-008 | Si no hay registro o hay más de un candidato dentro del contexto exacto, bloquear **solo la fila** y explicar el motivo. | Validación por CFDI y errores accionables; 0 escrituras para filas bloqueadas. |
| AP-009 | El stack del ADR-0001 está aprobado. | Next.js + React + TS / Fastify / PostgreSQL / mysql2 + ssh2 / Debian + systemd / Cloudflare Tunnel, sin Docker. |
| AP-010 | Toda escritura contará con vista previa, autorización, confirmación, transacción, auditoría y SELECT posterior. | Sin SQL libre ni SSH libre para soporte. |
| AP-011 | **Clean Code y comentarios en español** para cada función, método, clase, componente, hook y contrato. | JSDoc/TSDoc de propósito, entradas, salidas y efectos relevantes; ver `docs/standards/CLEAN_CODE.md`. |
| AP-012 | Aplicación modular, con módulos ya desplegados habilitables por administrador sin redeploy. | Permisos en backend por rol, cliente y capacidad; módulos nuevos requieren release controlada. |

## Regla de resolución contextual (contrato funcional cerrado)

1. El usuario selecciona un **cliente** y perfil BD habilitado, dentro de sus permisos. `PROD/TEST` describe el **entorno operativo de la conexión**; NO equivale a `ambienteSap`.
2. Usar `Receptor.Rfc` para consultar `sap_sociedad.rfc` **en la base de datos elegida**. Si solo hay una sociedad válida para el contexto, seleccionarla. Si el RFC tiene varias sociedades/ambientes posibles, mostrar únicamente las opciones reales autorizadas y exigir selección explícita antes de continuar; nunca inferir automáticamente. Si no existe: bloquear.
3. Usar la fila de `sap_sociedad` elegida como fuente de verdad: `sociedad` y `ambienteSap` (p. ej. `E1P`, `OPE`).
4. Buscar `sap_proveedor` donde **`rfc = Emisor.Rfc` AND `ambienteSap = sociedad.ambienteSap` AND `sociedad = sociedad.sociedad`**. Requerir **exactamente una fila** en ese contexto. Múltiples filas con el RFC en otros ambientes/sociedades son legítimas y **se ignoran para esta operación**.
5. Si se encuentra exactamente una fila: `factura.creadoPor = sap_proveedor.idProveedor` y `factura.sociedad = sap_sociedad.sociedad`. Nunca usar `id_usuario` como sustituto de `idProveedor`.
6. Si no hay coincidencia, bloquear con causa concreta. Si hay varias filas **dentro del mismo contexto exacto**, bloquear por ambigüedad. Al confirmar, revalidar ambas asociaciones en la misma conexión.
7. **No aplicar filtros de vigencia adicionales**; `marcado_borrado`, `contabilizar`, etc., NO entran en el criterio funcional de actividad acordado.

### Mensajes de la interfaz (sin exhibir detalles secretos)

| Código | Mensaje al agente |
|---|---|
| `RF1_SOCIETY_NOT_FOUND` | «El RFC receptor {RFC} no corresponde a ninguna sociedad registrada en la base de datos del cliente seleccionado. No se insertó esta factura.» |
| `RF1_SOCIETY_SELECTION_REQUIRED` | «El RFC receptor {RFC} tiene más de una sociedad o ambiente SAP asociado. Selecciona la sociedad y el ambiente correctos para continuar.» |
| `RF1_SUPPLIER_NOT_FOUND` | «El RFC emisor {RFC} no corresponde a ningún proveedor registrado para la sociedad {SOCIEDAD} en el ambiente SAP {AMBIENTE}. No se insertó esta factura.» |
| `RF1_SUPPLIER_AMBIGUOUS` | «Se encontraron varios proveedores para el RFC emisor {RFC} dentro de la sociedad {SOCIEDAD} y el ambiente SAP {AMBIENTE}. Contacta al administrador; no se insertó esta factura.» |
| `RF1_CONTEXT_MISMATCH` | «La sociedad/ambiente elegidos no pertenecen al cliente o conexión autorizados, o cambiaron desde la vista previa. No se insertó esta factura.» |
| `RF1_CATALOG_UNAVAILABLE` | «No fue posible verificar el catálogo del cliente en este momento. No se insertó esta factura; vuelve a intentar después de recuperar la conexión.» |

Estos códigos son estables para API, frontend, tests y auditoría. No exponer SQL, hosts, puertos, usuario DB ni otros candidatos en errores destinados a soporte.

## Alcance del cierre

- **Cerrado:** reglas de negocio anteriores, rol/visibilidad, dos estados, separación de módulos, stack y norma de código.
- **Pendiente de evidencia, NO de inventar requisitos:** DDL/collation/índices/triggers reales, compatibilidad `NULL`/defaults, prueba de transacción en MySQL de laboratorio, configuración exacta de conexión por cliente, políticas operativas de hosting y retención, MFA. No habilitar escrituras productivas antes de superar las puertas de `OPEN_DECISIONS.md`.
