# Puerta obligatoria para tareas UI/UX: Apple Design

## Disparadores (sin excepciones por tamaño)

Cualquier tarea que diseñe, implemente, corrija, revise o pruebe **interfaz visible al usuario**: login, dashboard, sidebar, formularios, tarjetas, menú, iconos, tipografía, colores, temas, tokens visuales, CSS/Tailwind, componentes React, responsive, transiciones, gestos, animaciones, usabilidad o accesibilidad.

Se aplica aunque el cambio sea «solo un botón», «solo una clase CSS» o una revisión sin edición. Una tarea puramente de API/CI/tipos sin artefacto visual puede omitirla, pero debe explicar esa clasificación si surge duda.

## Obligaciones, en orden

1. **Localizar y leer realmente** `.agents/skills/apple-design/SKILL.md`. No sustituir por resumen o conocimientos generales. No se permite dar por activada implícitamente una skill sin lectura verificable.
2. Conectar las decisiones de UI a dicha skill y a `docs/specs/PORTAL_CORE.md`: jerarquía, claridad, respuesta inmediata, motion intencional, accesibilidad, tipografía del sistema, contraste y temas claro/oscuro.
3. Antes de modificar, anotar en el registro `INICIO` de `WORKLOG.md` un renglón `**Skill UI/UX:** apple-design leída (ruta ...); aspectos aplicables: ...`.
4. Validar visualmente y por comportamiento según alcance: teclado/focus, estados vacíos/error/carga, claro/oscuro, móvil/escritorio, `prefers-reduced-motion`, contrastes y navegación. Registrar los resultados; si no hay entorno para probar, indicar `NO EJECUTADO`.
5. En `CIERRE`/`EN_REVISION` enumerar brevemente qué reglas de la skill se aplicaron y referencias a capturas o pruebas **sin datos personales ni fiscales**.

## Si la skill está ausente o inaccesible

**No continuar la parte UI/UX.** Marcar `BLOQUEADO` (o separar una subtarea no visual autorizada), registrar la ausencia y pedir que se restaure `.agents/skills/apple-design/SKILL.md`. Nunca recrear, inventar ni modificar esa skill sin autorización explícita.

## Integración con otras reglas

- `AGENTS.md` obliga a cargar esta skill en tareas UI/UX; esta referencia documenta **cómo** demostrarlo.
- El código sigue `CLEAN_CODE.md` con comentarios en español incluso para componentes y hooks.
- Los diseños se inspiran en principios, no copian material protegido, marcas, capturas o recursos propietarios de Apple.
- Si un requisito de negocio o accesibilidad entra en conflicto con un recurso estilístico, prioriza seguridad, funcionalidad y accesibilidad, e informa la decisión.
