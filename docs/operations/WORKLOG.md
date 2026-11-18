# WORKLOG — Bitácora inmutable por iteración y tarea

**Regla:** anexar al final sin reescribir historial; cada iteración de Codex, OpenCode, Antigravity o un humano agrega una entrada, incluso al bloquearse. Actualizar también `TASK_BOARD.md`. Timestamps ISO-8601 (preferencia UTC con offset local si se necesita). No copiar contraseñas, llaves, XML reales, DSN, PII ni logs sensibles.

## Plantilla de entrada (copiar y completar al final)

```md
### [AAAA-MM-DDTHH:mm:ss-06:00] PS-### · AGENTE/PERSONA · ESTADO
- **Contexto:** rama `...`, commit base `...`, entorno `local|test|prod`.
- **Objetivo/criterios:** ...
- **Archivos/rutas modificadas:** ...
- **Acciones realizadas:** ...
- **Pruebas ejecutadas y resultados:** `comando` → `PASS|FAIL|NO EJECUTADO`, evidencia `...`.
- **Seguridad/impacto:** ... (datos reales: no; escrituras cliente: no/sí aprobadas con referencia).
- **Decisiones/riesgos/bloqueos:** ...
- **Commit/PR/artefacto:** ...
- **Siguiente acción y responsable:** ...
```

---

### [2026-11-17T13:04:00-06:00] PS-000 · ChatGPT · HECHO (documentación preparada)
- **Contexto:** proyecto en fase de propuesta; repositorio remoto comunicado por propietario, **sin checkout ni modificación verificados**; servidor Debian y BD de clientes no inspeccionados.
- **Objetivo/criterios:** establecer reglas de agentes, gobierno de proyecto, specs CORE/RF-1, ADR, mapeo, tablero y bitácora para importar luego al repositorio.
- **Archivos/rutas modificadas:** documentación creada en un paquete local descargable; **ninguna edición remota**.
- **Acciones realizadas:** lectura del PRD de Google Docs; inspección de seis XML CFDI como material read-only; consulta de fuentes oficiales de Next.js, Fastify, mysql2, ssh2, Cloudflare y OWASP; elaboración de archivos Markdown.
- **Pruebas ejecutadas y resultados:** lectura parseable de los seis XML con parser seguro local → PASS; pruebas de integración/endpoints/build/conexión BD/despliegue → **NO EJECUTADO**.
- **Seguridad/impacto:** ninguna credencial recibida; ninguna escritura en BD cliente, servidor, túneles ni Git. XML reales no incluidos en el paquete documental.
- **Decisiones/riesgos/bloqueos:** aceptación del stack y decisiones DEC-001 a DEC-024; DDL real/condiciones de producción pendientes; compatibilidad exacta de llaves pendientes.
- **Commit/PR/artefacto:** paquete Markdown generado fuera del repo, sin commit.
- **Siguiente acción y responsable:** propietario revisa/integra documentación; asignar PS-001 a un agente con acceso apropiado.

<!-- NUEVAS ENTRADAS: AGREGAR DEBAJO. NO EDITAR LAS ENTRADAS HISTÓRICAS. -->

