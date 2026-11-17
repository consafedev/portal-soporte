# Acta de proyecto — Portal de Soporte e-Billia

**ID:** PS | **Versión:** 0.2 | **Fecha:** 2026-11-17 | **Estado:** alcance funcional aprobado; liberación productiva sujeta a pruebas

## Contexto del negocio

Los agentes de soporte e-Billia realizan verificaciones e incidencias que hoy exigen acceso directo a bases de datos MySQL y logs en servidores (habitualmente bajo rutas Tomcat). La solución centraliza capacidades en flujos guiados y auditables, sin distribuir secretos a los usuarios. El objetivo es reducir errores operativos, tiempo de atención y superficie de acceso, manteniendo controles claros para actividades que alteren datos.

## Objetivos medibles (propuestos; umbrales por acordar)

- Ningún agente de soporte debe recibir/visualizar credenciales de clientes ni llaves SSH.
- 100 % de escrituras ejecutadas por el portal con identidad, cliente, acción, fecha, resultado y evidencia verificable (sin secretos).
- Cada módulo podrá encenderse o apagarse por rol sin redeploy **una vez desplegado y habilitado su contrato**.
- Cada factura procesada tendrá resultado individual, causa de rechazo y trazabilidad.
- UX comprensible, rápida, responsiva, accesible y consistente en tema claro/oscuro.

## Actores

- **Administrador (ADMIN):** gestiona usuarios, roles, resets, conexiones, certificados/llaves, configuración del portal, módulos y permisos por rol. Puede operar módulos que tenga habilitados.
- **Soporte (SUPPORT):** opera módulos autorizados y clientes asignados, cambia contraseña, avatar y tema; nunca administra secretos, usuarios, conexiones o activaciones.
- **Sistema:** autentica, cifra credenciales, audita, analiza archivos, ejecuta conectores restringidos y verifica escrituras.

## Fases

| Fase | Entregable | Puerta de salida |
|---|---|---|
| F0 — Gobierno | AGENTS, specs, decisiones, tablero, bitácora | Revisión/aprobación de requerimientos |
| F1 — Núcleo | Login, sesiones, RBAC, usuarios, clientes, conexiones, dashboard, catálogo, UI | Pruebas de acceso cruzado y usabilidad |
| F2 — RF-1 | Carga CFDI I, preview, mapeo, control de duplicado, inserción, verificación | Ensayo con fixtures sintéticos y piloto controlado |
| F3 — Expansión | Complementos de pago, logs, consultas, reemplazos, etc., cada uno con spec | Aprobación independiente por módulo |
| F4 — Operación | Monitoreo, backup, rotación, recuperación, métricas | Checklist de producción validado |

## Relación con el PRD de origen

El documento fuente llama **RF1 - Complementos** a un conjunto amplio que cubre análisis de complementos, registro de documentos, cambios de estatus y generación opcional de SQL. **Decisión de alcance aprobada:** el nombre público del primer módulo será **«Insertar facturas en BD»** (ID técnico inmutable `rf-1`), restringido inicialmente a la inserción controlada de CFDI de ingreso. El análisis de complementos, actualización `PARCIAL CON COMPLEMENTO`, corrección de BOM y scripts manuales de acceso directo quedan **fuera del MVP** y se documentarán por separado. Las notas de crédito (CFDI E) son objetivo de compatibilidad posterior sujeto a validación de negocio y pruebas; no insertarlas silenciosamente con reglas de factura I.

## Exclusiones y límites

- Los registros en `sap_proveedor` y `sap_sociedad` se consideran activos por su **existencia en la BD seleccionada**. Un mismo RFC de proveedor en distintos ambientes SAP es normal; debe buscarse exclusivamente en el ambiente SAP y sociedad derivados del RFC receptor. Ver reglas aprobadas de v0.2.
- Dos estatus válidos al insertar: `CONTABILIZADO` y `PAGADA`, sin requerir por negocio un registro de pago preexistente.
- Todo código tendrá arquitectura Clean Code, con documentación JSDoc/TSDoc en español por función, método, clase, componente y contrato.

- No pretende ser un reemplazo genérico de MySQL Workbench/PuTTY con acceso libre; replica los **métodos de conectividad necesarios**, no las capacidades administrativas sin control.
- No modifica el esquema, triggers, datos ajenos o software existente del cliente sin aprobación específica.
- No realiza corrección/reconstrucción de XML fiscales ni ofrece reparación automática de BOM; solo detecta incompatibilidades y explica el bloqueo.
- No incluye despliegue, automatización de instalaciones, incorporación de cuentas reales ni inserciones productivas dentro del entregable documental.

## Dependencias y riesgos principales

Disponibilidad del DDL real de cliente, reglas de unicidad/índices de `factura`, selección unívoca de sociedad/proveedor, consentimiento/permiso de escritura, prueba de autenticación por tipo de conexión, convenciones de estados, políticas de retención de XML y coexistencia con los servicios/túneles Debian actuales. Ver `OPEN_DECISIONS.md`.

## Fuentes y decisiones

Decisiones aprobadas: [`DECISIONS_APPROVED.md`](DECISIONS_APPROVED.md). Puertas técnicas: [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md).

Documento de referencia: https://docs.google.com/document/d/12U-xIyp4zuyLMG6h9QVCHi-egBK91_d9mTzlDcjsNJ0/edit. El alcance inicial y los roles provienen del brief del propietario del 2026-11-17; las normas de seguridad y arquitectura son recomendaciones técnicas, no hechos constatados de la infraestructura.
