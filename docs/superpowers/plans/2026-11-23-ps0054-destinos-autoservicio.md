# PS-005.4 Destinos MySQL/SSH autoservicio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que ADMIN agregue perfiles MySQL para cualquier cliente desde el Portal, sin modificar una allowlist del servidor por cada destino y manteniendo validación de red, TLS, fingerprint SSH y autorización por perfil.

**Architecture:** Guardar hostname, puerto y fingerprint SSH dentro del perfil persistido en `portal`. El broker resuelve y valida direcciones por intento, conecta a una IP fijada y mantiene el hostname original para validar TLS; los requests de prueba/operación seleccionan un perfil almacenado, nunca suministran un host. Para SSH, el único forward usa el destino MySQL de ese mismo perfil.

**Tech Stack:** TypeScript estricto, Fastify, TypeBox, Drizzle ORM, PostgreSQL, `node:dns`/`node:net`, `mysql2`, `ssh2`, Vitest y Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-ps0054-destinos-autoservicio-design.md`; contratos existentes `docs/specs/PS-005_CLIENTES_CONEXIONES.md`, `docs/specs/PORTAL_CORE.md` y `docs/architecture/ADR-0002_CUSTODIA_SECRETOS.md` se actualizarán solo después de aprobar este plan.

## Global Constraints

- ADMIN registra y modifica endpoints; SUPPORT no administra destinos ni recibe hostnames internos, fingerprint o secretos.
- MySQL directo y gateway SSH solo aceptan direcciones globalmente enrutables; loopback y red privada solo se permiten como destino MySQL dentro del único forward SSH.
- Link-local, metadata, no especificadas, multicast, reservadas, hostnames con sintaxis no permitida, DNS mixto peligroso y destinos ambiguos se rechazan antes de abrir sockets.
- Resolver A/AAAA una vez por intento, máximo 16 respuestas y 5 segundos; conectar a una IP numérica ya validada, nunca re-resolver dentro del driver. TLS verifica certificado e identidad del hostname original.
- SSH requiere fingerprint SHA-256 configurada por ADMIN y permite únicamente un forward TCP exacto hacia el host y puerto MySQL del perfil; sin shell, agent forwarding, listener o SOCKS.
- Credenciales continúan cifradas por ADR-0002; nunca se devuelven, se imprimen ni se incluyen en fallos de tests/logs.
- Pruebas de migración/integración/E2E usan exclusivamente `portal_soporte_test` o fixtures sintéticos. No migrar `portal_soporte`, conectarse a una base cliente ni ejecutar DML externo.
- No alterar migraciones `0004`–`0008`, Cloudflare, DNS, firewall, PostgreSQL global o servicios existentes; no habilitar `rf-1:execute`.
- TypeScript estricto; JSDoc/TSDoc en español en clases, funciones, métodos, contratos, componentes y endpoints modificados.
- UI/UX requiere Apple Design; conservar validación con tema claro/oscuro, teclado, viewport móvil y movimiento reducido.

## Review Focus

1. Una respuesta DNS con mezcla de IP pública y privada/especial debe rechazarse completamente; el test `resolucion_mixta_rechaza_sin_conectar` lo fija.
2. Un cambio de DNS después de validar no debe cambiar el destino del socket del intento; `broker_conecta_a_ip_fijada_y_conserva_hostname_tls` comprueba IP numérica y SNI/identidad original.
3. Direcciones IPv4-mapped IPv6, IPv6 con zone ID, metadatos, link-local y rangos reservados no deben eludir la política; `clasificacion_ip_especial_rechaza_variantes` los cubre.
4. Loopback/privado solo es válido para el MySQL del perfil mediante SSH con fingerprint correcta; `ssh_permite_solo_forward_del_perfil_y_rechaza_metadata_o_huella_incorrecta` cubre estos límites.
5. Reutilizar un perfil/cliente ajeno o llamar APIs con SUPPORT no debe autorizar destinos ni revelar metadatos; `api_vincula_endpoint_a_cliente_y_rol` verifica 403 y ausencia de campos sensibles.

---

### Task 1: Validar hostnames y direcciones de red

**Files:**
- Create: `packages/connectors/src/network-destination-policy.ts`
- Modify: `packages/connectors/src/index.ts`
- Modify: `packages/contracts/src/clients.ts`
- Test: `tests/unit/network-destination-policy.test.ts`
- Test: `tests/unit/mysql-connection-broker.test.ts`

**Interfaces:**
- Consumes: `EndpointConexionAdmin` actual `{ hostname, port }`.
- Produces: `ResolverDireccionesDestino.resolver(hostname, senal): Promise<readonly string[]>`, `DireccionConexionFijada { hostname, address, port }` y `PoliticaDireccionesDestino.fijarMySqlDirecto(endpoint, senal)`, `.fijarGatewaySsh(endpoint, huella, senal)` y `.fijarMySqlEnTunel(endpoint, senal)`.
- `MYSQL_DIRECT` y `SSH_GATEWAY` solo producen direcciones públicas globales. `MYSQL_TUNNEL_TARGET` permite IP global, privada o loopback validada; excluye link-local/metadata/reservadas. Un nombre que no se resuelva a direcciones verificables falla cerrado.

- [x] **Step 1: Escribir tests unitarios que fallen** para DNS público, mezcla público/privado, timeout, respuesta vacía, hostname malformado, literal IPv4/IPv6, IPv4-mapped IPv6, zone ID, loopback, RFC1918, ULA, link-local, metadata, multicast y rangos reservados.
- [x] **Step 2: Ejecutar los tests focales** con `corepack pnpm@12.21.0 exec vitest run tests/unit/network-destination-policy.test.ts --maxWorkers=1 --no-file-parallelism`; confirmar FAIL por los comportamientos todavía ausentes.
- [x] **Step 3: Implementar** normalización de hostname/puerto y `PoliticaDireccionesDestino` en `packages/connectors/src/network-destination-policy.ts`, usando APIs estándar `node:dns`/`node:net`, límites de respuesta/tiempo y un resolver inyectable. Conectar la policy desde `packages/connectors/src/index.ts`.
- [x] **Step 4: Ajustar el contrato de endpoint** para DNS ASCII normalizado, IPv4/IPv6 literal sin corchetes ni zone ID y puertos 1–65535; definir un objeto SSH separado con fingerprint `SHA256:` validada. Documentar en español los contratos.
- [x] **Step 5: Ejecutar tests focales** y confirmar PASS para direcciones permitidas/rechazadas y que el resolver falso no puede provocar una segunda resolución.
- [x] **Step 6: Commit** con `git add` limitado a los contratos, policy y tests y mensaje `feat(connectors): PS-005.4 validar destinos autoservicio`.

### Task 2: Persistir endpoints de cada perfil con migración aditiva

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0009_connection_profile_destinations.sql`
- Modify: `apps/api/drizzle/meta/_journal.json`
- Create: `apps/api/drizzle/meta/0009_snapshot.json` generado por Drizzle
- Modify: `packages/core/src/clients/connection-profile-ports.ts`
- Modify: `apps/api/src/clients/postgres-connection-profile-repository.ts`
- Test: `tests/integration/connection-profile-destination-migrations.test.ts`
- Test: `tests/unit/migration-scope.test.ts`

