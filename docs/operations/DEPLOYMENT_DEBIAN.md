# Operación y despliegue — Debian + Cloudflare Tunnel

**Versión:** 0.5 · **Estado:** instalación interna privada en revisión; publicación externa NO ejecutada · **Revisado:** 2026-11-20.
**Alcance:** preparar la instalación del núcleo PS-003 en el Debian inventariado sin afectar otras aplicaciones, bases, túneles ni hostnames.

## 1. Decisiones de publicación

- Cloudflare se limita a DNS, proxy HTTPS y Cloudflare Tunnel. **Cloudflare Access queda excluido**; el login del portal es el único mecanismo de autenticación de usuarios.
- Se reutilizará exclusivamente el túnel existente `consafedev-root`, administrado por archivo local. No se creará ni modificará otro túnel.
- El origen público será `soporte.consafedev.qzz.io`, sujeto a disponibilidad de DNS/certificado y a una aprobación separada antes de publicarlo.
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

## 2. Estado de inventario de solo lectura

El inventario autenticado del 2026-11-19 identificó Debian 12 (`serverAlcazar`), PostgreSQL 15.20, clúster `15/main` y Node del sistema 20.20.0. El proyecto exige Node 24.22.3 según `.node-version`; cualquier runtime futuro del portal deberá instalarse de forma aislada y fijada, sin cambiar `/usr/bin/node` ni las aplicaciones existentes.

En la captura inicial de listeners, `18840` y `18841` estaban libres; después se reservaron para los dos servicios nuevos del Portal, cada uno enlazado exclusivamente a `127.0.0.1`. PostgreSQL escucha en las interfaces preexistentes: esa exposición se mantiene como riesgo separado y no se cambió. No se identificó una tarea programada de respaldo PostgreSQL; el 2026-11-20 se generó un respaldo cifrado manual y se verificó una restauración aislada. La frecuencia programada sigue sin definir.

La configuración actual inspeccionada de `consafedev-root` está en `/etc/cloudflared/config-consafedev.yml` y contiene, en este orden:

1. `consafedev.qzz.io` → `http://127.0.0.1:3002`
2. `renios.consafedev.qzz.io` → `http://127.0.0.1:18804`
3. catch-all → `http_status:404`

La validación de ingress actual pasó. `soporte.consafedev.qzz.io` no resolvía a DNS durante esa consulta y coincidía con el catch-all. El hostname debe revalidarse antes de cualquier publicación. El servidor también contiene otros túneles y aplicaciones activas que quedan fuera de alcance.

## 3. Instalación interna vigente

El 2026-11-19 se instaló el release de `main` SHA `c86af469bdb8f9d10a940ecce29d0e64110a1a57`. La instalación es privada y queda `EN_REVISION`; no constituye una liberación productiva ni autoriza publicación externa.

| Recurso | Configuración efectiva | Límite de aislamiento |
|---|---|---|
| Usuario Linux `portal-soporte` | Cuenta de servicio sin privilegios administrativos ni shell interactivo; unidades ejecutadas con esta identidad | No reutiliza usuarios existentes |
| Runtime | Node `24.22.3` en `/opt/portal-soporte/runtime/24.22.3` | Runtime aislado; Node global existente no se cambió |
| Release | `/opt/portal-soporte/releases/c86af469bdb8f9d10a940ecce29d0e64110a1a57`; `current` apunta a este release | Los artefactos viven bajo rutas nuevas del Portal |
| Web | `127.0.0.1:18840`, Next.js optimizado, `NODE_ENV=production` | Solo loopback; sin ruta de túnel |
| API | `127.0.0.1:18841`, Fastify, `NODE_ENV=development` | Solo loopback; este modo permite HTTP y cookies de desarrollo; no exponerlo públicamente |
| PostgreSQL | BD `portal_soporte`, rol `portal_app`, esquema `portal` | Runtime no usa roles de migración. No se ejecutó DDL ni migración en esta instalación |
| Secretos runtime | `/etc/portal-soporte/api.env` y `web.env`, propietario `root:portal-soporte`, modo `0640`; directorio `root:portal-soporte`, modo `0750` | Fuera del repositorio y de los releases; ningún valor se reproduce aquí |
| Unidades | `portal-soporte-api.service` y `portal-soporte-web.service`, habilitadas y activas | Unidades propias; sin dependencias de parada de otros servicios |

Las unidades usan un release versionado en `WorkingDirectory`/`ExecStart` para conservar la detección de ejecución directa de Fastify, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `UMask=0077` y permisos de escritura restringidos. El proceso de actualización y rollback modifica únicamente las dos unidades del Portal.

Configuración privada actual, sin valores secretos:

