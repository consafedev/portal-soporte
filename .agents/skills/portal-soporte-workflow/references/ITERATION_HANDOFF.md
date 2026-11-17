# Ciclo reproducible: START → CHECK → HANDOFF

## START (antes de editar)

1. Leer la línea base indicada por `AGENTS.md` y la ruta documental.
2. Confirmar `PS-###`, owner, estado, alcance, aceptación, permisos y herramientas disponibles.
3. Capturar `git status --short --branch`, `git rev-parse HEAD`, `git diff --stat` si hay cambios; **no limpiar** archivos ajenos.
4. Verificar skill `portal-soporte-workflow` y, para UI/UX, **leer** `apple-design` antes de tocar la interfaz.
5. Anexar al `WORKLOG.md` entrada `INICIO`: timestamp real con zona, agente, task, contexto Git, plan, rutas previstas, validaciones, riesgos y declaración explícita de no acceso productivo cuando proceda. Cambiar a `EN_CURSO` la fila del tablero sin reescribir otras.

## CHECK (durante la tarea)

- Documentar decisiones técnicas nuevas mediante ADR/propuesta cuando afecten contratos compartidos; no inventar reglas fiscales.
- Mantener cambios limitados al scope. Validar con mocks/datos sintéticos. No incluir archivos fiscales reales ni secretos.
- Si aparece un bloqueo, documentar `BLOQUEADO`, conservar estado y detener acciones no autorizadas.

## HANDOFF (tras trabajo o interrupción)

1. Ejecutar verificaciones habilitadas: `format:check`, `lint`, `typecheck`, `test`, `build`, `git diff --check` y escaneo de secretos (según alcance). No ejecutar comandos que cambien producción o infraestructura.
2. Anexar al `WORKLOG.md` nueva entrada `ENTREGA A REVISIÓN`, `CIERRE` o `BLOQUEO` con el formato existente (timestamp, agente, task, rama/commit base, cambios, rutas, pruebas+resultados, impacto, riesgos, artefactos y próxima acción).
3. UI/UX: documentar `apple-design leída`, principios aplicados y comprobaciones visuales/accesibilidad, incluidas las no ejecutadas.
4. Actualizar **solo** la fila correspondiente del `TASK_BOARD.md`: `EN_REVISION`, `BLOQUEADO` o `HECHO` si se cumplen aceptación y revisión. Nunca autoaprobar cambios críticos; solicitar revisión humana.
5. Reportar en chat el resumen y las acciones necesarias del propietario. No afirmar que se hizo `push`, commit, deploy ni lectura de servidor si no se ejecutó.

## Convenciones de consistencia

- `WORKLOG.md` es **append-only**: jamás editar entradas anteriores ni compactarlas. Si hay un error histórico, añadir una entrada correctiva.
- `TASK_BOARD.md` es el **estado actual** y solo se modifica la fila de la tarea propia, preservando los avances de otros.
- Una entrada por inicio y otra por entrega es preferible a una sola entrada con hechos mezclados. En sesiones de varios pasos, anexar progreso relevante sin falsear fechas.
- Si la sesión se corta: reconstruir el estado leyendo Git, tablero y últimas entradas y registrar el reingreso; no dar por completos pasos anteriores sin evidencia.
- No dejar *TODO* de seguridad, módulos activos por defecto, credenciales en archivos o dependencias no justificadas.