**Interfaces:**
- Consumes: `PoliticaDireccionesDestino` y tipos de endpoint de Task 1.
- Produces: `EndpointConexionPersistido { hostname, port }`, `GatewaySshPersistido extends EndpointConexionPersistido { fingerprint }`, y campos correspondientes en `AltaPerfilConexionPersistido`, `CambiosPerfilConexionPersistidos` y perfiles leídos.

- [x] **Step 1: Escribir test de integración PostgreSQL** que aplique el ledger completo hasta 0009 en `portal_soporte_test` y compruebe columnas, tipos, puertos, reglas de consistencia `MYSQL_TCP`/`MYSQL_SSH`, fingerprint y tolerancia de filas legadas con endpoint nuevo `NULL`.
- [x] **Step 2: Ejecutar la prueba focal** contra el estado previo de `portal_soporte_test` y confirmar que falla por las columnas nuevas ausentes, antes de crear 0009.
- [x] **Step 3: Añadir columnas nullable** `destination_hostname`, `destination_port`, `gateway_hostname`, `gateway_port` y `gateway_fingerprint`, junto con CHECKs que impidan perfiles nuevos incompletos o gateways en perfiles directos. No renombrar ni eliminar `destination_id`/`gateway_id`.
- [x] **Step 4: Generar 0009** con `corepack pnpm@12.21.0 run db:generate`; no editar 0004–0008 ni sus snapshots. Documentar alcance y rollback de código al inicio del SQL en español. No crear un `down.sql` que borre endpoints después de que haya perfiles.
- [x] **Step 5: Adaptar repositorio y tipos** para seleccionar y guardar campos de endpoint dentro de la misma transacción de alta/auditoría; asegurar que filtros de consulta de perfiles SUPPORT no incluyan campos de red.
- [x] **Step 6: Ejecutar prueba PostgreSQL remota** y revisar `git diff -- apps/api/drizzle/0004* apps/api/drizzle/0005* apps/api/drizzle/0006* apps/api/drizzle/0007* apps/api/drizzle/0008*`; los archivos y hashes anteriores deben permanecer idénticos.
- [x] **Step 7: Commit** de migración, esquema, repositorio y pruebas con `feat(api): PS-005.4 persistir destinos por perfil`.

