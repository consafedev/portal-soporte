# DEPLOY-002 — Diseño de preparación segura para publicación

| Campo | Valor |
|---|---|
| Fecha | 2026-11-19 |
| Autoridad de alcance | Petición explícita del propietario DEPLOY-002 |
| Estado | Diseño de implementación para revisión; no habilita Cloudflare ni DNS |
| Base técnica | `main` merge `c86af469bdb8f9d10a940ecce29d0e64110a1a57` |

## Propósito

Preparar el portal interno para exposición HTTPS tras completar los controles de autenticación, proxy, cookies, respaldo y pruebas. El tráfico público solo se habilitará mediante una aprobación posterior del cambio exacto en `consafedev-root`.

## Objetivos

- Corregir la dependencia runtime directa de TypeBox en la API y producir un release reproducible.
- No implementar MFA para ADMIN ni SUPPORT por AP-013; mantener autenticación por usuario y contraseña y no presentar controles MFA incompletos. Preservar rate limits, sesiones opacas, CSRF, autorización efectiva y auditoría.
- Mantener el alta y restablecimiento bajo control de ADMIN sin SMTP, con contraseña temporal y cambio obligatorio al primer acceso; deshabilitar de forma visible y segura recuperación/cambio de correo basados en email.
- Ejecutar en producción con `PUBLIC_APP_ORIGIN` HTTPS, cookies Secure/HttpOnly/SameSite, proxy confiable mínimo, CSRF estricto, caché privada y errores redactados.
- Crear y restaurar un respaldo de la BD del Portal en un destino realmente aislado, con permisos y retención documentados.
- Preparar y validar un candidato de ingress que solo agregue `soporte.consafedev.qzz.io` hacia `127.0.0.1:18840`.

## Fuera de alcance

- Aplicar la ruta del túnel, crear/modificar DNS, firewall, Cloudflare Access o servicios compartidos.
- Acceder o escribir en bases de clientes, ejecutar operaciones reales de facturación, implementar PS-005 o RF-1.
- Enviar correos, simular entregas o persistir tokens de recuperación si no hay SMTP.
- Exponer Fastify/PostgreSQL en una interfaz pública.

## Enfoques y decisiones de implementación

1. **MFA:** no se implementará para ADMIN ni SUPPORT por decisión expresa AP-013. Las primitivas o tablas MFA existentes no se consideran controles activos ni se exponen por API/UI. El riesgo de un factor queda declarado y aceptado; solo una nueva decisión expresa del propietario podría reabrirlo.
2. **Alta/reset sin SMTP:** ADMIN captura una contraseña temporal fuerte; la API solo persiste Argon2id, obliga cambio propio al primer login y revoca sesiones en reset. La API nunca devuelve el password. El administrador lo comunica fuera del portal por un canal acordado. Correo permanece no verificado y no se usa como requisito de login. Recuperación, activación, verificación y cambio de correo se marcan deshabilitados hasta configurar SMTP.
3. **Origen y proxy:** se conserva el origen público canónico `https://soporte.consafedev.qzz.io`, la web como único ingress y el API solo loopback. Se confía únicamente en los peers observados de `cloudflared`→Next y Next→Fastify; las cabeceras no confiables se eliminan y no determinan Host, Origin o protocolo de seguridad.
4. **Respaldo:** `pg_dump` exclusivo del esquema/base del Portal en una ubicación con acceso restrictivo. La restauración se realiza en una instancia/base aislada, nunca reemplazando `portal_soporte` ni alterando bases preexistentes.
5. **Publicación:** Cloudflare se prepara como diff candidato de una sola regla, validado con el archivo real; la configuración activa no se escribe ni recarga sin autorización final.

## Migración y reversión

La migración de contraseña inicial se mantiene versionada en el esquema `portal`. Las estructuras de MFA preexistentes en la rama son inertes y no se usan en runtime; no se afirma que habiliten un segundo factor. Antes de aplicar cualquier migración a la base persistente, el plan ejecutará backup y restore aislado y verificará el esquema en `portal_soporte_test`. Nunca se ejecutará un down migration automático ni se truncarán datos. La base runtime continúa usando exclusivamente `portal_app`.

## Criterios de salida

- API/web en producción con listeners `127.0.0.1:18841/18840`, cookies y proxy verificados bajo HTTPS de prueba, y el mismo origen sirviendo `/api/v1/*`.
- ADMIN y SUPPORT inician sesión por usuario/contraseña con rate limit y sesión opaca; SUPPORT recibe 403 en operaciones exclusivas de ADMIN. MFA no forma parte del producto por AP-013.
- Alta/reset directo solo ADMIN, cambio inicial obligatorio, hash Argon2id, revocación y auditoría verificadas; sin SMTP no se crean tokens ni se informa entrega exitosa.
- Backup y restauración aislada con hash, permisos y retención reportados; sin tocar las bases ajenas.
- Servicios reiniciados solo por unidades Portal y recuperación de salud confirmada.
- El cambio Cloudflare queda como candidato revisable con las dos rutas existentes y catch-all intactos; no aplicado.

## Riesgos y límites

- Si no se puede crear un destino aislado para restore sin cambiar permisos compartidos, la restauración queda bloqueada y no se declara producción lista.
- ADMIN y SUPPORT no tienen MFA: queda aceptado el riesgo de autenticación de un solo factor. Argon2id, rate limits, CSRF, cookies seguras, auditoría y revocación siguen siendo obligatorios. MFA no está previsto; solo se reconsiderará ante una nueva decisión expresa.
- La contraseña temporal depende de comunicación fuera de banda; el portal no registra cuál fue el canal.
- `esbuild`, `picomatch`, falta de correo, retención de auditoría, política de backup y exposición/TLS de PostgreSQL continúan como riesgos hasta evidencia.
