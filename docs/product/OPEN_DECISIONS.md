# Verificaciones técnicas y operativas pendientes — v0.2

**Versión:** 0.2.0 · **Fecha:** 2026-11-17 · **Estado:** pendientes verificaciones, **NO decisiones funcionales**. Las reglas de negocio están cerradas en [`DECISIONS_APPROVED.md`](DECISIONS_APPROVED.md).

**Interpretación:** Las tareas de análisis, UI, mocks y parser pueden avanzar sin acceso a BD productivas; **ningún agente puede activar INSERT ni declarar release listo** hasta superar las puertas pertinentes con evidencia. Pendiente ≠ permiso para improvisar valores.

| ID | Puerta | Evidencia mínima | Bloquea |
|---|---|---|---|
| VT-01 | DDL real `factura`, `sap_sociedad`, `sap_proveedor` | `SHOW CREATE TABLE`/metadatos sanitizados, tipos, nulos/defaults, triggers, índices, collation por perfil compatible, con acceso read-only autorizado | INSERT |
| VT-02 | Identidad/duplicados UUID | PK/UNIQUE real, contexto de schema, concurrencia transaccional, plan de conciliación | INSERT |
| VT-03 | Mapeo fiscal y valores vacíos | Confirmar `noa`, `nea`, `nodocumentopago`, `rutaPdf`, `numctapago`, `nodocumentologistico`, `detraccion_pe`, IVA, impuestos, límites y ejemplos sintéticos | INSERT |
| VT-04 | Fechas y zona horaria | Verificar semántica de `fechaCarga` y `ejercicio` en destino; test de cambio de fecha; no alterar fecha fiscal | INSERT |
| VT-05 | Seguridad de acceso a DB | Cuenta con mínimos privilegios, TLS/host SSH verificados y permisos efectivos por cliente | INSERT |
| VT-06 | Conexión/catálogos y multiambiente | Prueba con dataset sintético de L-01..L-10; verificar cómo comparan RFC según collation y que `ambienteSap` se lee de sociedad | INSERT |
| VT-07 | Política de datos fiscales | Retención temporal, cifrado, borrado, auditoría, backups y tratamiento de incidentes establecidos | PROD |
| VT-08 | Gobierno de usuarios/operación | MFA admin, bootstrap, revocación, alcance de clientes y módulos, confirmación PROD, revisión independiente | PROD |
| VT-09 | Compatibilidad del estatus con esquema | Probar en **laboratorio** INSERT `CONTABILIZADO` y `PAGADA`; el negocio YA aprobó ambos, verificar restricciones/triggers existentes, sin reinterpretar requisito | INSERT |
| VT-10 | Infraestructura Debian/Cloudflare | Inventario de servicios, puertos libres, túneles, DNS/certificado/subdominio y plan de rollback, sin alterar servicios ajenos | Deploy |
| VT-11 | Compatibilidad de conectividad MySQL | Matriz práctica TCP, URL, SSH con password, `.pem`/`.ppk` soportados, passphrase, CA y claves de host | Conector PROD |
| VT-12 | Límites y resiliencia | Pruebas de 100 XML, 5 MiB/archivo, 25 MiB/solicitud, concurrencia, memoria, idempotencia y cancelación; ajustar con evidencia | PROD |
| VT-13 | Respaldo y observabilidad | Backup/restauración PostgreSQL, rotación de llaves, logs sin PII, health, alertas, rollback | Deploy |

## Decisiones funcionales ya cerradas; NO volver a bloquear al equipo por ellas

- `DEC-003`: el propietario **autoriza** INSERT con `PAGADA` sin requerir registro previo en `factura_pagos` como regla de negocio; solo probar que esquema/triggers lo aceptan (VT-09).
- `DEC-004` y `DEC-008`: RF-1 resuelve sociedad por RFC receptor y proveedor por RFC emisor **+ sociedad + ambiente SAP de esa sociedad**; un RFC de proveedor en varios ambientes es totalmente válido. Si hay varias sociedades/ambientes candidatos, pedir selección explícita (VT-06 para prueba técnica).
- Actividad: **si existe el registro en el contexto requerido, está activo**; no consultar `marcado_borrado` ni otras banderas de vigencia.
- `DEC-011`: primer release de RF-1 solo CFDI 4.0 de ingreso `I`. CFDI E y P son módulos/flujos futuros con specs propias.
- Pila del ADR-0001 aprobada. Código documentado en español según `CLEAN_CODE.md`.
- Scripts SQL manuales y complementos no forman parte de RF-1 MVP, y no habilitan Workbench para soporte.

## Proceso para cerrar cada puerta

1. Asignar propietario técnico y tarea PS-###; acceso real únicamente si está autorizado.
2. Adjuntar evidencia **sanitizada** (sin XML completos, SQL con secretos, contraseñas ni certificados privados), resultados de prueba y riesgos.
3. Actualizar `WORKLOG.md` con decisión, timestamp, evidencia y revisión.
4. Marcar `VERIFICADA` o `BLOQUEADA` con referencia de PR/commit/acta; modificar spec si hay incompatibilidad técnica, pero **no sobrescribir decisiones funcionales** sin autorización explícita.

**Primera ejecución autorizada de Codex:** PS-001 es diagnóstico **read-only del repo** y acceso adicional solamente si se le concede. El levantamiento de DDL no es imprescindible para empezar a crear la UI o el parser; sí para escribir registros.