### [2026-11-17T13:43:08-06:00] PS-000 · ChatGPT · HECHO (v0.2 documental)
- **Contexto:** paquete local de documentación v0.2; no modificación de GitHub, Debian, Cloudflare ni BD de clientes.
- **Objetivo/criterios:** incorporar decisiones del propietario, distinguir producto cerrado de pruebas técnicas pendientes y reforzar Clean Code en español.
- **Archivos/rutas modificadas:** specs, AGENTS, charter, ADR, tablero, prompt PS-001, estándares; se añadieron `DECISIONS_APPROVED.md`, `RF-1_LOOKUP_RULES.md` y `CLEAN_CODE.md`.
- **Acciones realizadas:** se formalizó lookup por RFC receptor -> sociedad/ambiente SAP -> proveedor por RFC emisor + sociedad + ambiente SAP; registros del mismo proveedor en otros ambientes no bloquean. Se aprobó existencia=activo y ambos estatus de RF-1; Complementos será módulo independiente.
- **Pruebas ejecutadas y resultados:** consistencia documental/ZIP (validación de archivos local) -> PASS, pruebas runtime/API/MySQL/SSH/despliegue -> NO EJECUTADO.
- **Seguridad/impacto:** sin acceso a credenciales ni modificaciones productivas.
- **Decisiones/riesgos/bloqueos:** producto cerrado (AP-001..AP-012); puertas técnicas VT-01..VT-13 pendientes antes de INSERT/PROD.
- **Commit/PR/artefacto:** paquete local v0.2, sin commit.
- **Siguiente acción y responsable:** propietario integra el ZIP; Codex ejecuta PS-001 read-only y entrega hallazgos para revisión antes de PS-002.

### [2026-11-17T13:54:12-06:00] PS-001 · Codex · INICIO
- **Contexto:** rama `main`, commit base `3bca37cd981c799609f4248a0bc0199ec426a9d6`, entorno local.
- **Objetivo/criterios:** inventariar el checkout y validar la línea base documental v0.2; entregar diagnóstico sustentado sobre Git, archivos, configuración/dependencias, compatibilidad arquitectónica, riesgos, pendientes y propuesta PS-002. Criterio: no declarar pruebas ni verificaciones que no se ejecuten.
- **Alcance/archivos previstos:** lectura del repositorio y sus documentos; únicos archivos permitidos para edición: `docs/operations/TASK_BOARD.md` y anexos al final de `docs/operations/WORKLOG.md`.
- **Acciones realizadas:** lectura de instrucciones y fuentes obligatorias; comprobación inicial de Git; PS-001 reclamada en este tablero.
- **Pruebas/comprobaciones previstas:** estado, rama y commit; inventario con archivos ignorados; detección de dependencias/configuración; lectura de la arquitectura y specs; revisión de consistencia documental; verificación final del diff y estado Git.
- **Riesgos/decisiones:** el checkout ya tiene cambios locales (`README.md` modificado; `AGENTS.md` y `docs/` sin seguimiento); conservarlos. No se autorizó inspección de servidores, túneles ni bases de datos productivas.
- **Seguridad/impacto:** solo lectura de archivos; sin instalación, conexiones ni escrituras productivas.
- **Siguiente acción y responsable:** completar inventario local, Codex.