### Task 3: Conectar MySQL directo y mediante SSH con la política por perfil

**Files:**
- Modify: `packages/connectors/src/mysql-connection-broker.ts`
- Modify: `packages/connectors/src/mysql2-ssh-factories.ts`
- Modify: `packages/core/src/clients/secret-custody-ports.ts`
- Test: `tests/unit/mysql-connection-broker.test.ts`
- Test: fixture de `scripts/with-mysql-fixture.sh` y sus pruebas asociadas, solo si los contratos actuales lo requieren

**Interfaces:**
- Consumes: `PerfilConexionPrueba` con endpoint guardado, `PoliticaDireccionesDestino`, fábricas `FabricaConexionMySql` y `FabricaTunelSsh`.
- Produces: broker que resuelve y valida `probar`, `abrirLecturaRf1` y el ejecutor existente antes de conectar; `MYSQL_TCP` conecta a IP pública numérica; `MYSQL_SSH` conecta al gateway público fijado y crea exactamente un forward al target perfilado.

- [x] **Step 1: Escribir tests del broker** para perfil creado libre de allowlist, bloqueo antes de socket para IP privada directa, hostname DNS mixto, rebinding, timeout, gateway no público, fingerprint incorrecta, metadata/link-local en target de túnel, loopback y RFC1918 permitido solo por SSH.
- [x] **Step 2: Ejecutar `tests/unit/mysql-connection-broker.test.ts`** en serie y confirmar los fallos previstos.
- [x] **Step 3: Refactorizar tipos y broker** para recibir endpoint del perfil, resolverlo cada vez y transportar el resultado IP fijado hasta la fábrica sin aceptar destinos de la petición.
- [x] **Step 4: Ajustar las fábricas** para conservar el comportamiento ya probado: socket TCP usa `address`; TLS conserva `hostname` original, `verifyIdentity` y `rejectUnauthorized`; SSH verifica fingerprint exacta y `forwardOut` usa exclusivamente host/puerto MySQL del perfil.
- [x] **Step 5: Ejecutar tests unitarios de broker y factories**; comprobar que falla una huella distinta antes de autenticar MySQL y que todas las ramas cierran/borran recursos y secretos.
- [ ] **Step 6: Ejecutar `corepack pnpm@12.21.0 run test:mysql-fixture`** cuando Docker fixture esté disponible; validar MySQL sintético TCP/TLS, túnel SSH, `SELECT 1`, queries RF-1 y negativos TLS/host/destino con limpieza exclusiva del fixture. — NO EJECUTADO localmente: Docker Engine/daemon no está disponible.
- [x] **Step 7: Commit** con `feat(connectors): PS-005.4 validar y fijar sockets MySQL SSH`.

### Task 4: Hacer que ADMIN gestione destinos sin configuración por host

**Files:**
- Modify: `apps/api/src/clients/connection-profile-service.ts`
- Modify: `apps/api/src/clients/connection-runtime-config.ts`
- Modify: `apps/api/src/routes/admin-connection-profile-routes.ts`
- Test: `tests/unit/connection-profile-service.test.ts`
- Test: `tests/integration/admin-user-routes.test.ts`