- Origen: `http://127.0.0.1:18840`; API interna: `http://127.0.0.1:18841`; login y API comparten origen a través del rewrite de Next.js.
- `TRUSTED_PROXY_CIDRS` y `TRUSTED_EDGE_PROXY_CIDRS` vacíos: no se confía en cabeceras `Forwarded`/`X-Forwarded-*` en este despliegue sin proxy externo.
- SMTP no configurado; recuperación/verificación de correo no está operativa.
- La unidad API usa cookie de desarrollo sin atributo `Secure`, apropiada solo para este acceso HTTP privado por localhost/túnel SSH. Antes de HTTPS público debe configurarse modo de producción, origen HTTPS, proxy confiable explícito y cookie `Secure`, y volver a validar CSRF/rate limits/log redaction.
- Las credenciales persistentes de runtime se mantienen bajo `/etc/portal-soporte`; se retiraron las copias temporales local/remota del DSN usadas durante el instalador. La custodia local permanece en `.env.infra-001.local`, ignorado por Git y con ACL limitada a la cuenta propietaria y SYSTEM. No se imprimieron ni registraron secretos.

### Candidato de entorno para HTTPS detrás de Tunnel

El siguiente entorno es una propuesta para el release candidato; todavía no se escribió en los archivos activos ni se reiniciaron las unidades:

| Servicio | Parámetros no secretos propuestos |
|---|---|
| API Fastify | `NODE_ENV=production`, `PUBLIC_APP_ORIGIN=https://soporte.consafedev.qzz.io`, `API_INTERNAL_ORIGIN=http://127.0.0.1:18841`, `TRUSTED_PROXY_CIDRS=127.0.0.1/32` |
| Web Next.js | `NODE_ENV=production`, `PUBLIC_APP_ORIGIN=https://soporte.consafedev.qzz.io`, `API_INTERNAL_ORIGIN=http://127.0.0.1:18841`, `WEB_LISTEN_HOST=127.0.0.1`, `TRUSTED_EDGE_PROXY_CIDRS=127.0.0.1/32` |

La frontera externa esperada es el proceso local `cloudflared` que conecta al listener web por loopback. La aplicación web compara `Host` con el único origen HTTPS configurado, elimina `Forwarded`, `X-Forwarded-Proto`, `X-Forwarded-Host` y aliases de IP recibidos del cliente, y solo deriva una IP de `X-Forwarded-For` cuando el peer TCP es loopback confiable. El rewrite de Next.js mantiene `/api/v1/*` same-origin. Fastify confía únicamente en el peer local de Next.js; las decisiones de CSRF y enlaces usan el origen canónico fijo, no `X-Forwarded-Proto`. En producción las cookies llevan prefijo `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` y sin `Domain`.

