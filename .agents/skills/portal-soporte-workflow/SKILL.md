---
name: portal-soporte-workflow
description: >-
  Protocolo obligatorio para trabajar en Portal de Soporte e-Billia con Codex,
  OpenCode, Antigravity o personas. Usar al iniciar, desarrollar, revisar,
  bloquear o cerrar cualquier tarea PS-###; orienta la lectura de specs,
  Clean Code, Git, TASK_BOARD y WORKLOG. Exige cargar la skill apple-design
  antes de toda tarea de UI/UX, componentes, estilos, accesibilidad o motion.
---

# Portal Soporte Workflow — operación común de agentes

**Ámbito:** únicamente el repositorio `portal-soporte`. Esta skill es un procedimiento operativo, **no** sustituye ni altera las autorizaciones de `AGENTS.md`, los requisitos aprobados o las specs.

## 0. Leer antes de actuar — obligatorio para toda tarea

1. Ubica la raíz del repositorio. Abre `AGENTS.md` y cumple su orden de autoridad; no dependas de que el IDE active skills automáticamente.
2. Lee `README.md`, `docs/product/PROJECT_CHARTER.md`, `docs/product/DECISIONS_APPROVED.md`, `docs/product/OPEN_DECISIONS.md`, `docs/standards/CLEAN_CODE.md`, `docs/operations/TASK_BOARD.md` y las **últimas entradas** de `docs/operations/WORKLOG.md`.
3. Lee la spec de la tarea y cualquier ADR afectada. Utiliza la [ruta documental](references/DOCUMENT_ROUTING.md) para no omitir contratos.
4. Identifica tarea `PS-###`, alcance, propietario, criterios de aceptación, dependencias y límites de permisos. Consulta `git status`, rama y commit. Respeta archivos ya modificados o aún sin seguimiento por otra persona.
5. **Puerta UI/UX:** si la tarea afecta cualquier interfaz visible, diseño visual, navegación, login, dashboard, componentes, CSS, Tailwind, interacción, accesibilidad, animación o tokens de diseño, ejecuta el [protocolo UI/UX](references/UI_UX_APPLE_GATE.md) **antes de analizar/editar código visual**. No basta mencionar Apple Design: **abre y lee** `.agents/skills/apple-design/SKILL.md` y aplícalo.

## 1. Seleccionar y registrar el trabajo

- **No iniciar una tarea ajena, bloqueada o no aprobada.** Si ya está `EN_CURSO` para otro propietario, coordina antes.
- Registra `INICIO` al final de `docs/operations/WORKLOG.md` con timestamp real, agente, `PS-###`, base Git, objetivo, alcance, riesgos y pruebas previstas; actualiza únicamente la fila correspondiente de `TASK_BOARD.md` a `EN_CURSO`.
- Si la tarea es read-only, respeta explícitamente las únicas ediciones excepcionales concedidas para bitácora/tablero.
- Implementa por incrementos pequeños; documenta funciones, clases, métodos, hooks, componentes, endpoints y contratos con JSDoc/TSDoc **en español**, conforme a `docs/standards/CLEAN_CODE.md`.
- Mantén frontera de módulos y protege credenciales, CFDI reales y entornos de clientes. Ningún cambio productivo sin aprobación separada.

## 2. Validar antes de dar por terminado

- Ejecuta solo las validaciones pertinentes y autorizadas (`format:check`, `lint`, `typecheck`, `test`, `build`, revisión de secretos, pruebas de accesibilidad si aplica). No simules una validación inexistente.
- Contrasta los cambios con la spec; verifica `git diff`, archivos sin seguimiento y cambios de otros participantes; no descartes modificaciones ajenas.
- Para UI/UX añade evidencia de la puerta Apple Design, prueba de teclado, tema claro/oscuro, responsive y movimiento reducido cuando corresponda.
- Para cambios críticos requiere revisión independiente, validación funcional y autorización de acuerdo con `AGENTS.md`; no declarar listo para producción un módulo solo porque compila.

## 3. Cierre y relevo

- Añade una nueva entrada `CIERRE`, `BLOQUEO` o `ENTREGA A REVISIÓN` **append-only** en `WORKLOG.md`, sin reescribir el historial. Actualiza la fila de `TASK_BOARD.md` a `EN_REVISION`, `BLOQUEADO` o `HECHO` según evidencia y aceptación. Sigue [registro y handoff](references/ITERATION_HANDOFF.md).
- Indica rutas modificadas, comandos y resultados reales, limitaciones, riesgos, decisiones, commit/PR si existe y siguiente tarea sugerida.
- Si el entorno no permite ejecutar algo, registra `NO EJECUTADO` y explica por qué. No afirmes que el servidor, GitHub o bases de datos están verificados sin haberlos consultado autorizadamente.
- Si se pierde contexto o hay cambio de agente, **no reiniciar desde cero ni asumir estado:** leer tablero, últimas entradas, Git y retomar desde la última evidencia.

## 4. Reglas de decisión rápidas

| Situación | Acción |
| --- | --- |
| La tarea requiere UI/UX, aunque sea un cambio pequeño de CSS | Abrir `apple-design/SKILL.md` antes de actuar, registrar evidencia y seguir su guía. |
| No existe o no se puede leer `apple-design/SKILL.md` | **BLOQUEADO** para UI/UX; no inventar reglas ni sustituir por memoria. |
| La task afecta contratos núcleo o más de un módulo | Leer specs/ADR y solicitar revisión de interfaz pública antes de modificar. |
| Falta esquema real de BD cliente | Implementar solo mocks o contratos según permisos; no suponer columnas, no `INSERT`. |
| Hay cambios sin seguimiento o un `README` ya editado | Preservar, inspeccionar y fusionar de manera controlada; nunca sobreescribir. |
| Las pruebas no existen, fallan o no hay permiso | Reportar `NO EJECUTADO`/`FAIL`, corregir si está en alcance o bloquear. |
| El objetivo requiere producción, secretos o Cloudflare | Solicitar autorización explícita específica; no ampliar PS-### por iniciativa propia. |

## Referencias de esta skill

- [Qué documento consultar](references/DOCUMENT_ROUTING.md).
- [Puerta obligatoria de Apple Design](references/UI_UX_APPLE_GATE.md).
- [Cómo registrar una iteración y entregarla](references/ITERATION_HANDOFF.md).

**Autoridad:** el propietario y `AGENTS.md` prevalecen sobre esta skill. Si detectas un conflicto, consígnalo y solicita resolución; nunca ignores controles de seguridad o los acuerdos de negocio.
