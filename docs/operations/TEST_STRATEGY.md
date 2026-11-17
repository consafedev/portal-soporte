# Estrategia de pruebas y quality gates

**Versión:** 0.2. Ninguna prueba con datos de clientes sin aprobación y aislamiento explícitos.

## Capas

- **Unitarias:** permisos/roles, `ModuleManifest`, parser XML namespace-aware, mapeo a `factura`, `Decimal`, longitud de columnas, `Serie+Folio`, normalización RFC, estados.
- **Integración:** PostgreSQL aislada del portal, fake/vault mock, MySQL de pruebas con esquema controlado que replique columnas, broker SSH con host test y fingerprints, transacciones/locks.
- **E2E:** Playwright en navegador desktop/móvil, roles, tema, accesibilidad, cliente seleccionable, carga batch, estado por fila, sesión expirada, rollback UI.
- **Seguridad:** IDOR/BOLA (API de otro cliente), SQL injection, host/port SSRF desde configuración (solo admin y allowlist), XXE/DTD/bombs, credenciales/llaves en API, logs, cookies, CSRF, privilege escalation, replays e idempotency.
- **Resiliencia:** timeout y caída SSH antes/durante/después del commit, MySQL host inalcanzable, reinicio API con job en vuelo, doble click, carga repetida, dos usuarios mismo UUID, cambios de RFC/proveedor entre preview y commit.
- **Experiencia:** estados claros, contrastes, keyboard y screen reader, reduced motion/transparency, responsive, textos de errores sin secretos.

## Fixtures necesarios (sintéticos, NUNCA XML de clientes reales en Git)

CFDI 4.0: I ordinario, sin serie/folio, solo folio, descuento, IVA trasladado, IEPS trasladado, retenciones ISR/IVA y complemento local, XML con complemento adicional de concepto, XML mal formado, XML con `DOCTYPE`, BOM anómalo (solo detección), UUID duplicado, RFC emisor/receptor sin catálogo, mismo RFC en varios ambientes SAP (sin bloqueo), varios proveedores dentro de una sola sociedad+ambiente SAP (bloqueo), selección de sociedad por receptor, valores que exceden columnas, CFDI E/P rechazados en MVP, monto fraccionario y moneda no validada.

## Casuística RF-1 contextual

Ejecutar obligatoriamente los escenarios L-01..L-10 de `docs/specs/RF-1_LOOKUP_RULES.md`. El RFC de un proveedor repetido en distintos ambientes SAP es válido; la coincidencia debe ser única dentro del par de sociedad y ambiente seleccionados. Verificar ambos valores `CONTABILIZADO` y `PAGADA` en tests de integración de laboratorio, sin preexistencia obligatoria de `factura_pagos`. Revisar el cumplimiento JSDoc/TSDoc en español de todas las funciones, clases, métodos y componentes nuevos.

## Gate de CI requerido para merge

`format:check`, `lint`, `typecheck`, `test:unit`, `test:integration`, `build`, scanner de secretos, dependencias y revisión de cambios. Tests E2E para PRs que alteren rutas críticas; reportes deben declarar versiones y pruebas **realmente ejecutadas**. Revisión independiente para `client-credentials`, `RBAC`, `rf-1:execute`, `audit`, `deploy`. Un fallo de seguridad bloquea merge. No permitir `skip` sin ADR aprobada.

## Gate de producción

Tests básicos verdes + backup/restore verificado + inventario + cero secretos en build + un piloto de prueba + revisión de DDL y puertas VT-01..VT-13 aplicables + supervisión y rollback. No equiparar **build exitoso** con **sistema listo para producción**.