### [2026-11-17T13:57:13-06:00] PS-001 · Codex · EN_REVISION
- **Contexto:** rama `main`, commit base `3bca37cd981c799609f4248a0bc0199ec426a9d6` (`Añadida skill de UI/UX del proyecto`), entorno local; rama sin ahead/behind respecto de `origin/main`.
- **Objetivo/criterios:** inventariar el checkout y validar documentalmente la línea base v0.2; entregar diagnóstico para revisión antes de PS-002.
- **Archivos/rutas modificadas:** este tablero y esta bitácora, únicos cambios realizados por Codex en PS-001. Se preservaron `README.md`, `AGENTS.md`, `docs/` y la skill preexistentes.
- **Acciones realizadas:** lectura completa de AGENTS, README, charter, decisiones aprobadas/abiertas, Clean Code, CORE, las tres specs RF-1, ADR-0001, tablero, bitácora completa, estrategia de pruebas, guía PS-001 y propuesta de despliegue; inventario recursivo del checkout y de configuración/dependencias.
- **Pruebas/comprobaciones ejecutadas:** `git status --short --branch` y `git status --porcelain=v2 --branch` → rama `main`, `origin/main` sin divergencia, cambios locales previos `README.md` modificado y `AGENTS.md`/`docs/` sin seguimiento; `git show -s --format='%H%n%cs%n%s' HEAD` → commit `3bca37cd981c799609f4248a0bc0199ec426a9d6`; `git ls-files` → README y skill Apple Design versionados; `rg --files -uu` → 18 archivos (código fuente, manifests, lockfiles, .gitignore y CI no presentes); `Get-Command node,npm,pnpm,corepack` → comandos disponibles; `node --version` → `v24.13.0`. Lint, format, typecheck, tests, build, escaneo de secretos, dependencias y compatibilidad runtime de apps → **NO EJECUTADO** (no hay aplicación ni configuración de proyecto). Acceso a Debian, túneles y BD productivas → **SIN ACCESO / NO VERIFICADO**, no solicitado ni intentado.
- **Seguridad/impacto:** inspección local de solo lectura; sin instalaciones, conexiones, ejecución de tests, cambios de infraestructura, secretos ni escrituras productivas. Los únicos archivos editados fueron los dos autorizados.
- **Diagnóstico/riesgos:** las decisiones funcionales y el lookup contextual de RF-1 son coherentes entre fuentes. La compatibilidad con la arquitectura solo puede afirmarse a nivel documental: no hay implementación para contrastar. La skill Apple Design está presente y versionada en `.agents/skills/apple-design/SKILL.md`. AGENTS y `docs/` siguen sin seguimiento en Git; `README.md` contiene un cambio previo (41 líneas frente a un archivo vacío en HEAD). No hay manifests ni lockfile, por lo que versiones de Next/Fastify/paquetes no están resueltas; el Node local no acredita la versión del servidor. No se observó `.gitignore` ni workflow CI.
- **Decisiones/bloqueos:** tablero PS-001 queda `EN_REVISION` hasta revisión del propietario. No iniciar PS-002 antes de esa revisión. Verificaciones VT-01..VT-13 permanecen según aplique; ninguna se cerró ni se obtuvo evidencia de producción.
- **Commit/PR/artefacto:** sin commit; diagnóstico entregado en esta conversación.
- **Siguiente acción y responsable:** propietario revisa el diagnóstico y define inicio de PS-002; Codex espera.
- **Verificación final [2026-11-17T13:59:44-06:00]:** `git diff --check` → código de salida 0; salida: warning: in the working copy of 'README.md', LF will be replaced by CRLF the next time Git touches it | GIT_DIFF_CHECK_EXIT=0 | ## main...origin/main |  M README.md | ?? AGENTS.md | ?? docs/ |. Orden de entradas comprobado: PS-000 previas, luego PS-001 `INICIO` y `EN_REVISION` al final; tablero en `EN_REVISION`.
\n### [2026-11-17T14:23:49-06:00] PS-002 · Codex · INICIO\n- **Contexto:** rama main, commit base 3bca37cd981c799609f4248a0bc0199ec426a9d6, entorno local. Estado previo: README.md modificado; .agents/skills/portal-soporte-workflow/, AGENTS.md y docs/ sin seguimiento; skill Apple Design versionada. Se preservará todo.\n- **Objetivo/criterios:** instalar/verificar/integrar la skill de proyecto y política Apple Design; crear el bootstrap mínimo pnpm/Node 24 conforme ADR-0001, con aplicaciones y paquetes vacíos, TypeScript estricto, scripts reproducibles, CI y exclusiones seguras; entregar EN_REVISION sin avanzar PS-003.\n- **Alcance/archivos previstos:** actualizar la sección de skills en AGENTS.md; añadir raíz pnpm, workspace, lockfile, Node 24, .gitignore, TS, ESLint, Prettier, CI y comprobaciones de skill; esqueletos para pps/web, pps/api, packages/{contracts,ui,core,connectors}, modules/rf-1; actualizar únicamente la fila PS-002 y anexar registros al final de WORKLOG.\n- **Skill UI/UX:** .agents/skills/apple-design/SKILL.md leída antes de generar la ruta React; aplicar HTML semántico, fuente del sistema, claridad y ausencia de movimiento decorativo; validar accesibilidad estructural, registrar prueba visual como NO EJECUTADO si no se ejecuta.\n- **Validaciones previstas:** verificador erify_skill.py; instalación congelada; ormat:check, lint, 	ypecheck, 	est, uild; chequeo de CI, política, skill y rutas; git diff --check y estado final.\n- **Seguridad/impacto:** instalación de dependencias solo local desde registry; sin servidores, túneles, BD productivas, credenciales, Docker, push, despliegue ni PS-003.\n- **Riesgos/decisiones:** el checkout está basado en archivos previos sin seguimiento; preservar contenido. ADR fija stack y Node 24. El registro npm reportó versiones actuales; el paquete instalado debe fijar versión de pnpm que soporte Node 24 y el lockfile resolver dependencias. No añadir funciones de portal.\n- **Siguiente acción y responsable:** completar PS-002, Codex.\n