**Interfaces:**
- Consumes: repositorio con campos persistidos de destino de Task 2 y broker de Task 3.
- Produces: alta de perfil ADMIN con endpoint no presente en configuración operacional; rutas de prueba/lectura siguen recibiendo solo `clientId/profileId`, nunca host/puerto en requests de ejecución.
- Filas legadas con endpoint nuevo `NULL` usan únicamente la allowlist anterior si existe; perfiles nuevos nunca dependen de `PORTAL_CONNECTOR_POLICY_JSON`.

- [x] **Step 1: Escribir tests unitarios/API** que comprueben alta ADMIN 201 para un endpoint no presente en JSON operacional, persistencia ligada al cliente, 422 para payload malformado, fingerprint obligatoria en SSH y rechazo de SSH data en `MYSQL_TCP`.
- [x] **Step 2: Ejecutar tests unitarios focales** con `corepack pnpm@12.21.0 exec vitest run tests/unit/connection-profile-service.test.ts --maxWorkers=1 --no-file-parallelism`; confirmar fallos antes de implementación.
- [x] **Step 3: Modificar `ServicioPerfilesConexion`** para guardar endpoint/fingerprint tal como fueron normalizados, dejar de llamar a `buscarMySql`/`buscarGatewaySsh` al crear o editar y cargar el endpoint únicamente desde el perfil que devuelve el repositorio.
- [x] **Step 4: Configurar runtime** para construir `PoliticaDireccionesDestino` sin una lista estática para perfiles nuevos; conservar resolución legacy solo para filas con metadatos nuevos nulos y documentar su retiro futuro.
- [x] **Step 5: Mantener autorización y redacción**: ADMIN y CSRF para escritura/prueba; SUPPORT sigue 403 en administración; prueba/API nunca acepta destinos alternos; DTOs SUPPORT omiten host, puerto, fingerprint y secretos; errores no reflejan valores recibidos.
- [x] **Step 6: Ejecutar tests focales** y confirmar que un perfil ajeno, hostname cambiado en el request de prueba o SUPPORT no habilita conexión.
- [x] **Step 7: Commit** con `feat(api): PS-005.4 autorizar destinos por perfil`.

### Task 5: Adaptar el formulario y su cobertura visual

**Files:**
- Modify: `apps/web/src/components/clients/connection-profile-management.tsx`
- Modify: `apps/web/src/lib/client-admin-api.ts`
- Modify: `tests/e2e/visual/connection-profile-management.visual.spec.ts`
- Modify: `tests/e2e/visual/rf1-preview.visual.spec.ts` solo si cambian fixtures de contrato

**Interfaces:**
- Consumes: DTO ADMIN con host/puerto/fingerprint; endpoint error estable `DESTINATION_INVALID`, `DESTINATION_UNSAFE`, `DNS_RESOLUTION_FAILED` o equivalente definido por API.
- Produces: formulario familiar de Workbench, sin IDs operacionales; alta y edición guardan el mismo endpoint que el backend prueba.

- [x] **Step 1: Actualizar test visual/E2E** para llenar hostname/puerto directos y fingerprint cuando es SSH, confirmar envío de la operación correcta sin serializar valores de credenciales, guardar endpoint fuera de allowlist y mostrar resultado redactado.
- [x] **Step 2: Ejecutar el test visual focal** antes de tocar la interfaz con `corepack pnpm@12.21.0 exec playwright test --config=playwright.visual.config.ts tests/e2e/visual/connection-profile-management.visual.spec.ts --workers=1`; comprobar FAIL por el contrato/texto actual.
- [x] **Step 3: Cambiar el texto de ayuda**: indicar que ADMIN puede registrar su destino aquí, que «Probar conexión» valida una operación read-only y que las credenciales no se vuelven a mostrar; quitar la afirmación de aprobación por operaciones.
- [x] **Step 4: Añadir campo accesible de fingerprint SSH** con formato SHA-256, explicación de cómo obtenerla y `required` solo para `MYSQL_SSH`; preservar métodos de autenticación actuales y carga PEM/PPK.
- [x] **Step 5: Ejecutar E2E visual** con teclado/foco, desktop y móvil, temas claro/oscuro y `prefers-reduced-motion`; confirmar copy, fingerprint y ausencia de overflow/secrets.
- [x] **Step 6: Commit** con `feat(web): PS-005.4 configurar destinos MySQL sin allowlist manual`.

### Task 6: Migración, regresión y entrega verificable

