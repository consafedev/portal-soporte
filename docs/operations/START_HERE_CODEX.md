# PS-001 — Primer encargo listo para Codex / OpenCode / Antigravity

**Versión:** v0.2 · **Modalidad:** lectura de repositorio y documentación; exclusivamente diagnóstico. **Prohibidos** writes sobre servidores, BD clientes, producción, DNS, Cloudflare y secretos.

## Prompt para copiar al agente

> Actúa como arquitecto e ingeniero principal del **Portal de Soporte e-Billia**. Tu primera tarea es **PS-001, INVENTARIO Y VALIDACIÓN DE LÍNEA BASE**, exclusivamente lectura de repositorio/código/configuración y redacción de hallazgos. Aún NO implementes PS-002, no instales dependencias ni alteres la infraestructura.
>
> 1. Lee íntegros `AGENTS.md`, `README.md`, `docs/product/PROJECT_CHARTER.md`, `docs/product/DECISIONS_APPROVED.md`, `docs/product/OPEN_DECISIONS.md`, `docs/standards/CLEAN_CODE.md`, `docs/specs/PORTAL_CORE.md`, `docs/specs/RF-1_INSERTAR_FACTURAS_BD.md`, `docs/specs/RF-1_LOOKUP_RULES.md`, `docs/specs/RF-1_FIELD_MAPPING.md`, `docs/architecture/ADR-0001_STACK.md`, `docs/operations/{TASK_BOARD,WORKLOG,TEST_STRATEGY,DEPLOYMENT_DEBIAN}.md`.
> 2. Inspecciona sin modificar: rama, commit, `git status`, árbol de directorios, README existente, skill Apple Design, paquetes/configuraciones existentes, lockfiles, scripts, `.gitignore`, workflows CI y posibles diferencias con la estructura modular propuesta. No borres ni reescribas archivos existentes sin autorización.
> 3. La regla de RF-1 **está cerrada**: `sap_sociedad` se consulta por RFC receptor; de ella sale `sociedad` y `ambienteSap`; `sap_proveedor` se consulta por RFC emisor + **ese** `ambienteSap` + **esa** `sociedad`. Un RFC de proveedor en otros ambientes es legítimo. Existencia en BD = activo, sin filtrar `marcado_borrado`. Si el RFC receptor tiene varios pares sociedad/ambiente, se requiere selección explícita. Estatus permitidos `CONTABILIZADO` y `PAGADA`. RF-1 no procesa complementos. No vuelvas a plantear estas reglas como preguntas abiertas.
> 4. Evalúa el ADR-0001 como **stack ya aprobado**. Contrasta únicamente detalles de implementación existentes: infraestructura, integridad del repositorio, dependencias, compatibilidad y riesgos. Aplica Clean Code y exige comentarios JSDoc/TSDoc en español para cada función, clase, método y componente en futuras tareas.
> 5. **Sin conexiones de producción**: no realices `git push`, despliegues, migraciones, cambios en systemd/Cloudflare, conexión MySQL/SSH, consultas DDL, operaciones SQL, ejecución de tests con efectos, instalaciones ni manipulación de llaves. Si el propietario te da más adelante permiso explícito de auditoría read-only sobre un entorno, trátalo como una tarea separada.
> 6. Entrega un informe `PS-001` en el chat con: (a) inventario real y commit base, (b) discrepancias con v0.2, (c) riesgos, (d) evidencias/órdenes **read-only** ejecutadas y sus resultados, (e) próximos pasos de PS-002 sin ejecutarlos, (f) verificaciones técnicas que siguen pendientes. No inventes accesos ni resultados.
> 7. Para documentar, tienes permiso **únicamente** de añadir al final una entrada a `docs/operations/WORKLOG.md` y actualizar el renglón PS-001 en `docs/operations/TASK_BOARD.md`; ningún otro cambio. Registra `NO EJECUTADO` cuando corresponda. En caso de que la bitácora o tablero contengan cambios de otra persona, no sobrescribir; reporta conflicto.
> 8. Si no tienes acceso al servidor o BD, márcalo **SIN ACCESO / NO VERIFICADO**, no como fallo de diseño ni como permiso para pedir contraseñas en el chat.

## Alcance y criterio de aceptación

- Inspección Git/read-only con comandos como `git status --short --branch`, `git log -1 --oneline`, `git ls-files` y lectura de archivos. Nunca usar comandos destructivos.
- No desplegar, iniciar servicios, descargar ejecutables ni iniciar conexiones BD/SSH sin una nueva autorización.
- **Únicas ediciones permitidas para PS-001:** anexar al `WORKLOG.md` y actualizar el estado de PS-001 en `TASK_BOARD.md`; el inventario y análisis quedan en respuesta/chat o archivo nuevo solo con permiso explícito.
- PS-001 se considera HECHO solo con evidencia honesta y revisión del propietario; el paso siguiente **PS-002** se inicia después de esa revisión.

**Repositorio:** https://github.com/consafedev/portal-soporte.git<br>
**Documento funcional de referencia:** https://docs.google.com/document/d/12U-xIyp4zuyLMG6h9QVCHi-egBK91_d9mTzlDcjsNJ0/edit<br>
**Skill:** conservar la skill existente Apple Design; no reemplazarla.