### [2026-11-17T14:56:53-06:00] PS-002 · Codex · ACLARACIÓN APPEND-ONLY
- **Contexto:** rama `main`, commit base `3bca37cd981c799609f4248a0bc0199ec426a9d6`.
- **Aclaración:** la entrada `INICIO` inmediatamente anterior quedó anexada con secuencias de escape no intencionales en algunos identificadores. Esta nota precisa que las rutas previstas eran `apps/web`, `apps/api`, `verify_skill.py` y los comandos `format:check`, `typecheck`, `test` y `build`. El bloque anterior y todo el historial PS-001 permanecen intactos.
- **Estado:** continuación append-only de PS-002.

### [2026-11-17T14:56:54-06:00] PS-002 · Codex · EN_REVISION
- **Contexto:** rama `main`, HEAD `3bca37cd981c799609f4248a0bc0199ec426a9d6`, entorno local Windows; Node `v24.13.0`, pnpm `12.21.0`. Sin commit ni push.
- **Objetivo/criterios:** integrar la skill y puerta Apple Design, inicializar el monorepo v0.2 mínimo con verificaciones reproducibles y entregar para revisión sin iniciar PS-003.
- **Archivos/rutas:** se conservó README.md y el historial PS-001; se añadió la política aprobada en AGENTS.md; se integró la skill portal-soporte-workflow y se dejó su paquete staged, sin commit; se creó pnpm workspace, lockfile, configuraciones, CI, esqueletos apps/web, apps/api, packages/contracts, packages/ui, packages/core, packages/connectors y modules/rf-1, y una prueba de bootstrap; se actualizó solo la fila PS-002 del tablero.
- **Decisiones de arquitectura:** Node fijado en `.node-version` a `24.22.3`; pnpm fijado a `12.21.0`; el manifiesto de módulo declara los campos aprobados y visibilidad por defecto falsa. RF-1 permanece vacío e independiente; no se añadió Complementos ni funcionalidad de negocio.
- **Skill UI/UX:** leída `.agents/skills/apple-design/SKILL.md` antes de generar la ruta React. Se aplicaron estructura semántica, fuente del sistema, jerarquía clara y ausencia de animaciones decorativas. Validación visual, teclado, contraste y movimiento reducido: `NO EJECUTADO`; el scaffold no implementa interacción ni diseño visual.
- **Verificaciones ejecutadas:** `corepack pnpm@12.21.0 install --frozen-lockfile` → PASS; `corepack pnpm@12.21.0 run verify:skills` → PASS; `corepack pnpm@12.21.0 run format:check` → PASS; `corepack pnpm@12.21.0 run lint` → PASS; `corepack pnpm@12.21.0 -r --workspace-concurrency=2 --if-present run typecheck` → PASS en los siete proyectos; `corepack pnpm@12.21.0 run test` → PASS, 1 archivo/1 prueba; `corepack pnpm@12.21.0 --filter @portal-soporte/web run build` → PASS, rutas estáticas `/` y `/_not-found`; `corepack pnpm@12.21.0 run check:secrets` → PASS, sin hallazgos; `corepack pnpm@12.21.0 peers check` → PASS, sin conflictos.
- **Auditoría de dependencias:** `corepack pnpm@12.21.0 audit --prod --audit-level high` → PASS, sin vulnerabilidades conocidas; `corepack pnpm@12.21.0 audit --audit-level high` → FAIL, una alerta alta `GHSA-fc5q-39xc-vjpf` / `CVE-2026-112366` en `picomatch` transitivo de desarrollo por `eslint-config-next`, versiones afectadas `<=4.0.7`, sin parche reportado. No se aplicó override sin versión corregida.
- **Compatibilidad local:** `corepack pnpm@12.21.0 run typecheck` y `... run check:dependencies` no pueden invocar sus subcomandos anidados en este host: el PATH resuelve pnpm global `11.4.0`, incompatible con el pin. Se ejecutaron directamente con pnpm `12.21.0` los comandos equivalentes de typecheck y audit anteriores. La CI configurará la versión pinneada mediante action; la ejecución real de GitHub Actions queda `NO EJECUTADO`.
- **Riesgos/pendientes:** build corrido con Node `24.13.0`, no con el pin `24.22.3`; falta repetir CI y comprobaciones visuales con el runtime exacto. La auditoría completa queda pendiente de resolución o aceptación explícita del advisory de desarrollo. ESLint `9.39.5` mantiene compatibilidad de peers con el preset Next instalado; se observó aviso de deprecación del paquete. No se probó cobertura de funcionalidades porque no se implementaron.
- **Seguridad/impacto:** solo instalación y ejecución local de herramientas; sin conexiones a servidores, túneles, bases productivas o credenciales; sin Docker, cambios de infraestructura, push, despliegue ni operaciones productivas.
- **Artefactos:** skill del proyecto, política de agente, monorepo y lockfile, CI básica y prueba del scaffold; archivos nuevos permanecen en el workspace y el paquete de skill está staged. No se creó commit.
- **Siguiente paso y responsable:** revisión del propietario; resolver/aceptar el hallazgo de dependencia y solicitar ejecución con Node fijado si se requiere aceptación completa. Codex se detiene aquí; PS-003 no iniciado.
- **Estado:** `EN_REVISION`.

