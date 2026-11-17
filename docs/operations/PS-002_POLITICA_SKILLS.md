# Texto aprobado para integrar en `AGENTS.md` durante PS-002

**Este archivo no sustituye a `AGENTS.md`.** Es una instrucción de modificación acotada. Codex debe verificar el contenido vigente de `AGENTS.md`, preservar los cambios locales y agregar esta sección después de la sección 2 o junto a las reglas de calidad, sin duplicar normas preexistentes.

## Bloque que debe incorporar Codex

```md
## Uso obligatorio de skills del proyecto

- **Todas las tareas PS-###:** antes de planificar, editar, revisar o cerrar, abrir y leer `.agents/skills/portal-soporte-workflow/SKILL.md` y seguir sus referencias operativas según la tarea. Su contenido complementa, pero jamás sustituye, las reglas de `AGENTS.md` ni las decisiones aprobadas.
- **Toda tarea de UI o UX, sin excepciones por tamaño:** antes de diseñar, revisar o modificar componentes, React, HTML visible, CSS/Tailwind, layouts, temas, login, dashboard, sidebar, navegación, animaciones, accesibilidad o flujos interactivos, abrir y **leer realmente** `.agents/skills/apple-design/SKILL.md`. Aplicar sus principios junto con la spec y el diseño aprobado. No basta afirmar que la skill está disponible ni depender de activación automática.
- **Puerta bloqueante:** si `apple-design/SKILL.md` falta, es ilegible o no se pudo cargar, detener la parte UI/UX y registrar `BLOQUEADO`. No recrear, reemplazar o alterar esa skill sin autorización del propietario.
- **Evidencia obligatoria:** en el `WORKLOG.md` de toda tarea UI/UX registrar que se leyó `apple-design` (ruta, criterios aplicados, validaciones visuales/accesibilidad realizadas o `NO EJECUTADO`). En tareas no visuales, registrar `UI/UX: no aplica` cuando sea relevante.
- **Compatibilidad:** conservar ambas skills en `.agents/skills/`, versionadas en Git. No mantener copias divergentes en `.codex`, `.opencode` o `.agent`; si un agente no las descubre, mencionarlas explícitamente en la tarea y verificar la configuración de su herramienta.
```

## Verificación de la política

1. `AGENTS.md` contiene la obligación para **toda tarea** y la regla específica para **UI/UX**.
2. Las rutas de ambas skills están presentes y son legibles; la skill Apple Design **no se modifica**.
3. Se registra la validación en `WORKLOG.md` y se actualiza PS-002 en `TASK_BOARD.md` sin reemplazar el contenido anterior.
4. Si un agente propone un bypass para cambios de CSS pequeños, rechazarlo: sigue siendo UI/UX.

**Alcance de PS-002:** solo documentación de política y bootstrap. Crear un mecanismo automático de comprobación está permitido; no instalar servicios de hooks externos ni cambiar configuración global de agentes sin autorización.