Cloudflare documenta que [`X-Forwarded-Proto`](https://developers.cloudflare.com/fundamentals/reference/http-headers/) refleja el protocolo del visitante y se sobrescribe en su proxy; esta aplicación no lo necesita ni lo usa para decidir seguridad. Cloudflare envía `X-Forwarded-For` con la IP de visitante cuando no había una cadena previa y agrega saltos de proxy cuando sí la había. La sanitización local recorre la cadena desde el peer conocido, con máximo de 16 saltos y sin confiar en cabeceras de IP alternativas. La opción Tunnel [`httpHostHeader`](https://developers.cloudflare.com/tunnel/configuration/) solo se añadirá si la prueba real de origin demuestra que el Host público no se conserva.

El orden de arranque es API y luego web. Ambos servicios están `active`/`enabled`; las consultas de estado, puertos y HTTP no escribieron en PostgreSQL. No se habilitó un proxy confiable amplio ni se modificó configuración global.

## 4. Plan exacto para la ruta de Cloudflare

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

### Evidencia de preparación (2026-11-19, solo lectura)

- La ruta efectiva revisada fue `/etc/cloudflared/config-consafedev.yml`. Las reglas existentes conservan el orden `consafedev.qzz.io` → `127.0.0.1:3002`, `renios.consafedev.qzz.io` → `127.0.0.1:18804` y catch-all `http_status:404`.
- La configuración activa validó correctamente con `cloudflared tunnel ingress validate`. Una configuración candidata que agrega únicamente `soporte.consafedev.qzz.io` → `http://127.0.0.1:18840` antes del catch-all también validó y dejó las dos rutas preexistentes en el mismo orden.
- La consulta DNS del hostname nuevo devolvió `NXDOMAIN`; no existe un registro que lo publique. No se escribió ni respaldó configuración, no se recargó cloudflared y no se creó DNS.
- La regla actualmente coincidente para el hostname nuevo es el catch-all 404. La ruta permanece solo como propuesta y no se pide autorización para aplicarla hasta resolver las puertas de seguridad siguientes.

## 5. Pruebas actuales y puertas antes de publicar

La instalación interna permanece en release `c86af469bdb8f9d10a940ecce29d0e64110a1a57`; los cambios de esta rama son locales y no se instalaron en Debian. El inventario autenticado de solo lectura confirmó Debian 12.15, Node 24.22.3 aislado, PostgreSQL 15.20 y los servicios propios web/API activos en `127.0.0.1:18840/18841`. Los smoke tests manuales ya registrados para ese release observaron `/login` 200, CSRF same-origin 200, `/auth/me` sin sesión 401, login ADMIN, gestión de usuarios, cambio de contraseña y logout. La conectividad de runtime usa exclusivamente `portal_app` y `portal_soporte`; no se ejecutó DDL en la base permanente.

La validación de esta rama incluye: unitarias 26 archivos/236 pruebas PASS con máximo dos workers concurrentes; integración remota aislada en `portal_soporte_test` 6 archivos/55 pruebas PASS; E2E remotas 9/9 PASS con un worker. Las pruebas incluyen ADMIN, SUPPORT con 403, cambio de contraseña y revocación, altas directas y correo deshabilitado. En esta iteración también pasaron lint, typecheck, build, `check:secrets`, `check:dependencies:ci`, `audit --prod` y formato focalizado de los cambios TLS; falta la verificación global de formato después de las últimas ediciones documentales. `audit --prod` no reportó vulnerabilidades conocidas; el gate CI de dependencias conserva un hallazgo moderado de desarrollo. `@sinclair/typebox@0.34.52` está declarada directamente en `apps/api`. El build requiere `API_INTERNAL_ORIGIN`; se compiló con `http://127.0.0.1:18841` en el entorno temporal del proceso, sin guardar el valor en archivos.

La configuración efectiva del servidor todavía no es de producción: el API corre con `NODE_ENV=development`, origen público `http://127.0.0.1:18840`, proxies confiables vacíos y conecta por TCP a `127.0.0.1:5432/portal_soporte` con `portal_app`; TLS se omite solo porque el peer de PostgreSQL es loopback en el mismo host. La rama candidate ahora mantiene esa excepción para producción local y exige TLS validado para todo destino remoto. PostgreSQL tiene TLS habilitado con mínimo TLS 1.2, escucha en todas las interfaces, y UFW permite `5432/tcp` en IPv4 e IPv6; `pg_hba.conf` no exige `hostssl` para el rango de red existente. No se modificaron firewall, PostgreSQL, unidades ni variables de runtime. La exposición efectiva desde Internet no se midió; el hostname permanece cerrado hasta aprobar el cambio de UFW y finalizar la configuración de producción/proxy.

Por AP-013, no se implementará MFA para ADMIN ni SUPPORT; el propietario acepta el riesgo de un factor y MFA no es una puerta de publicación. No hay MFA funcional que se presente como activo. SMTP no está configurado; alta y restablecimiento directos quedan a cargo de ADMIN, y verificación/recuperación por correo permanecen explícitamente deshabilitadas. El smoke test E2E cubre el 403 SUPPORT en el código local; no se creó una cuenta de prueba en la base permanente.

Siguen pendientes antes de publicar externamente:

1. Mantener explícito el riesgo aceptado de ADMIN y SUPPORT autenticados con un factor. MFA no es puerta de este release ni está autorizado para implementación.
2. Mantener bloqueadas las funciones que requieren correo mientras SMTP no exista; no registrar entregas simuladas.
3. Respaldo cifrado y restore aislado: ejecutados y verificados; la base de restauración fue eliminada tras verificar identidad exacta y cero sesiones. El artefacto y su custodia siguen según `docs/operations/POSTGRES_BACKUP_POLICY.md`; falta respaldar la clave de recuperación en un gestor independiente.
4. PostgreSQL escucha en `*`; UFW permite 5432 desde cualquier origen IPv4/IPv6. `pg_hba.conf` solo permite remoto `10.18.170.0/24` con SCRAM y host local loopback; no se observaron sesiones remotas en la consulta puntual. Proponer UFW limitado a `10.18.170.0/24`, preservando localhost; no cambiar UFW ni HBA sin autorización específica.
5. Preparar y activar el modo de producción con HTTPS público, cookies `Secure`/`HttpOnly`/`SameSite`, Host permitido, cabeceras proxy confiables únicamente desde el peer local, CSRF y respuestas privadas. La instalación efectiva sigue en HTTP/development y los archivos activos no se modificaron.
6. Revisar rotación y custodia de credenciales de servicio fuera de Git; no registrar valores.
7. Repetir smoke tests en el release candidato: login de ambos roles, SUPPORT 403, cambio de contraseña, logout/revocación, rate limits, redacción y recuperación de unidades. Las pruebas destructivas se limitan a `portal_soporte_test`; no hacer pruebas de escritura en `portal_soporte`.
8. Revisar el hallazgo moderado de `esbuild` y mantener el riesgo temporal de `picomatch` según `docs/operations/DEPENDENCY_SECURITY.md` (revisión 2026-12-10 UTC; vencimiento 2026-12-17 UTC).
9. Confirmar el diff final y rollback de Cloudflare, respaldo de la configuración efectiva y DNS antes de solicitar autorización de aplicación.

Mientras cualquiera de estas puertas siga abierta, no crear DNS, no añadir la ruta del túnel ni declarar el portal productivo. La instalación actual permanece privada y no equivale a publicación.

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

No se observó una sesión remota activa al momento de la consulta; esto no prueba que otras aplicaciones nunca se conecten. `pg_hba.conf` contiene una regla remota SCRAM para `10.18.170.0/24`, además de loopback. UFW mantiene reglas actuales `5432/tcp ALLOW Anywhere` para IPv4 y IPv6 (números 6 y 11 en la consulta puntual). Propuesta para revisión independiente: añadir `sudo ufw allow from 10.18.170.0/24 to any port 5432 proto tcp`, revalidar servicios/apps y luego retirar solo las reglas amplias exactas después de volver a comprobar sus números. Esta restricción conserva las fuentes remotas que la regla HBA observada acepta y deja loopback local. Rollback de emergencia: restaurar las reglas IPv4/IPv6 previas solo si se interrumpe un cliente legítimo, luego revisar su origen; no se aplicó nada en esta tarea.

## 6. Actualización y rollback aislados

La actualización futura usará un release inmutable y probará build/migraciones en `portal_soporte_test`. No se ejecutan pruebas destructivas ni migraciones sin revisión en `portal_soporte`.

Rollback interno de esta instalación (si se autoriza detener el Portal): detener y deshabilitar únicamente `portal-soporte-web.service` y `portal-soporte-api.service`; conservar `/opt/portal-soporte`, `/etc/portal-soporte`, `/var/lib/portal-soporte` y la BD. No borrar releases ni secretos y no ejecutar comandos sobre servicios ajenos. Para volver de una actualización a este release, ajustar `WorkingDirectory`, `ExecStart` y permisos de escritura de las dos unidades al path versionado `c86af469bdb8f9d10a940ecce29d0e64110a1a57`, ejecutar `systemctl daemon-reload`, iniciar primero API y luego web, y verificar los healthchecks. No hay rollback de esquema necesario para esta instalación: no se ejecutaron migraciones.

Rollback de publicación, únicamente con autorización: retirar solo el registro DNS nuevo y la regla `soporte.consafedev.qzz.io` agregada al túnel `consafedev-root`, restaurar el archivo respaldado si la comparación de rutas confirma que no hubo cambios concurrentes y reiniciar solo `cloudflared-consafedev.service`. Si el archivo difiere del respaldo por cambios ajenos, detenerse y solicitar revisión. No restaurar túneles completos ni revertir hostnames preexistentes.

## 7. Registro de cambios externos

| Elemento | Estado en esta revisión | Evidencia / siguiente control |
|---|---|---|
| Servicios del Portal en Debian | Instalados en privado; ambos `active` y `enabled` | SHA de release `c86af469...`; listeners `127.0.0.1:18840/18841`; pruebas HTTP y login descritas arriba |
| PostgreSQL `portal_soporte` | Conectividad de runtime verificada; sin DDL/migraciones | Rol de runtime `portal_app`; esquema preexistente conservado |
| Rutas existentes `consafedev` y `renios` | Sin cambios | No se editó ni recargó configuración de cloudflared |
| Hostname `soporte.consafedev.qzz.io` | Sin DNS ni ruta | DNS devuelve NXDOMAIN; configuración candidata validada, pero la activa coincide con catch-all 404; aplicar solo tras cerrar puertas y recibir autorización |
| Otros túneles y hostnames | Sin cambios | `cloudflared-consafedev` y `cloudflared` confirmados activos; no se modificaron unidades ni configuraciones |
| Cloudflare Access | No configurado | Decisión aprobada: excluido |

## 8. Fuentes técnicas

- Cloudflare Tunnel, configuración local de ingress: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/
- Next.js, autohospedaje y proxy: https://nextjs.org/docs/app/guides/self-hosting
