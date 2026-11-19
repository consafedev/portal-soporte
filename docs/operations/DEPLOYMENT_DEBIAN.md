# Operación y despliegue — Debian + Cloudflare Tunnel

**Versión:** 0.3 · **Estado:** plan, NO ejecutado · **Revisado:** 2026-11-19.
**Alcance:** preparar la instalación del núcleo PS-003 en el Debian inventariado sin afectar otras aplicaciones, bases, túneles ni hostnames.

## 1. Decisiones de publicación

- Cloudflare se limita a DNS, proxy HTTPS y Cloudflare Tunnel. **Cloudflare Access queda excluido**; el login del portal es el único mecanismo de autenticación de usuarios.
- Se reutilizará exclusivamente el túnel existente `consafedev-root`, administrado por archivo local. No se creará ni modificará otro túnel.
- El origen público será `soporte.consafedev.qzz.io`, sujeto a disponibilidad de DNS/certificado y a una aprobación separada antes de publicarlo.
- No se requiere Nginx como proxy nuevo: Cloudflare Tunnel apuntará al servidor privado de Next.js. Next.js reenviará `/api/v1/*` al listener privado de Fastify mediante el rewrite same-origin existente.
- El API no tendrá una regla de túnel ni un listener público. PostgreSQL solo se usará desde el servidor mediante su dirección local, con validación TLS habilitada.

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

En la captura de listeners, `18840` y `18841` estaban libres; comprobarlos otra vez inmediatamente antes de iniciar servicios. PostgreSQL escucha en las interfaces existentes: esa exposición se mantiene como riesgo separado y no se cambia en este plan. No se identificó una tarea programada de respaldo PostgreSQL; la existencia de respaldo y una restauración de prueba siguen sin verificar.

La configuración actual inspeccionada de `consafedev-root` está en `/etc/cloudflared/config-consafedev.yml` y contiene, en este orden:

1. `consafedev.qzz.io` → `http://127.0.0.1:3002`
2. `renios.consafedev.qzz.io` → `http://127.0.0.1:18804`
3. catch-all → `http_status:404`

La validación de ingress actual pasó. `soporte.consafedev.qzz.io` no resolvía a DNS durante esa consulta y coincidía con el catch-all. El hostname debe revalidarse antes de cualquier publicación. El servidor también contiene otros túneles y aplicaciones activas que quedan fuera de alcance.

## 3. Servicios y configuración previstos

Esta sección describe recursos nuevos; **no han sido instalados ni iniciados**.

| Recurso futuro | Configuración propuesta | Límite de aislamiento |
|---|---|---|
| Usuario Linux `portal-soporte` | Cuenta de sistema sin shell interactivo ni grupos administrativos | Propietario de archivos de estado del Portal; no reutilizar usuarios existentes |
| Runtime | Node 24.22.3 en un prefijo propio bajo `/opt/portal-soporte/runtime/` | No cambiar runtime global, PATH global ni binarios de otras aplicaciones |
| Release | `/opt/portal-soporte/releases/<versión>` y symlink `current` | El despliegue escribe solo dentro de estas rutas nuevas |
| Web | `WEB_LISTEN_HOST=127.0.0.1`, `PORT=18840`, `NODE_ENV=production` | Listener de loopback al que se conecta únicamente el túnel local |
| API | `API_LISTEN_HOST=127.0.0.1`, `API_LISTEN_PORT=18841`, `NODE_ENV=production` | Listener de loopback; sin ingress Cloudflare propio |
| PostgreSQL | `portal_soporte`, `portal_app`, esquema `portal` | Solo tablas del Portal, DML mínimo revisado; nunca usar `portal_migrator` durante la operación normal |
| Configuración secreta | Archivos fuera de Git bajo `/etc/portal-soporte/`, accesibles por el gestor systemd y protegidos con permisos restrictivos | No colocar secretos en releases, unidades versionadas, argumentos, logs o repositorio |
| Estado/cache | Directorio nuevo bajo `/var/lib/portal-soporte/` | Escritura restringida a los datos que Next.js necesite en runtime |

