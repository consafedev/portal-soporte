# Operación y despliegue — Debian + Cloudflare Tunnel

**Versión:** 0.7 · **Estado:** `soporte.consafedev.qzz.io` publicado por `consafedev-root`; servicios de origen solo en loopback; EN_REVISION, no certificado como producción plena · **Revisado:** 2026-11-20.
**Alcance:** preparar la instalación del núcleo PS-003 en el Debian inventariado sin afectar otras aplicaciones, bases, túneles ni hostnames.

## 1. Decisiones de publicación

- Cloudflare se limita a DNS, proxy HTTPS y Cloudflare Tunnel. **Cloudflare Access queda excluido**; el login del portal es el único mecanismo de autenticación de usuarios.
- Se reutilizará exclusivamente el túnel existente `consafedev-root`, administrado por archivo local. No se creará ni modificará otro túnel.
- El origen público `soporte.consafedev.qzz.io` quedó publicado el 2026-11-20 tras autorización expresa; la evidencia y rollback están en la sección 9.
- No se requiere Nginx como proxy nuevo: Cloudflare Tunnel apuntará al servidor privado de Next.js. Next.js reenviará `/api/v1/*` al listener privado de Fastify mediante el rewrite same-origin existente.
- El API no tendrá una regla de túnel ni un listener público. PostgreSQL del Portal se usa por `127.0.0.1` en el mismo host; ese salto queda dentro del límite local del servidor y no requiere TLS TCP. Todo destino PostgreSQL remoto conserva TLS con validación estricta de certificado.

```text
Navegador (HTTPS)
  -> DNS/proxy TLS de Cloudflare
  -> túnel existente consafedev-root
  -> soporte.consafedev.qzz.io -> 127.0.0.1:18840 (Next.js)
       -> /api/v1/* same-origin -> 127.0.0.1:18841 (Fastify privado)
            -> PostgreSQL local, BD portal_soporte, rol portal_app
```

La ruta de aplicación no expondrá el puerto del API, PostgreSQL, secretos ni trazas técnicas. No se conectará a bases MySQL de clientes en esta etapa.

## 2. Estado del inventario de solo lectura — corte inicial 2026-11-19

El inventario autenticado del 2026-11-19 identificó Debian 12 (`serverAlcazar`), PostgreSQL 15.20, clúster `15/main` y Node del sistema 20.20.0. El proyecto exige Node 24.22.3 según `.node-version`; cualquier runtime futuro del portal deberá instalarse de forma aislada y fijada, sin cambiar `/usr/bin/node` ni las aplicaciones existentes.

En la captura inicial de listeners, `18840` y `18841` estaban libres; después se reservaron para los dos servicios nuevos del Portal, cada uno enlazado exclusivamente a `127.0.0.1`. PostgreSQL escucha en las interfaces preexistentes: esa exposición se mantiene como riesgo separado y no se cambió. No se identificó una tarea programada de respaldo PostgreSQL; el 2026-11-20 se generó un respaldo cifrado manual y se verificó una restauración aislada. La frecuencia programada sigue sin definir.

La captura previa a la publicación de `consafedev-root` se tomó desde `/etc/cloudflared/config-consafedev.yml` y contenía, en este orden:

1. `consafedev.qzz.io` → `http://127.0.0.1:3002`
2. `renios.consafedev.qzz.io` → `http://127.0.0.1:18804`
3. catch-all → `http_status:404`

Durante ese corte inicial `soporte.consafedev.qzz.io` no resolvía por DNS y coincidía con el catch-all. Esa observación quedó superada el 2026-11-20 por la publicación documentada en la sección 9. El servidor contiene otros túneles y aplicaciones activas que quedan fuera de alcance.

## 3. Instalación interna vigente

El 2026-11-20 se activó el merge de `main` SHA `42f4fd50428ef15fc3334f09eef8dd2c0d05408e`, con `NODE_ENV=production` y el origen HTTPS canónico configurados. El hostname está publicado a través del túnel autorizado; web, API y PostgreSQL mantienen listeners/conexiones locales. El release anterior `c86af469bdb8f9d10a940ecce29d0e64110a1a57` se conserva para rollback. La publicación funcional no certifica preparación productiva plena.