### [2026-11-17T14:58:35-06:00] PS-002 · Codex · ACTUALIZACIÓN DE TABLERO
- **Contexto:** tras la revisión explícita del propietario y su autorización de PS-002.
- **Cambio de estado:** PS-001 pasa a `HECHO` en el resumen del tablero porque su diagnóstico fue revisado y se autorizó la siguiente tarea. Sus entradas históricas del WORKLOG y el diagnóstico se conservaron íntegros. No se inspeccionaron servidores ni BD productivas.
- **Estado actual:** PS-002 continúa `EN_REVISION`; no iniciar PS-003.

### [2026-11-17T14:59:20-06:00] PS-002 · Codex · VERIFICACIÓN FINAL
- `git diff --check` → PASS, código 0; Git reportó solamente aviso de normalización LF/CRLF para el README preexistente, que no fue modificado en esta tarea.
- `git diff --cached --check` → PASS, código 0.
- `git status --short --branch` → rama `main`, HEAD `3bca37cd981c799609f4248a0bc0199ec426a9d6`, sin divergencia frente a `origin/main`; paquete de skill staged, sin commit; README continúa modificado como en el estado inicial y los artefactos nuevos siguen en el workspace.
- **Estado PS-002:** `EN_REVISION`; no se realizó push, despliegue ni PS-003.

