# Portal de Soporte e-Billia

Portal interno modular de soporte operativo. Sustituye la necesidad habitual de compartir accesos directos a MySQL Workbench y PuTTY mediante acciones específicas, auditables y autorizadas desde una interfaz web.

> **Estado:** PS-003 está fusionado en `main` y el portal se instaló de forma privada en Debian; DEPLOY-001 permanece **EN_REVISION**. No se ha publicado ni declarado productivo. La línea base funcional y sus límites siguen sujetos a las decisiones aprobadas y al tablero.

## Alcance inicial

1. Inicio de sesión, recuperación de acceso y preferencias del usuario.
2. Dashboard con módulos disponibles y navegación Apple-inspired.
3. Administración de usuarios, clientes, credenciales/conexiones y visibilidad de módulos.
4. **RF-1: Insertar facturas en BD**, con carga masiva de XML CFDI, validación, enriquecimiento y escritura controlada.

## Lee primero

**Novedades v0.2:** [`Decisiones aprobadas`](docs/product/DECISIONS_APPROVED.md) · [`Lookup por sociedad/ambiente SAP`](docs/specs/RF-1_LOOKUP_RULES.md) · [`Clean Code y comentarios en español`](docs/standards/CLEAN_CODE.md).

- [`AGENTS.md`](AGENTS.md): normas obligatorias para agentes y personas.
- [`docs/product/PROJECT_CHARTER.md`](docs/product/PROJECT_CHARTER.md): visión, fases y límites.
- [`docs/specs/PORTAL_CORE.md`](docs/specs/PORTAL_CORE.md): contratos del núcleo, usuarios, seguridad y UX.
- [`docs/specs/RF-1_INSERTAR_FACTURAS_BD.md`](docs/specs/RF-1_INSERTAR_FACTURAS_BD.md): funcionalidad y criterios de aceptación de RF-1.
- [`docs/specs/RF-1_FIELD_MAPPING.md`](docs/specs/RF-1_FIELD_MAPPING.md): mapeo CFDI -> tabla `factura`, sujeto a validación DDL.
- [`docs/architecture/ADR-0001_STACK.md`](docs/architecture/ADR-0001_STACK.md): stack y arquitectura.
- [`docs/operations/DEPLOYMENT_DEBIAN.md`](docs/operations/DEPLOYMENT_DEBIAN.md): despliegue propuesto, sin afectar servicios existentes.
- [`docs/operations/TASK_BOARD.md`](docs/operations/TASK_BOARD.md): tareas y responsables.
- [`docs/operations/WORKLOG.md`](docs/operations/WORKLOG.md): bitácora append-only de iteraciones.
- [`docs/product/OPEN_DECISIONS.md`](docs/product/OPEN_DECISIONS.md): verificaciones técnicas previas a INSERT/PROD (NO decisiones de negocio abiertas).

## Modelo de desarrollo

Monorepo TypeScript, núcleo + módulos desacoplados mediante interfaces versionadas. Roles `ADMIN` y `SUPPORT` con permisos verificados por backend; activación instantánea de módulos **ya desplegados**. Conectores MySQL directos, MySQL por SSH y SSH para módulos posteriores. No consola SQL/SSH libre para soporte.

## Fuente de requisitos

- PRD de e-Billia: https://docs.google.com/document/d/12U-xIyp4zuyLMG6h9QVCHi-egBK91_d9mTzlDcjsNJ0/edit
- Brief de alcance actualizado: definido por el propietario del proyecto en la conversación inicial (2026-11-17).
- Skill Apple Design y seis CFDI reales: material suministrado para análisis, **no incluir sus copias en Git**.

## Nota de integración

No sobrescribir a ciegas archivos preexistentes. Confirmar previamente el estado del repositorio; integrar mediante commit o PR revisable.
