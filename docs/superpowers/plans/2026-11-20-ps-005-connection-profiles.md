# Plan de implementación PS-005.2 — perfiles y pruebas de conexión

**Fecha:** 2026-11-20 (America/Mexico_City) · **Base:** PS-005 y ADR-0002 aprobadas · **Rama:** `codex/ps-005-clients-connections`.

## Decisión de integración

Se ampliará la página existente de administración de clientes con un panel de perfiles por cliente. Se reutilizarán la API same-origin, CSRF y la autorización ADMIN del servidor. Es el menor cambio que mantiene contexto cliente y evita navegación redundante. La UI capturará secretos solo en alta o reemplazo y los limpiará al terminar. Se habilitarán sondeos únicamente cuando exista llavero y allowlist operacional; en esta iteración no se configurarán destinos/credenciales reales.

## Incrementos verificables

1. Separar la ejecución del conector de su auditoría y añadir unitarias de redacción, borrado de buffer, allowlist y propagación de fallos de auditoría.
2. Confirmar el contrato de credenciales: MySQL por usuario/clave; SSH por clave privada PEM y passphrase opcional, TLS validado y modo solo lectura. PPK permanecerá explícitamente fuera de soporte hasta probar fixture sintético compatible o implementar conversión segura.
3. Validar repositorio y migración aditiva `0006` con preflight, tablas, índices, restricciones, auditoría y privilegios en `portal_soporte_test` únicamente.
4. Añadir métodos API same-origin con CSRF y DTOs estrictos, y conectar el panel accesible a la administración de clientes existente.
5. Ejecutar unitarias, integración remota aislada, lint, formato, typecheck, build, E2E sintético, secreto/dependencias y revisión final del diff; registrar toda prueba no ejecutada como tal.

## Límites

No editar `0004/0005`, ni usar `portal_soporte`, servidores o credenciales de clientes, destinos MySQL/SSH reales, producción, DNS, Cloudflare o servicios systemd. No publicar ni fusionar. RF-1 queda fuera hasta que exista conector sintético aislado validado.
