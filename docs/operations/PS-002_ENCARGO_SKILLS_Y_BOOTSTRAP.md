# PS-002 — Instalar gobierno de skills y bootstrap del monorepo

**Entrada autorizada:** PS-001 entregada `EN_REVISION` y revisada por el propietario en chat; PS-002 se ejecutará **solo cuando el propietario confirme iniciar**. Este documento es el prompt operativo actualizado para Codex, OpenCode y Antigravity.

## Encargo (copiar o indicar que se lea)

> Actúa como ingeniero principal del repositorio Portal Soporte e-Billia. El propietario revisó PS-001 y autorizó iniciar **PS-002**. No realices PS-003 ni añadas funcionalidades productivas.
>
> **Paso 0: proteger el checkout.** Lee `AGENTS.md`, el `README.md` actual y toda la documentación obligatoria según `AGENTS.md`, así como las últimas entradas de `WORKLOG.md` y PS-001 en `TASK_BOARD.md`. Comprueba `git status --short --branch`, commit, archivos modificados/no seguidos y detecta diferencias frente al diagnóstico PS-001. **Preserva el README existente y todo el historial de bitácora**. No ejecutes `git reset`, `git clean`, `git checkout --`, rebase, push ni sustituciones de archivos sin revisión.
>
> **Paso 1: instalar/verificar la skill.** La fuente aprobada es el paquete incremental v0.2.1: `.agents/skills/portal-soporte-workflow/SKILL.md` y sus tres `references/*.md`. Si ya se copiaron al checkout, verifica su contenido y legibilidad; en caso contrario, solicita/usa esos archivos desde el paquete autorizado y cópialos a dicha ruta. No descargues skills desconocidas ni toques `.agents/skills/apple-design/SKILL.md`. Comprueba el YAML frontmatter (`name`, `description`), rutas de referencias y visibilidad para agentes compatibles. Abre la skill `portal-soporte-workflow` y sigue su protocolo.
>
> **Paso 2: registrar obligación global.** En `AGENTS.md`, incorpora exactamente la política descrita en `docs/operations/PS-002_POLITICA_SKILLS.md`: en toda tarea leer `portal-soporte-workflow`; para cualquier tarea UI/UX **es obligatorio leer `.agents/skills/apple-design/SKILL.md` antes de editar o revisar la interfaz**, registrar la lectura y aplicar sus reglas. Si falta, bloquear la tarea UI/UX. No cambies el orden de autoridad ni debilites seguridad. Verifica que `AGENTS.md` no queda con reglas contradictorias.
>
> **Paso 3: bootstrap mínimo sin funcionalidades.** Crea un monorepo `pnpm` (raíz + `pnpm-workspace.yaml` + lockfile) con `apps/web`, `apps/api`, `packages/contracts`, `packages/ui`, `packages/core`, `packages/connectors`, `modules/rf-1`. Fija versiones verificadas compatibles para Node 24 y pnpm, TypeScript `strict`, ESLint, Prettier, scripts reproducibles y CI básica. Solo esqueletos y contratos sin login, módulos operativos, conexión BD/SSH, migraciones ni interfaz diseñada. Añade `.gitignore` que preserve `.agents/skills/**`, docs y fuentes, y que excluya `node_modules`, `.env`, llaves y artefactos. No uses Docker.
>
> **Puerta Apple Design en PS-002:** si para crear el scaffold se genera o modifica cualquier componente React, CSS, tema, layout o elemento UI visible, **lee primero** la skill `.agents/skills/apple-design/SKILL.md` y deja evidencia en `WORKLOG.md`. Si el bootstrap es exclusivamente de infraestructura/configuración sin tocar UI visual, documenta `No aplica en PS-002`, pero la obligación seguirá vigente en `AGENTS.md` para PS-003 en adelante.
>
> **Paso 4: calidad.** Sigue `docs/standards/CLEAN_CODE.md`: JSDoc/TSDoc en español para toda función, clase, método, hook, componente y contrato (si creas alguno). Evita implementaciones ficticias. Añade verificaciones reproducibles `format:check`, `lint`, `typecheck`, `test` y `build` donde apliquen. CI ejecuta comprobaciones reales; no maquillar resultados ni saltarse tests. Añade comprobación de frontmatter/rutas de skills y política obligatoria en `AGENTS.md` sin depender de que el agente descubra skills automáticamente. No introducir dependencias o scripts de telemetría innecesaria.
>
> **Paso 5: evidencia y entrega.** Actualiza la fila PS-002 en `TASK_BOARD.md`. Anexa `INICIO` y `EN_REVISION`/`BLOQUEADO` al final de `WORKLOG.md`, preservando PS-001 y otras entradas. Indica comandos, versiones, resultados, archivos creados, riesgos y pendientes. Verifica `git diff --check`, Git y el estado de archivos no seguidos. No marques `HECHO` por cuenta propia: solicita revisión del propietario y detén el trabajo antes de PS-003. No hagas commit/push ni despliegues salvo autorización adicional explícita.

## Criterios de aceptación de PS-002

- [ ] No se perdió ningún cambio previo ni se reescribió la bitácora de PS-001.
- [ ] Existe y es válida `.agents/skills/portal-soporte-workflow/SKILL.md`; referencias completas y legibles.
- [ ] Se conserva íntegra la skill `.agents/skills/apple-design/SKILL.md` y está documentada su activación obligatoria para UI/UX.
- [ ] `AGENTS.md` establece la puerta de skill y exige evidencia en `WORKLOG.md`.
- [ ] Monorepo pnpm inicializado según ADR, con Node/pnpm fijados, lockfile, TS estricto, lint/formato/CI y `.gitignore` seguro.
- [ ] No se implementaron login, conexión a clientes, SQL, secretos, features RF-1 ni despliegue.
- [ ] Comandos realmente ejecutados y sus resultados anotados; sin `push` ni despliegue.
- [ ] PS-002 termina en `EN_REVISION` o `BLOQUEADO`, nunca se continúa autónomamente a PS-003.
