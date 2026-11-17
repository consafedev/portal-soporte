# Operación y despliegue — Debian + Cloudflare Tunnel (sin Docker)

**Versión:** 0.2 · **Estado:** plan, NO ejecutado. **Restricción principal:** no afectar servicios, puertos, dominios, túneles ni bases existentes. El despliegue requiere aprobación y ventana controlada.

## 1. Diseño de publicación

```text
Navegador usuario (HTTPS)
  -> Cloudflare DNS + TLS + protección (Access recomendado adicional al login)
  -> Cloudflare Tunnel EXISTENTE si se puede reutilizar sin impacto
  -> servicio reverse-proxy en 127.0.0.1:PUERTO_NUEVO_LIBRE
       |-> Next.js en 127.0.0.1:PUERTO_WEB_LIBRE
       `-> Fastify en 127.0.0.1:PUERTO_API_LIBRE
                |-> PostgreSQL interno por socket/loopback
                `-> MySQL/SSH de clientes autorizados, solo desde backend
```

`soporte.consafedev.qzz.io` es un hostname **candidato**, no una DNS/ruta confirmada. Hay que comprobar control de zona DNS, facultad de crear el registro, publicación en túnel existente y cobertura TLS/certificado para subdominio multinivel. Según configuración de zona/certificados puede requerir configuración adicional o usar otro hostname propio. **No** crear túnel extra si el existente soporta una nueva aplicación sin impacto; si la zona no puede publicarlo, proponer dominio alternativo elegido por propietario.

Cloudflare Tunnel puede publicar varias reglas `hostname -> localhost:<port>` en un mismo túnel. No se deben cambiar reglas actuales ni el catch-all sin inventariar y respaldar configuración. Cloudflare Access para limitar el acceso por identidad es una protección adicional opcional; **no sustituye el RBAC de la app**.

## 2. Inventario read-only obligatorio en PS-001

En el Debian de destino, un operador autorizado debe capturar **salida redactada** (sin tokens, credenciales ni contenido de archivos secretos):

```bash
uname -a
cat /etc/debian_version
node --version || true
command -v cloudflared || true
command -v nginx || true
ss -ltnp
systemctl list-units --type=service --state=running --no-pager
systemctl list-unit-files 'cloudflared*' --no-pager
# Verificar configuración activa de túnel y DNS por vía autorizada,
# sin imprimir credentials-file, tokens ni secrets al worklog.
```

Registrar nombre exacto y modo de administración del túnel (local/dashboard), listeners activos y recursos disponibles. No asumir que `18804` (u otros) está libre: otras aplicaciones existentes pueden usar esos puertos. Elegir **tres puertos loopback libres tras inventario**; por ejemplo, `18920/18921/18922` son solamente ilustrativos y **NO reservas**. Prohibido desactivar servicios o reconfigurar túneles para liberar puertos.

## 3. Provisionamiento futuro (requiere aprobación)

- Crear cuenta Unix restringida `portal-soporte`, rutas de releases versionadas (`/opt/portal-soporte/releases/<version>` y symlink `current`) y directorios de datos secretos separados con permisos 0700/0600, sin cambios a servicios existentes.
- Instalar Node LTS fijado (24 LTS a la fecha de esta propuesta, actualizar revisión de seguridad) y PostgreSQL si no hay un servicio seguro disponible y el servidor tiene capacidad. Instalar dependencias sin contenedores, build reproducible desde lockfile; CI independiente.
- Migraciones **solo PostgreSQL interno** con backup previo. Cero migraciones automáticas a DBs clientes.
- Ejecutar `portal-soporte-web` y `portal-soporte-api` como servicios `systemd` separados, `User=portal-soporte`, restart policy y hardening (`NoNewPrivileges`, `ProtectSystem`, `PrivateTmp`, límites de FD/memoria). Secretos por credenciales `systemd` o almacén protegido, jamás hardcoded en unit files, env públicos o logs.
- Reverse proxy nuevo listener loopback; verificar headers, `X-Forwarded-Proto`, request size, rate limits, timeouts, política de cache `private/no-store` en sesiones y XML, websocket/stream si necesario. El frontend usa únicamente rutas proxied de la API autorizada; API no expuesta directamente.
- Agregar una regla de Cloudflare Tunnel **apuntando solo al puerto nuevo** y verificar match. Revisar DNS/hostname/certificados y Access antes de publicar. Mantener backup de configuración anterior y rollback probado.
- Cuentas MySQL por cliente con mínimo privilegio y prueba de conexiones desde servidor de aplicaciones. Verificar host keys SSH y TLS MySQL. Evitar abrir puertos de DB al Internet.

## 4. Puertas de seguridad previas a producción

1. Inventario read-only completado, sin colisión de recursos.
2. Cuenta administrador inicial, MFA, RBAC, cliente asignado y restablecimiento probados.
3. Secretos cifrados, rotación, backup/restore y permisos Unix probados.
4. Auditoría habilitada, pruebas de 403, XXE, input de logs, inyección SQL, subida masiva, concurrencia e interrupción SSH.
5. DDL/campos/índices/triggers verificados y prueba aislada de ambos estados completada. **La autorización funcional para insertar `PAGADA` ya está aprobada**; no repetir esta decisión de negocio.
6. Piloto con MySQL de pruebas y fixtures sintéticos, sin tocar datos productivos.
7. Plan de backup, restauración, retención, monitorización y rollback aprobado.
8. Prueba de salud `/health/live` y `/health/ready` (esta última no devuelve detalles sensibles), métricas y alertas.
9. Solo entonces habilitar `rf-1:execute` en producción para usuarios autorizados.

## 5. Rollback sin afectar vecinos

Mantener release anterior y backup interno, deshabilitar por flag el módulo (`rf-1` OFF) antes de rollback, detener **solo** servicios del portal, restaurar symlink/versiones/migraciones compatibles, validar salud, revertir exclusivamente la nueva ruta del túnel si corresponde. **No** revertir DNS, túneles o Postgres existentes ajenos. Las escrituras ya completadas en bases clientes no se revierten por desplegar versión anterior; cualquier reversión de datos requiere un procedimiento aparte y aprobación. En incertidumbre, bloquear escrituras, preservar evidencia y escalar.

## 6. Fuentes oficiales

- Cloudflare múltiples hostnames y reglas: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/
- Cloudflare Access self-hosted: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- Next.js reverse proxy y autohospedaje: https://nextjs.org/docs/app/guides/self-hosting