### [2026-11-17T15:59:59-06:00] PS-002.1 · Codex · INICIO
- **Contexto:** rama `main`, commit base `3bca37cd981c799609f4248a0bc0199ec426a9d6`; índice contiene cinco archivos de la skill workflow; README modificado y bootstrap/AGENTS/docs aún sin seguimiento. No se limpiará ni reemplazará contenido.
- **Objetivo/criterios:** obtener el árbol exacto de picomatch y su alcance dev/prod; validar advisories/mitigaciones/actualizaciones; ejecutar con Node 24.22.3 y pnpm 12.21.0; confirmar scripts, lockfile, CI y tests; revisar todo archivo candidato y preparar un commit local atómico sin push; dejar EN_REVISION.
- **Alcance/archivos previstos:** revisión de package.json, pnpm-workspace.yaml, pnpm-lock.yaml, .node-version, .npmrc, scripts, workflow CI, index/staged diff y archivos nuevos; ediciones limitadas a correcciones verificadas, WORKLOG append-only y fila PS-002.1 de TASK_BOARD.
- **Verificaciones previstas:** `pnpm why picomatch`; auditorías completa y de producción; consulta de releases/advisory; runtimes y resolución Corepack; install frozen; format, lint, typecheck, test, build, skill verification, secret scan y peers; inspección de diff/artefactos; verificación del commit y estado Git.
- **Riesgos/decisiones:** el último estado reportó un advisory alto sin versión corregida, Node local 24.13.0 y pnpm global 11.4.0; no se hará override sin evidencia de una versión corregida compatible. Si el advisory persiste, conservarlo en audit/CI y documentar riesgo residual.
- **Seguridad/impacto:** operaciones locales y consultas a registros/advisories públicos; ninguna conexión productiva, servidor, túnel, base de datos o credencial; no Docker ni push; PS-003 fuera de alcance. UI/UX: no aplica.
- **Siguiente acción y responsable:** concluir revisión, estabilizar runtime, verificar el conjunto candidato, preparar commit atómico local y entregar para aprobación; Codex.
### [2026-11-17T16:27:14-06:00] PS-002.1 · Codex · EN_REVISION
- **Contexto:** rama main, commit base 3bca37cd981c799609f4248a0bc0199ec426a9d6; ejecución local en Windows. Se mantuvo intacto el historial previo PS-001/PS-002 y el README integrado desde el estado inicial.
- **Objetivo/alcance:** estabilizar las versiones reproducibles, revisar el hallazgo transitivo de picomatch, corregir defectos comprobados del bootstrap/CI, inspeccionar el conjunto de baseline y dejar PS-002.1 para aprobación. No se inició PS-003.
- **Cambios de PS-002.1:** scripts recursivos de typecheck/build/auditoría invocan Corepack con pnpm 12.21.0; CI obtiene Node de .node-version (24.22.3), fija pnpm 12.21.0 y ejecuta typecheck después de build porque next-env.d.ts referencia tipos generados en .next. Se añadió DEPENDENCY_SECURITY.md con advisory, árbol, alcance, contención y riesgo residual. El tablero queda EN_REVISION.
- **Versiones verificadas:** Node v24.22.3, Corepack 0.36.0, pnpm 12.21.0; ejecución con PATH de proceso apuntando al Node instalado por NVM, sin alterar el Node/pnpm global. packageManager, devEngines.packageManager, engines, .node-version, CI y scripts se contrastaron.
- **Verificaciones reproducibles ejecutadas:** corepack pnpm@12.21.0 install --frozen-lockfile → PASS; run format:check → PASS; run lint → PASS; run typecheck → PASS (7 proyectos); run test → PASS (1 archivo/1 prueba); run build → PASS (Next genera / y /_not-found, seguido de typecheck); run verify:skills → PASS; run check:secrets → PASS; peers check → PASS; audit --prod --audit-level high → PASS, sin hallazgos; run check:dependencies → FAIL esperado, 1 advisory alto GHSA-fc5q-39xc-vjpf / CVE-2026-112366.
- **Seguridad de dependencias:** pnpm why -r picomatch y la salida JSON de auditoría identifican picomatch 2.3.2 y 4.0.7, ambas dev-only; las rutas pertenecen a eslint-config-next/fast-glob/micromatch, Secretlint y Vitest/Vite/tinyglobby/fdir. pnpm why -r --prod picomatch no devuelve rutas. El advisory declara <=4.0.7 vulnerable y patched versions None; el registro/release consultado no ofrece corrección compatible. No se aplicó override, excepción ni supresión. La nota registra ReDoS, posible impacto de disponibilidad de herramientas/CI, controles y riesgo residual; el gate completo permanece fallido y no se declara resuelto.
- **CI y cobertura pendiente:** el workflow declara explícitamente Node 24.22.3 por .node-version y pnpm 12.21.0, e incluye instalación congelada, skill, formato, lint, test, build, typecheck, secretos y auditoría completa. GitHub Actions no fue ejecutado porque no se publicó el código. Pruebas de integración/E2E quedan NO EJECUTADO: el bootstrap aún no contiene esas funcionalidades ni una suite de integración. Simulación aislada de checkout limpio: NO EJECUTADO.
- **Inventario/seguridad Git:** no se encontraron candidatos de archivos secretos por nombre entre los no versionados; secretlint completo pasó; picomatch no se importa directamente desde apps/packages/modules; se preservan README, skill Apple Design y skill portal-soporte-workflow. El diff completo, los artefactos generados/ignorados y los archivos del baseline se revisan antes del commit local.
- **Riesgos/bloqueos:** continúa el riesgo alto de disponibilidad en herramientas de desarrollo/CI hasta que haya parche publicado o aceptación expresa del propietario. Auditoría de producción limpia no elimina este riesgo. No se conectó a servicios, túneles, BD ni credenciales; no se modificó infraestructura ni Apple Design.
- **Commit/PR/artefacto:** se prepara commit local atómico de la línea base tras revisión del índice; sin push. El hash se reporta en la entrega final. PR y ejecución remota CI: NO EJECUTADOS.
- **Siguiente paso:** revisión y decisión del propietario sobre el riesgo residual para cerrar PS-002; PS-003 permanece PENDIENTE y no iniciado.
- **Estado:** EN_REVISION.

