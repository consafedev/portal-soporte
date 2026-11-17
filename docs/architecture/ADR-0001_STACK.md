# ADR-0001 — Pila tecnológica y monolito modular

**Fecha:** 2026-11-17 · **Estado:** APROBADA como arquitectura objetivo (implementación no iniciada) · **Aprobador:** propietario del proyecto.

## Contexto

El proyecto combina UI web Apple-inspired, RBAC, catálogo modular, múltiples conexiones MySQL directas o por SSH, procesamiento fiscal determinista, auditoría, secretos, servidor Debian compartido y Cloudflare Tunnel. Debe poder desarrollarse por agentes autónomos sin que módulos nuevos modifiquen el núcleo.

## Decisión aprobada

- **Monorepo** `pnpm` workspaces, TypeScript estricto. Estructura: `apps/web` (Next.js App Router + React), `apps/api` (Fastify), `packages/contracts`, `packages/ui`, `packages/core`, `packages/connectors`, `modules/rf-1`.
- **Runtime:** Node.js 24 LTS en servidor (actualizar parches y verificar versión LTS vigente en deployment); TS compilado. Fijar `engines`, lockfile, Dependabot/Renovate opcional; revisiones de seguridad. Evitar mezclar Next.js API routes para ejecución sensible con la API Fastify: **un solo backend autorizado**.
- **UI:** Next.js (SSR/autenticación), Tailwind CSS (tokens), librería de primitivas accesibles no intrusiva (Radix UI o equivalente), Motion solo para interacciones útiles. Tipografía system-ui, claro/oscuro, reduced motion. La skill Apple adjunta es guía de diseño, no código de terceros que se copie sin control.
- **API y datos internos:** Fastify + JSON Schema/TypeBox (o Zod con adaptador tipado y validación real), PostgreSQL para usuarios/sesiones/clientes/módulos/jobs/auditoría. ORM/consultas internas: Drizzle ORM + migraciones versionadas **solo** para BD del portal.
- **DB externas:** mysql2/promise, statements parametrizados, pools limitados y timeouts; **no aplicar migraciones Drizzle ni Prisma sobre DBs clientes**. Adaptadores por proveedor/versión probados.
- **SSH:** ssh2 con autenticación password/llaves privadas `.pem`, `.ppk` compatibles, passphrase y comprobación de host key. `SSH2` soporta parser PPK, pero validar versión/algoritmo/compatibilidad en pruebas; no presuponer que todo archivo funcionará.
- **CFDI:** parser XML namespace-aware y seguro (la librería concreta se definirá en PS-007 con análisis de XXE/bombs); tipos y transformación pura; biblioteca decimal exacta (p.ej. decimal.js) para importes; política de perfiles por versión/tipo.
- **Calidad:** ESLint, Prettier, Vitest, Playwright, tests de integración contra MySQL de pruebas con datos sintéticos y verificación de autorizaciones. CI con análisis de secretos y dependencias.
- **Ejecución:** procesos `systemd` separados, usuario Unix no privilegiado, binding `127.0.0.1`; reverse proxy existente o Nginx revisado, entrada cloudflared ya desplegada si es viable. NO usar Docker según restricción del propietario.

## Por qué no otras alternativas inicialmente

- **Angular**: válido, pero añade complejidad sin necesidad identificada frente a React/Next para un portal de alcance moderado; no supone mejora automática de seguridad.
- **Go o Rust**: mejoran ciertos perfiles de consumo/latencia, pero aquí dominarán latencia MySQL/SSH, validación y UX. Añadir lenguajes exige más contratos, CI y operación. Revaluar únicamente con pruebas y perfiles reales.
- **Microservicios**: implican gateways, despliegues múltiples, tracing distribuido y contratos remotos sin un beneficio inicial proporcional. El monolito modular impone fronteras en compilación y ejecución.
- **SQLite para portal**: viable para piloto de un proceso, pero PostgreSQL ofrece mejor margen para jobs/auditoría y concurrencia. El coste es instalación y backup del nuevo servicio: verificar que no choque con el servidor actual.

## Estructura prevista

```text
portal-soporte/
├── AGENTS.md
├── README.md
├── apps/
│   ├── web/                 # Next.js, solo UX y llamadas a API autorizada
│   └── api/                 # Fastify, único backend de negocio
├── packages/
│   ├── contracts/           # DTOs, Schemas, ModuleManifest
│   ├── ui/                  # Design system Apple-inspired
│   ├── core/                # RBAC, usuarios, audit, connection broker interfaces
│   └── connectors/          # MySQL/SSH, secretos; solo servidor
├── modules/
│   └── rf-1/                # UI y lógica RF-1 por contrato
├── docs/
│   ├── product/
│   ├── specs/
│   ├── architecture/
│   ├── operations/
│   └── tasks/
└── .github/workflows/      # CI futura
```

## Consecuencias

A favor: un solo lenguaje, separación de dominios, pruebas aisladas, activación funcional sin redeploy de código ya desplegado, mantenimiento homogéneo. Costes: dos procesos Node (UI/API), PostgreSQL interno y broker de secretos, migraciones y monitoreo. No construir sistema plugin de ejecución de código remoto; registrar módulos incluidos en el build.

## Fuentes técnicas de referencia (documentación oficial)

- Next.js self-hosting: https://nextjs.org/docs/app/guides/self-hosting
- Fastify schema validation: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- mysql2: https://sidorares.github.io/node-mysql2/
- ssh2/PPK: https://github.com/mscdex/ssh2
- Node releases: https://nodejs.org/en/about/previous-releases
- Cloudflare published hostname: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/
- OWASP uploads/XML: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html y https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html

## Revisit

Revaluar stack tras F2 solo si se presentan benchmarks de necesidades reales (RPS, tiempo de proceso, memoria, concurrencia y latencia por conector), sin optimización prematura.
