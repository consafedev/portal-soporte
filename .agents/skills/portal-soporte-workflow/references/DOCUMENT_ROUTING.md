# Ruta documental del proyecto

**Ubicación:** todos los paths se interpretan desde la raíz de `portal-soporte`. La consulta de esta matriz **no reemplaza** las lecturas obligatorias de `AGENTS.md`.

| Documento | Qué gobierna | Cuándo leerlo |
| --- | --- | --- |
| `AGENTS.md` | Precedencia, permisos, seguridad, workflow, definición de terminado | **Toda tarea, primero** |
| `README.md` | Visión del proyecto, instalación y estado | Toda tarea, al orientarse |
| `docs/product/PROJECT_CHARTER.md` | Alcance y objetivos | Toda tarea |
| `docs/product/DECISIONS_APPROVED.md` | Negocio cerrado, prioridades | Toda tarea; jamás reabrir sin autorización |
| `docs/product/OPEN_DECISIONS.md` | Verificaciones técnicas pendientes y bloqueos | Toda tarea; filtrar puertas relevantes |
| `docs/standards/CLEAN_CODE.md` | Documentación JSDoc/TSDoc en español, calidad | Toda tarea |
| `docs/operations/TASK_BOARD.md` | Estados, owners y dependencias PS-### | Antes de comenzar y al cerrar |
| `docs/operations/WORKLOG.md` | Evidencia histórica append-only | Leer últimas entradas; anexar inicio/cierre |
| `docs/architecture/ADR-0001_STACK.md` | Stack y límites tecnológicos | Bootstrap, infraestructura y arquitectura |
| `docs/specs/PORTAL_CORE.md` | Login, RBAC, perfil, clientes, catálogo, UI | Tareas del núcleo o integración |
| `docs/specs/RF-1_INSERTAR_FACTURAS_BD.md` | Flujo y aceptación RF-1 | Cualquier tarea RF-1 |
| `docs/specs/RF-1_LOOKUP_RULES.md` | Sociedad/ambiente y proveedor por RFC contextual | Lectura, enriquecimiento y escritura RF-1 |
| `docs/specs/RF-1_FIELD_MAPPING.md` | Mapeo fiscal; hipótesis sujetas a DDL | Parser y adaptadores MySQL RF-1 |
| `docs/operations/TEST_STRATEGY.md` | Nivel de pruebas y seguridad | Definir criterios/validar cambios |
| `docs/operations/DEPLOYMENT_DEBIAN.md` | Preparación Debian/Cloudflare | Solo tareas autorizadas de despliegue |
| `docs/tasks/TASK_TEMPLATE.md` | Plantilla de tarea nueva | Crear/desglosar tareas |
| `.agents/skills/apple-design/SKILL.md` | Principios Apple-inspired | **Obligatorio cuando hay UI/UX**, antes de trabajar |

## Lecturas adicionales por tipo de tarea

- **PS-002 bootstrap:** stack, organización workspace, CI, Clean Code, gobernanza de skills, Git y estado de PS-001.
- **UI/UX (PS-003, PS-006 y cualquier otra):** `PORTAL_CORE.md` + skill `apple-design` + estándares + tests de accesibilidad.
- **Seguridad o usuarios:** `PORTAL_CORE.md`, decisiones, autorizaciones y pruebas de RBAC; no exponer secretos.
- **RF-1:** tres specs RF-1, charter, validaciones VT, diseño transaccional y privacidad de CFDI; prohibida inserción sin puertas técnicas verificadas.
- **Infraestructura:** ADR + deployment + autorización explícita y plan de rollback; nunca alterar servicios existentes por deducción.

Las specs gobiernan los módulos, los ADR explican decisiones de ingeniería y la bitácora contiene *hechos comprobables*. Ningún `WORKLOG.md` sustituye requisitos aprobados.