### [2026-11-17T16:34:30-06:00] PS-002.1 · Codex · REVISIÓN DEL ÍNDICE
- **Índice revisado:** 65 archivos, 7,063 inserciones, sin eliminaciones; incluye skill portal-soporte-workflow, bootstrap, decisiones/specs y registros PS-001/PS-002, README preexistente, el hallazgo de seguridad y la entrega PS-002.1. Apple Design está versionada en el repositorio y no aparece en el diff.
- **Archivos y artefactos:** no hay candidatos de secretos por nombre entre los archivos nuevos; el lockfile no contiene patrones identificadores de credenciales en el barrido estructural. Los directorios node_modules, apps/web/.next y apps/web/tsconfig.tsbuildinfo son ignorados y no están preparados para commit. No se observaron binarios ni archivos de entorno/llaves en el índice.
- **Comprobaciones tras el log:** format:check → PASS; verify:skills → PASS; check:secrets → PASS; git diff --check → PASS; git diff --cached --check → PASS. El conjunto candidato quedó completamente preparado en el índice; el commit local atómico de la baseline es el siguiente paso de esta entrega.
- **Cierre:** PS-002.1 y PS-002 permanecen EN_REVISION por el advisory alto sin parche publicado; sin push, sin despliegue, sin acceso productivo y sin iniciar PS-003.