| Recurso | Configuración efectiva | Límite de aislamiento |
|---|---|---|
| Usuario Linux `portal-soporte` | Cuenta de servicio sin privilegios administrativos ni shell interactivo; unidades ejecutadas con esta identidad | No reutiliza usuarios existentes |
| Runtime | Node `24.22.3` en `/opt/portal-soporte/runtime/24.22.3` | Runtime aislado; Node global existente no se cambió |
| Release | `/opt/portal-soporte/releases/42f4fd50428ef15fc3334f09eef8dd2c0d05408e`; `current` apunta a este release | Artefactos versionados; el código fuente empaquetado se conserva en `/var/lib/portal-soporte/build-source-42f4fd50428ef15fc3334f09eef8dd2c0d05408e` |
| Web | `127.0.0.1:18840`, Next.js optimizado, `NODE_ENV=production` | Solo loopback; sin ruta de túnel |
| API | `127.0.0.1:18841`, Fastify, `NODE_ENV=production`, `portal_app` → `portal_soporte` por loopback | Solo loopback; sin rol migrator en runtime; no se ejecutó DDL/migración |
| PostgreSQL | BD `portal_soporte`, rol `portal_app`, esquema `portal` | Runtime no usa roles de migración. No se ejecutó DDL ni migración en esta instalación |
| Secretos runtime | `/etc/portal-soporte/api.env` y `web.env`, propietario `root:portal-soporte`, modo `0640`; directorio `root:portal-soporte`, modo `0750` | Fuera del repositorio y de los releases; ningún valor se reproduce aquí |
| Unidades | `portal-soporte-api.service` y `portal-soporte-web.service`, habilitadas y activas | Unidades propias; sin dependencias de parada de otros servicios |

Las unidades usan un release versionado en `WorkingDirectory`/`ExecStart` para conservar la detección de ejecución directa de Fastify, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `UMask=0077` y permisos de escritura restringidos. El proceso de actualización y rollback modifica únicamente las dos unidades del Portal.

Configuración efectiva actual, sin valores secretos:

- Origen canónico: `https://soporte.consafedev.qzz.io`; API interna: `http://127.0.0.1:18841`; login y API comparten origen a través del rewrite de Next.js.
- `TRUSTED_PROXY_CIDRS=127.0.0.1/32` y `TRUSTED_EDGE_PROXY_CIDRS=127.0.0.1/32`; la aplicación valida el `Host` canónico, sanea aliases reenviados y solo acepta datos de proxy del peer de loopback configurado.
- SMTP no configurado; recuperación/verificación de correo no está operativa.
- Las cookies de producción usan prefijo `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` y omiten `Domain`. La verificación externa de HTTPS, `/login`, CSRF, login/logout ADMIN y soporte con 403 autenticado está registrada en WORKLOG y en la sección 9.
- Las credenciales persistentes de runtime se mantienen bajo `/etc/portal-soporte`; se retiraron las copias temporales local/remota del DSN usadas durante el instalador. La custodia local permanece en `.env.infra-001.local`, ignorado por Git y con ACL limitada a la cuenta propietaria y SYSTEM. No se imprimieron ni registraron secretos.

### Entorno HTTPS configurado para la ruta prevista

Los valores no secretos se aplicaron a los archivos de entorno existentes, preservando sus credenciales, y se verificaron en los procesos reiniciados:

| Servicio | Parámetros no secretos configurados |
|---|---|
| API Fastify | `NODE_ENV=production`, `PUBLIC_APP_ORIGIN=https://soporte.consafedev.qzz.io`, `API_INTERNAL_ORIGIN=http://127.0.0.1:18841`, `TRUSTED_PROXY_CIDRS=127.0.0.1/32` |
| Web Next.js | `NODE_ENV=production`, `PUBLIC_APP_ORIGIN=https://soporte.consafedev.qzz.io`, `API_INTERNAL_ORIGIN=http://127.0.0.1:18841`, `WEB_LISTEN_HOST=127.0.0.1`, `TRUSTED_EDGE_PROXY_CIDRS=127.0.0.1/32` |

