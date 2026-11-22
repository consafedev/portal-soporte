# RF-1 — Incremento de análisis fiscal y vista previa por lote

> **Para agentes de implementación:** seguir `superpowers:executing-plans` tarea por tarea; comprobar cada paso mediante pruebas antes de avanzar.

**Objetivo:** enriquecer el núcleo puro de RF-1 para extraer campos fiscales exactos y producir vistas previas independientes para lotes XML, sin escribir en destinos.

**Arquitectura:** extender `modules/rf-1` en la capa de dominio. El parser conserva bytes como entrada inmutable, extrae solo nodos CFDI 4.0 permitidos y usa cadenas decimales exactas. El lote reutiliza el puerto `CatalogoLecturaRf1` inyectado y procesa cada documento de forma secuencial; no añade endpoint, UI, SQL ni operaciones de escritura.

**Stack:** TypeScript estricto, `saxes`, Vitest y utilidades nativas.

**Especificaciones:** `docs/specs/RF-1_INSERTAR_FACTURAS_BD.md`, `docs/specs/RF-1_LOOKUP_RULES.md`, `docs/specs/RF-1_FIELD_MAPPING.md`, `AGENTS.md`.

## Límites globales

- Aceptar exclusivamente CFDI 4.0 de ingreso (`TipoDeComprobante=I`) en este incremento.
- Los importes permanecen como texto decimal exacto; no usar `float`.
- Rechazar DTD/entidades, exceso de tamaño/profundidad/nodos y XML malformado sin persistir el documento.
- Los impuestos se agregan solo desde el resumen CFDI del comprobante y se clasifican por código federal; ignorar impuestos locales y nodos de concepto para no duplicar sumas.
- Procesar hasta 100 XML y 25 MiB agregados, un archivo a la vez, conservando resultado individual aunque falle otro.
- No conectar destinos MySQL, no ampliar `ClientConnectionBroker`, no alterar contratos compartidos, no insertar ni auditar datos reales.
- No modificar UI; PS-008 conserva la presentación de lotes.
- Abrir una ADR/propuesta independiente antes de extender el broker con consultas semánticas reales de catálogo RF-1.

## Archivos previstos

- `modules/rf-1/src/types.ts`: campos de lectura fiscal exacta y errores estables.
- `modules/rf-1/src/cfdi-xml-parser.ts`: extracción/validación de atributos del comprobante e impuestos federales agregados.
- `modules/rf-1/src/preview.ts`: límites y resultado de lote, reutilizando el puerto de lectura existente.
- `modules/rf-1/src/index.ts`: exportaciones públicas del incremento.
- `tests/unit/rf1-preview.test.ts`: fixtures XML sintéticos y pruebas de regresión/parser/lote.
- `docs/operations/TASK_BOARD.md` y `WORKLOG.md`: estado, evidencias y límites.

## Tareas comprobables

- [x] Escribir prueba roja para extraer subtotal/descuento y clasificar/sumar IVA trasladado e ISR/IVA/IEPS retenidos desde el resumen CFDI, ignorando impuestos de concepto y complementos locales.
- [x] Implementar el mínimo parser para esa prueba con suma decimal por cadenas y ejecutar el test focal.
- [x] Escribir prueba roja para lote mixto que conserva filas y errores por documento, con límites de cantidad/tamaño.
- [x] Implementar procesamiento secuencial acotado y ejecutar los tests focales.
- [x] Ejecutar suite unitaria completa, lint, typecheck, formato específico del cambio, build y controles de secretos/dependencias. Nota: el `format:check` global continúa señalando 106 archivos preexistentes del baseline de checkout; no se reformatearon en masa.
- [x] Revisar diff y registrar auto-revisión final, límites, riesgos y estado EN_REVISION.

## Foco de revisión

- Un traslado/retención de un concepto no se cuenta junto con el total agregado del comprobante.
- Impuestos de namespaces locales y complementos no contaminan los montos federales.
- La suma de importes conserva precisión y bloquea valores incompatibles, sin redondeo silencioso.
- Un archivo inválido no oculta los demás resultados ni deja datos del XML en errores/logs.
- Los límites de 100 XML y 25 MiB se verifican antes de invocar el catálogo.

## Límite conocido

El DDL real de factura/SAP y la conexión con destinos MySQL no han sido aprobados para esta iteración; el resultado es un dominio de análisis/preview probado con datos sintéticos y no habilita inserciones.

## Cierre de este incremento (2026-11-21)

- Tests: `rf1-preview.test.ts` 24/24; suite unitaria completa 289/289; integración PostgreSQL remota aislada `portal_soporte_test` 61/61; E2E remoto aislado 12/12. Las dos últimas se ejecutaron antes del último cambio parser-only (sin cambios de API/UI); no se cuentan como una ejecución posterior a ese cambio.
- Calidad: lint, typecheck, build, Secretlint y gate de dependencias CI PASS. Prettier focal PASS. El chequeo global de formato falla por 106 archivos del baseline; `git diff --check` PASS.
- Revisión final: no hay endpoint, UI, broker nuevo, lectura de destinos, datos/XML reales ni escritura; no se tocó infraestructura para RF-1. El adaptador de lookup semántico se difiere a una ADR/propuesta aditiva aprobada.
- Estado del plan: terminado para el incremento de dominio parse/preview y presentado `EN_REVISION`, no significa cierre de RF-1 ni autorización para PS-008/PS-009.