### [2026-11-17T18:32:59-06:00] PS-002.2 · Codex · INICIO
- **Contexto Git:** rama main, HEAD inicial b87c10b39d9b0078470bb6835999737f557798cb; estado de trabajo limpio; baseline b87c10b es hijo directo de 3bca37cd981c799609f4248a0bc0199ec426a9d6. La aprobación de PS-002.1 recibida el 2026-11-17 acepta temporal y condicionadamente GHSA-fc5q-39xc-vjpf solo en desarrollo.
- **Objetivo:** registrar el cierre condicionado de PS-002.1 y preparar la publicación de la línea base; verificar commit, secretos/archivos de entorno, remoto y divergencia; tras una autorización explícita de push, validar la referencia publicada y CI.
- **Alcance previsto:** actualizar la fila PS-002.1 y añadir PS-002.2 en TASK_BOARD.md; anexar este inicio y la entrega en WORKLOG.md; crear un commit documental separado si se requiere conservar la aprobación sin reescribir b87c10b. Sin cambios de aplicación, workflows, infraestructura o datos productivos.
- **Criterios/comprobaciones:** confirmar HEAD b87c10b y árbol limpio antes de editar; comprobar origen remoto y main en el servidor con consulta read-only, comparar con el padre esperado; inspeccionar commit/archivos para secretos; registrar remoto, rama, commit y divergencia antes de pedir permiso; no ejecutar git push sin respuesta explícita.
- **Riesgos:** el audit completo sigue FAIL por el advisory conocido; no rebajar ni silenciarlo. La aceptación del propietario se limita a desarrollo y no se interpreta como autorización para despliegue productivo. Si CI falla en el audit, proponer excepción específica y esperar aprobación separada antes de cambiar configuración.
- **Seguridad/impacto:** solo lectura del remoto Git público/autorizado y cambios locales de documentación; sin servidores, túneles, BD, credenciales, despliegue o PS-003. UI/UX: no aplica.
- **Responsable:** Codex ejecuta las verificaciones; el propietario es responsable de la aceptación del riesgo y de autorizar o rechazar el push.
- **Estado inicial:** EN_CURSO; la publicación queda pendiente de autorización explícita.

### [2026-11-17T18:37:33-06:00] PS-002.2 · Codex · EN_REVISION
- **Aprobación condicionada:** el propietario aprobó técnicamente PS-002.1 y aceptó temporalmente GHSA-fc5q-39xc-vjpf solo para desarrollo. Responsable de aceptación: propietario del proyecto; responsable de seguimiento y remediación: ingeniería del portal.
- **Cierre documental:** TASK_BOARD registra PS-002.1 como HECHO con el alcance de aceptación limitado. DEPENDENCY_SECURITY registra fecha, responsable, alcance, mitigaciones, condición para resolver y exclusión explícita de producción. No se aprobó excepción de auditoría y no se declara PASS el audit completo.
- **Git base:** al inicio, HEAD b87c10b39d9b0078470bb6835999737f557798cb y árbol limpio; el commit es hijo directo de 3bca37cd981c799609f4248a0bc0199ec426a9d6. El árbol del commit no contiene nombres de archivos de entorno/llaves; el escaneo secretlint completo pasa.
- **Remoto consultado en modo lectura:** origin sanitizado https://github.com/consafedev/portal-soporte.git, rama refs/heads/main en 3bca37cd981c799609f4248a0bc0199ec426a9d6, igual al padre de la baseline. En esa comprobación la baseline estaba ahead 1/behind 0; se volverá a consultar antes de cualquier publicación.
- **Verificaciones locales de esta entrega:** format:check, verify:skills, check:secrets, audit --prod --audit-level high y git diff --check → PASS. run check:dependencies → FAIL, 1 high GHSA-fc5q-39xc-vjpf, versiones afectadas <=4.0.7, patched versions None. El diff check detectó inicialmente un blank line final en DEPENDENCY_SECURITY; se retiró y el chequeo posterior pasó.
- **CI:** no ejecutada; requiere publicar el commit de baseline y que GitHub Actions termine. La workflow conserva gates explícitos; se espera que el audit completo reporte el hallazgo. Si bloquea CI, presentar una propuesta de excepción auditable limitada a este GHSA y esperar aprobación separada; no aplicar ahora.
- **Publicación:** no se ejecutó push. La publicación de main esperará autorización explícita después de mostrar remoto, rama, commit y divergencia actualizados. No se desplegó, no se usaron servicios productivos y PS-003 no comenzó.
- **Siguiente paso:** propietario autoriza o rechaza el push normal de origin/main; volver a verificar origin/main inmediatamente antes de ejecutarlo. PS-002 permanece EN_REVISION y PS-002.2 queda EN_REVISION a la espera de autorización y CI remota.
- **Estado:** EN_REVISION.