La frontera externa prevista es `cloudflared` conectando al listener web por loopback. La aplicación compara `Host` con el origen HTTPS configurado, elimina `Forwarded`, `X-Forwarded-Proto`, `X-Forwarded-Host` y aliases de IP recibidos, y solo deriva una IP de `X-Forwarded-For` cuando el peer TCP pertenece al CIDR loopback explícito. El rewrite de Next.js conserva `/api/v1/*` same-origin. Fastify confía únicamente en loopback; CSRF y enlaces usan el origen canónico fijo, no valores reenviados. Se probaron localmente `Host` falsificado (400), escritura sin CSRF (403), `/login` (200), `/api/v1/auth/csrf` same-origin (200) y los atributos de su cookie sin registrar el valor del token.

Cloudflare documenta que [`X-Forwarded-Proto`](https://developers.cloudflare.com/fundamentals/reference/http-headers/) refleja el protocolo del visitante y se sobrescribe en su proxy; esta aplicación no lo necesita ni lo usa para decidir seguridad. Cloudflare envía `X-Forwarded-For` con la IP de visitante cuando no había una cadena previa y agrega saltos de proxy cuando sí la había. La sanitización local recorre la cadena desde el peer conocido, con máximo de 16 saltos y sin confiar en cabeceras de IP alternativas. La opción Tunnel [`httpHostHeader`](https://developers.cloudflare.com/tunnel/configuration/) solo se añadirá si la prueba real de origin demuestra que el Host público no se conserva.

El orden de arranque es API y luego web. Ambos servicios están `active`/`enabled`; las consultas de estado, puertos y HTTP no escribieron en PostgreSQL. No se habilitó un proxy confiable amplio ni se modificó configuración global.

## 4. Plan de Cloudflare — preparación histórica y ejecución registrada en §9

El procedimiento siguiente se conserva como evidencia del cambio autorizado. La edición y validación ya se ejecutaron el 2026-11-20; véase la sección 9 para el respaldo, diff, prueba externa y rollback actual.

La edición propuesta de `/etc/cloudflared/config-consafedev.yml` agrega una sola regla, antes del catch-all:

```yaml
  - hostname: soporte.consafedev.qzz.io
    service: http://127.0.0.1:18840
```

El bloque se insertará después de las reglas existentes de `consafedev.qzz.io` y `renios.consafedev.qzz.io`, sin cambiar, reordenar ni reformatear sus destinos; el catch-all permanece al final. La propuesta no altera `/etc/cloudflared/config.yml`, `config-xmlclean.yml`, otros servicios `cloudflared-*`, ni túneles `soporte`, `xml-cleaner-tunnel` o `zammad`.

Antes de pedir autorización de aplicación se presentará el diff real contra el archivo vigente y se comprobará que contiene exclusivamente la nueva regla. La ventana aprobada incluirá:

1. Confirmar nuevamente identidad del host, estado de la unidad `cloudflared-consafedev.service`, listeners y ausencia de conflicto DNS.
2. Respaldar el archivo a una ruta nueva con propietario/permisos conservados y registrar hashes previo y posterior; no copiar ni mostrar el contenido de credenciales del túnel.
3. Validar la configuración candidata con `cloudflared tunnel --config <ruta> ingress validate` y simular el match del hostname nuevo y de los dos actuales.
4. Solicitar aprobación antes de escribir el archivo, reiniciar `cloudflared-consafedev.service` o crear el registro DNS.
5. Después de una aprobación, aplicar solo el cambio revisado y verificar que las dos rutas existentes conservan orden, hostname y destino, que la tercera ruta coincide con el nuevo puerto y que los otros dos túneles/unidades siguen activos.

No se reiniciará `cloudflared.service`, `cloudflared-xmlclean.service`, ni ningún otro servicio. No se habilitará Cloudflare Access.

### Evidencia de preparación (2026-11-19, solo lectura; superada por §9)

- La ruta efectiva revisada fue `/etc/cloudflared/config-consafedev.yml`. Las reglas existentes conservan el orden `consafedev.qzz.io` → `127.0.0.1:3002`, `renios.consafedev.qzz.io` → `127.0.0.1:18804` y catch-all `http_status:404`.
- La configuración activa validó correctamente con `cloudflared tunnel ingress validate`. Una configuración candidata que agrega únicamente `soporte.consafedev.qzz.io` → `http://127.0.0.1:18840` antes del catch-all también validó y dejó las dos rutas preexistentes en el mismo orden.
- La consulta DNS del hostname nuevo devolvió `NXDOMAIN`; no existe un registro que lo publique. No se escribió ni respaldó configuración, no se recargó cloudflared y no se creó DNS.
- La regla actualmente coincidente para el hostname nuevo es el catch-all 404. La ruta permanece solo como propuesta y no se pide autorización para aplicarla hasta resolver las puertas de seguridad siguientes.

## 5. Validación de publicación y riesgos pendientes

El Portal usa el merge `42f4fd50428ef15fc3334f09eef8dd2c0d05408e`; Node 24.22.3 y PostgreSQL 15.20 permanecen aislados del Node global y de otras bases. Las dos unidades propias reportan `active`, `ExecMainStatus=0`, `User/Group=portal-soporte`, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes` y `UMask=0077`. Los listeners observados son exclusivamente `127.0.0.1:18840` y `127.0.0.1:18841`. El proceso API apunta a `portal_soporte` con usuario `portal_app` por loopback. Una consulta de sesión con token sintético inválido devolvió 401 sin crear usuarios, sesiones ni cambios en la base. No se ejecutó DDL ni migración en la base permanente.

La validación más reciente antes del merge registró: unitarias 26 archivos/227 pruebas PASS con máximo dos workers concurrentes; integración remota aislada en `portal_soporte_test` 6 archivos/55 pruebas PASS; E2E remotas 9/9 PASS con un worker. Las pruebas incluyen ADMIN, SUPPORT con 403, cambio de contraseña y revocación, altas directas y correo deshabilitado. En esa revisión también pasaron lint, typecheck, build, `check:secrets`, `check:dependencies:ci`, auditoría de producción y `format:check`; `audit --prod` no reportó vulnerabilidades conocidas y el gate de dependencias conserva un hallazgo moderado de desarrollo. `@sinclair/typebox@0.34.52` está declarada directamente en `apps/api`. El build requiere `API_INTERNAL_ORIGIN`; se compiló con `http://127.0.0.1:18841` en el entorno temporal del proceso, sin guardar el valor en archivos. En la verificación posterior, `format:check` sobre el checkout Windows marcó 44 archivos; la configuración Git global `core.autocrlf=true` convierte los blobs LF a CRLF pese a `.prettierrc.json` fijar LF. La revisión de contenido Git con Prettier cubrió 139 blobs versionados y no encontró diferencias; no se reescribió código.

La conectividad productiva del Portal es TCP `127.0.0.1:5432/portal_soporte` bajo `portal_app`; el cliente omite TLS únicamente para loopback local y exige TLS validado en destinos remotos. PostgreSQL anuncia TLS mínimo 1.2 y escucha en las interfaces existentes. UFW sigue permitiendo `5432/tcp` desde cualquier origen IPv4 e IPv6. El propietario decidió mantener las reglas actuales para esta etapa y acepta el riesgo; no se modificaron. El riesgo está documentado, pero no bloquea la ruta web autorizada.

Por AP-013, no se implementará MFA para ADMIN ni SUPPORT; el propietario acepta el riesgo de un factor. No hay MFA funcional que se presente como activo. SMTP no está configurado; alta y restablecimiento directos quedan a cargo de ADMIN, y verificación/recuperación por correo permanecen explícitamente deshabilitadas. El propietario verificó login/logout ADMIN y una sesión SUPPORT controlada; esta última recibió 403 en `GET /api/v1/admin/users`. No se creó una cuenta de prueba productiva.

La ruta pública se activó el 2026-11-20. Siguen pendientes de verificación o mitigación, sin suspender la publicación autorizada:

1. Mantener explícito el riesgo aceptado de ADMIN y SUPPORT autenticados con un factor. MFA no es puerta de este release ni está autorizado para implementación.
2. Mantener bloqueadas las funciones que requieren correo mientras SMTP no exista; no registrar entregas simuladas.
3. Respaldo cifrado y restore aislado: ejecutados y verificados; la base de restauración fue eliminada tras verificar identidad exacta y cero sesiones. El artefacto y su custodia siguen según `docs/operations/POSTGRES_BACKUP_POLICY.md`; falta respaldar la clave de recuperación en un gestor independiente.
4. PostgreSQL escucha en `*`; UFW permite 5432 desde cualquier origen IPv4/IPv6. La regla HBA remota observada autoriza `10.18.170.0/24` con SCRAM y el runtime del Portal usa loopback. El propietario decidió el 2026-11-20 mantener las reglas actuales; no se añadirá una regla de subred ni se retirarán las reglas `Anywhere`. La exposición queda como riesgo aceptado para esta etapa.
5. El release está en modo producción con origen `https://soporte.consafedev.qzz.io`, cookies `__Host-` `Secure`, `HttpOnly` y `SameSite=Strict`, proxy explícito `127.0.0.1/32`, rechazo de Host falsificado y protección CSRF. El propietario completó login/logout ADMIN y login SUPPORT; la sesión SUPPORT recibió 403 al consultar usuarios administrativos.
6. Revisar rotación/custodia de credenciales de servicio fuera de Git; no registrar valores. Las variables actuales permanecen fuera del repositorio y sus rutas usan permisos restringidos.
7. Las pruebas unitarias, integración PostgreSQL aislada y E2E cubren ADMIN, SUPPORT 403, cambio de contraseña, logout/revocación, rate limits, correo inactivo y roles. No se ejecutaron pruebas destructivas, migraciones ni escrituras de usuarios sobre la base permanente.
8. Mantener SMTP y funciones dependientes del correo deshabilitadas; ADMIN gestiona altas y restablecimientos directos mientras no exista SMTP real.
9. Revisar el hallazgo moderado de `esbuild` y mantener el riesgo temporal de `picomatch` según `docs/operations/DEPENDENCY_SECURITY.md` (revisión 2026-12-10 UTC; vencimiento 2026-12-17 UTC).

La publicación HTTPS está activa, pero no equivale a certificar preparación productiva plena. No se configuró Cloudflare Access.

### Respaldo cifrado y restauración de verificación (2026-11-20)

El propietario autorizó exclusivamente `portal_soporte_restore_verify_20261119`. La identidad del host se verificó; ejecuta Debian 12, PostgreSQL 15.20, clúster `15/main`. Antes de crearla el nombre estaba ausente; luego se creó con `template0`, UTF8 y locale `es_MX.UTF-8`. No se creó ningún rol ni se modificó ACL global.

SQL aplicado únicamente a la base temporal:

```sql
CREATE DATABASE portal_soporte_restore_verify_20261119
  WITH OWNER = postgres TEMPLATE = template0 ENCODING = 'UTF8'
  LC_COLLATE = 'es_MX.UTF-8' LC_CTYPE = 'es_MX.UTF-8';
REVOKE ALL PRIVILEGES ON DATABASE portal_soporte_restore_verify_20261119 FROM PUBLIC;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE portal_soporte_restore_verify_20261119 TO portal_migrator;
```

Después de conectarse a esa base como `postgres`, crear solo el esquema de destino:

```sql
CREATE SCHEMA portal AUTHORIZATION portal_migrator;
```

Se comprobó que `PUBLIC` y `portal_app` no tienen `CONNECT`; solo `portal_migrator` recibió `CONNECT`, `CREATE` y `TEMPORARY` en la base temporal. Los roles del Portal mantienen desactivados `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION` y `BYPASSRLS`. El esquema `portal` se creó con propietario `portal_migrator`; `pg_restore --schema=portal --no-owner --no-acl` no restauró roles, ACL ni otros esquemas. El primer intento reveló que `--schema` omite el objeto de creación del esquema; se corrigió precreándolo vacío y el restore final terminó con código 0.

El respaldo consistente fue producido en flujo directo desde `pg_dump` a GnuPG AES-256, sin dump en claro persistente. Rutas exactas, custodia DPAPI, fecha, tamaño y SHA-256 constan en el manifiesto local, fuera del repositorio; las copias cifradas local y remota coincidieron (4,996 bytes). La apertura DPAPI con la cuenta propietaria y `pg_restore --list` se comprobaron sin mostrar ni registrar la clave.

La comparación posterior de origen y destino pasó sin imprimir filas ni hashes de contraseñas: 7/7 tablas, 20/20 filas totales, SHA-256 canónico de todas las filas por tabla, 20 definiciones de índices, 24 definiciones de restricciones, ledger de migraciones coincidente y todos los índices válidos. `portal_app` no podía conectar al destino; la aplicación web no se conectó ni se ejecutaron pruebas de autenticación sobre esa copia.

Antes del rollback se revalidaron el nombre/OID exactos, ACL, esquema, inventario y cero sesiones activas. Se eliminó únicamente `portal_soporte_restore_verify_20261119`, sin terminar sesiones. La verificación posterior confirmó la ausencia del destino y que `portal_soporte` y `portal_soporte_test` conservan sus identidades y siguen disponibles. El procedimiento/retención del artefacto está documentado en `docs/operations/POSTGRES_BACKUP_POLICY.md`; retención cifrada con revisión el `2026-12-19`, sin borrado automático.

No se observó una sesión remota activa al momento de la consulta; esto no prueba que otras aplicaciones nunca se conecten. `pg_hba.conf` contiene una regla remota SCRAM para `10.18.170.0/24`, además de loopback. UFW mantiene reglas actuales `5432/tcp ALLOW Anywhere` para IPv4 y IPv6 (números 6 y 11 en la consulta puntual). La propuesta histórica de limitar UFW a `10.18.170.0/24` quedó superada por la decisión del propietario del 2026-11-20 de conservar el perímetro actual; no se aplicó ningún cambio UFW.

## 6. Actualización y rollback aislados

La actualización futura usará un release inmutable y probará build/migraciones en `portal_soporte_test`. No se ejecutan pruebas destructivas ni migraciones sin revisión en `portal_soporte`.

Rollback interno de esta instalación (si se autoriza detener el Portal): detener y deshabilitar únicamente `portal-soporte-web.service` y `portal-soporte-api.service`; conservar `/opt/portal-soporte`, `/etc/portal-soporte`, `/var/lib/portal-soporte` y la BD. No borrar releases ni secretos y no ejecutar comandos sobre servicios ajenos. Para volver de una actualización a este release, ajustar `WorkingDirectory`, `ExecStart` y permisos de escritura de las dos unidades al path versionado `c86af469bdb8f9d10a940ecce29d0e64110a1a57`, ejecutar `systemctl daemon-reload`, iniciar primero API y luego web, y verificar los healthchecks. No hay rollback de esquema necesario para esta instalación: no se ejecutaron migraciones.

Rollback de publicación, únicamente con autorización: retirar solo el registro DNS nuevo y la regla `soporte.consafedev.qzz.io` agregada al túnel `consafedev-root`, restaurar el archivo respaldado si la comparación de rutas confirma que no hubo cambios concurrentes y reiniciar solo `cloudflared-consafedev.service`. Si el archivo difiere del respaldo por cambios ajenos, detenerse y solicitar revisión. No restaurar túneles completos ni revertir hostnames preexistentes.

## 7. Registro de cambios externos

| Elemento | Estado en esta revisión | Evidencia / siguiente control |
|---|---|---|
| Servicios del Portal en Debian | Release `42f4fd50428ef15fc3334f09eef8dd2c0d05408e` activo en modo producción; ambos `active` y `enabled` | Listener privado `127.0.0.1:18840/18841`; comprobaciones de host, CSRF, cookie y consulta DB descritas arriba |
| PostgreSQL `portal_soporte` | Conectividad de runtime verificada; sin DDL/migraciones | Rol de runtime `portal_app`; esquema preexistente conservado |
| Rutas existentes `consafedev` y `renios` | Preservadas | `consafedev.qzz.io` → `127.0.0.1:3002` y `renios.consafedev.qzz.io` → `127.0.0.1:18804`; mantienen su orden y responden por HTTPS |
| Hostname `soporte.consafedev.qzz.io` | Publicado por el túnel autorizado | CNAME al UUID real de `consafedev-root`; HTTPS `/login` y CSRF 200, endpoint admin anónimo 401, escritura sin CSRF 403 |
| Otros túneles y hostnames | Sin cambios | Solo se reinició `cloudflared-consafedev.service`; los PID de `cloudflared.service` y `cloudflared-xmlclean.service` no cambiaron |
| Cloudflare Access | No configurado | Decisión aprobada: excluido |

## 9. Publicación autorizada (2026-11-20)

El propietario autorizó expresamente añadir solo `soporte.consafedev.qzz.io` al túnel `consafedev-root`. La configuración activa `/etc/cloudflared/config-consafedev.yml` conserva primero las reglas preexistentes de `consafedev.qzz.io` y `renios.consafedev.qzz.io`, inserta la regla Portal inmediatamente antes del catch-all 404 y no crea un túnel nuevo. Cloudflare confirmó el UUID `23ca1aed-197f-4a1a-a0c8-2d216c450069`; el CNAME apunta al túnel existente. Cloudflare Access no se configuró.

Antes del cambio se respaldó la configuración en `/etc/cloudflared/config-consafedev.yml.bak.deploy-002.20261120T183846Z` (SHA-256 `5b501292bde431d35398c456b58e9b903bb8f8caaf2264182dac4a7b3db3eace`, modo `0600`). El diff fue exclusivamente:

```diff
  - hostname: soporte.consafedev.qzz.io
    service: http://127.0.0.1:18840
```

`cloudflared tunnel ingress validate` pasó antes y después. La unidad no admite `reload` (`CanReload=no`), por lo que se reinició únicamente `cloudflared-consafedev.service`; las unidades del Portal y los otros túneles conservaron PID y estado activo. La configuración vigente tiene SHA-256 `1227f0a3cf2f54e8b226469c15e53be4f2739d1e23f772f7bd0c154e1980be5e`.

Verificación externa desde Windows: CNAME/A/AAAA resueltos; TLS verificado por `curl` (`ssl_verify_result=0`); `/login` 200, CSRF 200, `/api/v1/admin/users` anónimo 401 y POST logout sin token CSRF 403. La cookie CSRF es `__Host-portal_csrf` con `Secure`, `HttpOnly` y `SameSite=Strict`. `consafedev.qzz.io` respondió 200 y `renios.consafedev.qzz.io` respondió 303, ambos con TLS válido; el redirect de ReniOS termina en 200. El propietario inició y cerró sesión ADMIN desde el navegador; el dashboard mostró el rol Administración. La verificación pública de SUPPORT sigue pendiente de una cuenta controlada. No se cambiaron UFW, PostgreSQL, firewall, DNS de otros nombres, otros túneles o servicios web/API.

Rollback ya preparado: retirar solo el CNAME de `soporte.consafedev.qzz.io`, restaurar el respaldo únicamente si la configuración actual aún coincide con el hash conocido y no hay cambios concurrentes, y reiniciar solo `cloudflared-consafedev.service`. No revertir registros, orden ni servicios existentes.

## 8. Fuentes técnicas

- Cloudflare Tunnel, configuración local de ingress: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/
- Next.js, autohospedaje y proxy: https://nextjs.org/docs/app/guides/self-hosting