**Files:**
- Modify: `docs/specs/PS-005_CLIENTES_CONEXIONES.md`
- Modify: `docs/specs/PORTAL_CORE.md`
- Modify: `docs/architecture/ADR-0002_CUSTODIA_SECRETOS.md`
- Modify: `docs/product/DECISIONS_APPROVED.md` (nueva decisión AP-015 derivada de la aprobación explícita del propietario)
- Modify: `docs/operations/TASK_BOARD.md`
- Modify: `docs/operations/WORKLOG.md`
- Modify: `docs/superpowers/specs/2026-11-23-ps0054-destinos-autoservicio-design.md`

**Interfaces:**
- Consumes: Tasks 1–5 completas; perfil nuevo funciona sin allowlist externa y perfiles legacy conservan su fallback.
- Produces: documentación alineada con AP-015/propuesta aprobada, pruebas registradas verídicamente y tarea en `EN_REVISION` si no hay aceptación final.

- [x] **Step 1: Ejecutar integración PostgreSQL y CLI migrador** únicamente en `portal_soporte_test` con `.env.infra-001.local`; comandos: `corepack pnpm@12.21.0 run test:integration:remote` y `corepack pnpm@12.21.0 run test:migrate-cli:remote`. Verificar nombre exacto/rol de test en el preflight antes de DDL; no usar `portal_soporte`.
- [x] **Step 2: Ejecutar E2E funcional** únicamente con `corepack pnpm@12.21.0 run test:e2e:remote`, y test visual focal/full con `corepack pnpm@12.21.0 run test:e2e:visual -- --workers=1`.
- [x] **Step 3: Ejecutar suite unitaria completa** con `corepack pnpm@12.21.0 exec vitest run --maxWorkers=1 --no-file-parallelism`; confirmar conteos, cero skips inesperados, cero abortos y sin error de memoria.
- [x] **Step 4: Ejecutar calidad y seguridad** con `corepack pnpm@12.21.0 run format:check`, `lint`, `typecheck`, `build`, `check:secrets`, `check:dependencies:ci`, `git diff --check`; registrar cada salida real.
- [x] **Step 5: Revisar migraciones** comprobando que `0004`–`0008` no cambian y que 0009 solo crea/modifica objetos autorizados del esquema `portal` en la base de pruebas; comprobar que ninguna prueba ejecutó DDL/DML cliente.
- [x] **Step 6: Revisar diff completo** buscando secretos, logs de payload, DTOs SUPPORT con host/fingerprint y consultas/arbitrariedad; registrar límites, `NO EJECUTADO` y rollback. Revisión final read-only: no se encontraron hallazgos adicionales después de corregir el control de cliente activo; fixture Docker permanece `NO EJECUTADO`.
- [x] **Step 7: Alinear contratos** en PS-005, PORTAL_CORE, ADR-0002 y DECISIONS_APPROVED (AP-015) para que describan perfil como autorización de endpoint y broker fail-closed; preservar el historial de la allowlist estática como decisión supersedida.
- [x] **Step 8: Anexar WORKLOG y actualizar TASK_BOARD** con comandos/resultados, Apple Design leída y evidencias visuales. Mantener el estado `EN_REVISION`; no aplicar 0009 a `portal_soporte` ni desplegar este cambio sin aprobación operativa separada.
- [x] **Step 9: Preparar commit(s) focalizados** conforme al estándar; no hacer merge ni activar release con pruebas fallidas. Se crearon commits separados para el control de cliente activo/regresión, expectativas de pruebas y mensajes de UI; la documentación se entrega en este commit. La migración es forward-only una vez desplegada; rollback de código conserva 0009 y cualquier perfil creado.

## Revisión final del plan

- Cobertura: alta autoservicio, modelo/0009, conexiones directas/SSH, IP fijada, TLS/fingerprint, autorización ADMIN/SUPPORT, secretos, errores, UI, auditoría y verificación aislada quedan asignados a tareas.
- Orden e interfaces: Task 1 define validación y contratos; Task 2 persiste; Task 3 conecta broker/fábricas; Task 4 integra servicio y rutas; Task 5 actualiza la UI; Task 6 ejecuta regresión y registra entrega.
- Método: ejecución **nativa y secuencial** en el checkout; TDD por incremento y commits pequeños. La autorización de aplicar una migración nueva a producción y desplegar no se infiere de la aprobación del diseño.
