# Plan ejecutable propuesto — PS-004, PS-005 y RF-1

**Estado:** propuesta de secuenciación; ninguna de estas tareas está iniciada
**Restricción:** no iniciar PS-004, PS-005, RF-1 ni PS-004 de AGENTS.md sin aprobación del cierre de PS-003 y una autorización específica.

## Dependencias y puerta de alcance

La solicitud actual propone:

1. **PS-004:** dashboard base, navegación, registro de módulos y configuración de visibilidad.
2. **PS-005:** administración de clientes, credenciales cifradas y conectores.
3. **RF-1:** inserción de facturas con previsualización, validación, idempotencia y auditoría.

Hay una diferencia con la secuencia versionada en `AGENTS.md` y `TASK_BOARD.md`: el baseline asigna RBAC/usuarios a PS-004 y dashboard/catálogo a PS-006, mientras PS-003 ya entregó el núcleo de usuarios para revisión. Este documento respeta la propuesta para planificación, pero esa reasignación debe reconciliarse en el tablero/contratos por el responsable antes de ejecutar. No se cambia unilateralmente `AGENTS.md` ni se mueve el estado de PS-006.

## Orden recomendado

### PS-004 — Dashboard, navegación y catálogo de módulos

**Precondiciones:** aceptación final de PS-003; reconciliación explícita del alcance PS-004/PS-006; contratos de capabilities y `ModuleManifest` aprobados.

**Iteraciones verificables:**

1. Contrato tipado de módulos con `id`, `version`, `displayName`, `route`, `requiredCapabilities`, `supportedConnectionTypes`, `backendActions`, `visibilityDefault=false`, `featureFlags`, `minimumCoreVersion` y `health`.
2. Registro estático central y validación de manifests; no cargar código ejecutable dinámico desde la BD.
3. API administrativa para visibilidad/activación por rol/cliente; checks efectivos en backend con deny-by-default y auditoría.
4. Dashboard mínimo para ADMIN/SUPPORT, navegación sensible a capacidades y estados vacío/error/carga; sin conexiones de clientes ni RF-1.
5. Pruebas de contrato, autorización, rutas, teclado, responsive y accesibilidad; validación visual Apple Design y evidencia en WORKLOG antes de cerrar.

**Criterios:** manifest inválido no se registra; módulo invisible por defecto; llamada directa a endpoint no autorizado devuelve 403; el cliente no puede activar módulos; estados de navegación son accesibles con teclado y lector de pantalla.

### PS-005 — Clientes, secretos cifrados y conectores

**Precondiciones:** broker y capabilities públicos de PORTAL_CORE; política de clave maestra/KMS/rotación aprobada; matriz de datos permitidos para cada conector y amenaza de acceso interno revisadas.

**Iteraciones verificables:**

1. Entidad de cliente y estado de conexión, con restricciones y auditoría; migraciones solo en PostgreSQL del Portal.
2. Cifrado autenticado de secretos con envelope encryption; clave maestra fuera de la BD/repositorio; versionado de clave y procedimiento de rotación/revocación.
3. `ClientConnectionBroker` con perfiles mínimos soportados, pools acotados, TLS/host verification, timeout y cierre; no exponer credenciales a SUPPORT ni abrir SQL/SSH arbitrario.
4. Operación administrativa de alta/prueba/rotación/desactivación, con respuesta sin secreto y auditoría incluso ante fallo.
5. Pruebas unitarias, integración aislada, concurrencia/revocación y verificación de que los logs/errores no filtran material sensible.

**Criterios:** SUPPORT recibe 403; una credencial cifrada nunca vuelve en API/logs; una clave inválida falla cerrada; conectores solo ejecutan operaciones declaradas; límites de pool y timeout son efectivos.

### RF-1 — Inserción de facturas fiscalmente segura

**Precondiciones:** PS-005 aporta broker público; revisión de DDL/lookup del cliente y ambiente SAP; datos sintéticos; aprobación técnica independiente de cada puerta VT aplicable. RF-1 permanece independiente de Complementos.

**Iteraciones verificables:**

1. Parser CFDI 4.0 de solo lectura: deshabilitar DTD/entidades externas, límites de tamaño/recursos, validación de well-formedness y perfiles soportados; nunca reparar o reescribir XML origen.
2. Previsualización con mapeo y validaciones; lookup por RFC emisor + ambiente SAP + sociedad; no escritura todavía.
3. Comprobación de duplicados e idempotencia razonable para el esquema remoto; conflicto o resultado ambiguo se representa como `INDETERMINADO`, sin reintento ciego.
4. Ejecutor acotado: confirmación expresa; transacción; solo `INSERT` permitido; auditoría antes/después; verificación postoperación.
5. Pruebas unitarias con XML sintéticos, integración aislada contra contrato/fixture autorizado, concurrencia, rollback, errores y E2E; no usar BD de cliente.

**Criterios:** no mutar XML original; no escribir antes de confirmar; una segunda solicitud no duplica inserción dentro de las garantías reales del esquema; rollback ante error; toda escritura deja evidencia auditable; respuesta ambigua no reintenta.

## Diseño de UI

Antes de cualquier componente, HTML visible, CSS, navegación, interacción o accesibilidad, leer realmente `.agents/skills/apple-design/SKILL.md`. Aplicar jerarquía tipográfica, contraste y espaciado consistentes, materiales con moderación, interacción predecible, movimiento reducido y accesibilidad de teclado/WCAG; registrar ruta, criterios y validaciones visuales/accesibilidad en `WORKLOG.md`. Esta planificación no modifica UI.

## Riesgos de secuencia

- PS-003 sigue `EN_REVISION`; integración PostgreSQL real de la corrección `portal` todavía no se ejecutó.
- En PS-003.2 se repitieron pruebas PostgreSQL reales en `portal_soporte_test` (53/53 integración, 8/8 E2E y CLI de migración); no se usó `portal_soporte` para pruebas destructivas. INFRA-001 queda `EN_REVISION` después de inventario read-only y migraciones autorizadas.
- MFA ADMIN, SMTP real, respaldo/restauración verificados, revisión de exposición de PostgreSQL, revisión independiente y el moderado de `esbuild` en desarrollo permanecen abiertos. Picomatch conserva revisión **2026-12-10 UTC** y vencimiento de aceptación temporal **2026-12-17 UTC**.
- El inventario de Debian 12/PostgreSQL 15.20 y las ACL está registrado en WORKLOG y `DEPLOYMENT_DEBIAN.md`; no se modificaron servicios ni túneles. No guardar ni enviar secretos por chat.