Las unidades futuras serán separadas (`portal-soporte-api.service` y `portal-soporte-web.service`), con `User=portal-soporte`, `NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `UMask=0077`, reinicio solo del proceso que falla y límites de recursos. Las rutas de escritura se permitirán únicamente para estado/cache del Portal. Ninguna unidad nueva tendrá `PartOf=`, `BindsTo=` ni dependencias de parada sobre servicios ajenos.

Variables previstas, sin valores secretos:

- Web: `PUBLIC_APP_ORIGIN=https://soporte.consafedev.qzz.io`, `API_INTERNAL_ORIGIN=http://127.0.0.1:18841`, `WEB_LISTEN_HOST=127.0.0.1`, `PORT=18840`, `TRUSTED_EDGE_PROXY_CIDRS=127.0.0.1/32`.
- API: `PUBLIC_APP_ORIGIN=https://soporte.consafedev.qzz.io`, `API_INTERNAL_ORIGIN=http://127.0.0.1:18841`, `API_LISTEN_HOST=127.0.0.1`, `API_LISTEN_PORT=18841`, `TRUSTED_PROXY_CIDRS=127.0.0.1/32`, `DATABASE_URL` con `portal_app`, `AUTH_THROTTLE_HMAC_KEY` aleatoria y variables SMTP del proveedor autorizado.
- `DATABASE_SSL_CA` se configura solo si la verificación de confianza del certificado requiere una CA explícita. Nunca se deshabilitarán `rejectUnauthorized` ni la comprobación del nombre/IP.
- El orden de arranque será API, healthcheck de API sin datos sensibles, y luego web. El apagado o rollback detendrá solo las dos unidades del Portal.

Los parámetros de proxy confiable se limitarán a la IP loopback observada en sockets cuando el proxy de Cloudflare y Next.js conecten usando IPv4 `127.0.0.1`. Confirmar el peer observado antes de habilitarlos; cabeceras de proxy de cualquier otro peer se reemplazan por la dirección TCP observada. No usar `*`, redes amplias ni `trustProxy` indiscriminado.

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

## 5. Puertas pendientes antes de publicar

El inventario y las pruebas locales/remotas de PS-003 no equivalen a autorización para operación pública. Siguen pendientes:

1. MFA para cuentas `ADMIN` y revisión de seguridad que autorice exposición pública.
2. SMTP real con entrega y verificación de correo probadas; recuperación y activación no se consideran operativas hasta completar esa prueba.
3. Plan de backup de PostgreSQL, retención y restauración verificada.
4. Revisión del puerto 5432 expuesto por UFW y confirmación del alcance de `pg_hba.conf`, sin cambiarlo en este trabajo.
5. Confirmar confianza de CA/certificado PostgreSQL desde Node 24 sin degradar TLS.
6. Confirmar que las credenciales de aplicación/migración están almacenadas localmente fuera de Git, con permisos revisados, y que el bootstrap inicial ocurre por TTY segura.
7. Smoke tests con cuentas sintéticas: login, 403 de SUPPORT, cambio de contraseña, expiración y revocación de sesión, ausencia de contraseñas/tokens en API y logs.
8. Revalidar backups, espacio, memoria, runtime Node fijado y puertos justo antes de instalar servicios.

Mientras cualquiera de estas puertas siga abierta, no crear DNS, no añadir la ruta del túnel ni declarar el portal productivo. Si se autoriza una instalación privada previa a la publicación, deberá desplegarse sin tráfico externo y detenerse ante el primer preflight no coincidente.

## 6. Actualización y rollback aislados

La actualización futura utilizará un release nuevo e inmutable y cambiará únicamente el symlink `current` del Portal. Se valida el build y migraciones en `portal_soporte_test`; las migraciones productivas del esquema `portal` requieren revisión previa. Tras instalar, se prueba salud, login y revocación con una cuenta sintética controlada. No se ejecutan pruebas destructivas en `portal_soporte`.

Rollback de aplicación: detener solo `portal-soporte-web.service` y `portal-soporte-api.service`, volver `current` al release anterior, iniciar API y web en orden, comprobar salud. No borrar releases ni revertir migraciones de forma automática.

Rollback de publicación, únicamente con autorización: retirar solo el registro DNS nuevo y la regla `soporte.consafedev.qzz.io` agregada al túnel `consafedev-root`, restaurar el archivo respaldado si la comparación de rutas confirma que no hubo cambios concurrentes y reiniciar solo `cloudflared-consafedev.service`. Si el archivo difiere del respaldo por cambios ajenos, detenerse y solicitar revisión. No restaurar túneles completos ni revertir hostnames preexistentes.

## 7. Registro de cambios externos

| Elemento | Estado en esta revisión | Evidencia / siguiente control |
|---|---|---|
| Servicios del Portal en Debian | No creados | No hay usuario ni unidades `portal-soporte-*`; preparar para autorización separada |
| Rutas existentes `consafedev` y `renios` | Sin cambios | Inventario de configuración y validación `ingress validate` del 2026-11-19 |
| Hostname `soporte.consafedev.qzz.io` | Sin DNS ni ruta | En inventario coincide con 404; aplicar solo tras cerrar puertas y recibir autorización |
| Otros túneles y hostnames | Sin cambios | Excluidos de la modificación y del rollback |
| Cloudflare Access | No configurado | Decisión aprobada: excluido |

## 8. Fuentes técnicas

- Cloudflare Tunnel, configuración local de ingress: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/
- Next.js, autohospedaje y proxy: https://nextjs.org/docs/app/guides/self-hosting
