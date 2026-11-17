# SPEC-CORE — Portal de Soporte e-Billia

**Versión:** 0.2.0 · **Estado:** alcance funcional aprobado / validaciones técnicas pendientes · **Fecha:** 2026-11-17 · **Dependencias:** `AGENTS.md`, `ADR-0001_STACK.md`.

## 1. Resultado esperado

Aplicación web interna que autentica al personal, muestra un dashboard y permite operar únicamente los módulos y clientes autorizados. El administrador gestiona usuarios, activaciones y conexiones a MySQL/SSH sin distribuir secretos. El núcleo no contiene lógica específica de CFDI.

## 2. Rutas funcionales (propuesta)

| Ruta | Roles | Propósito |
|---|---|---|
| `/login` | público no autenticado | login; mensajes no enumerables |
| `/dashboard` | ADMIN, SUPPORT | bienvenida, módulos visibles, actividad propia, avisos |
| `/m/:moduleId` | según ACL | módulo registrado y habilitado |
| `/profile` | ADMIN, SUPPORT | avatar, contraseña, tema claro/oscuro/sistema |
| `/settings/users` | ADMIN | alta, edición, desactivación, revocación de sesiones y restablecimiento |
| `/settings/clients` | ADMIN | clientes y sus endpoints BD/SSH, entornos y estado |
| `/settings/modules` | ADMIN | catálogo, activación por roles y permisos |
| `/settings/audit` | ADMIN autorizado | bitácora de acciones, filtros y exportación redactada |

## 3. Identidad y seguridad

- Roles iniciales exactos: `ADMIN` y `SUPPORT`; usuarios individuales, nunca credenciales compartidas. Cuenta bootstrap de administrador creada de modo seguro, una sola vez, sin contraseña de ejemplo.
- Sesiones servidor-side con cookie `HttpOnly; Secure; SameSite=Lax/Strict` según flujo, expiración por inactividad/absoluta, rotación en login, CSRF según arquitectura, protección contra fuerza bruta, cierre y revocación de sesiones.
- Hash de contraseña Argon2id con parámetros revisados según hardware y OWASP; reset vía token de un solo uso con vencimiento o invitación temporal. Al reset revocar sesiones anteriores. No enviar contraseñas por correo ni mostrar secretos. MFA obligatorio para admins antes de producción (método por definir).
- Endpoints de administración con autorización en backend, validación de payload, revisión de alcance y auditoría. MFA/cambio de credenciales crítica puede requerir reautenticación.
- Política de permisos calculada como: `sesión válida && rol habilitado && módulo activo && usuario activo && acción permitida && cliente asignado && conexión permitida`. Sin permiso -> 403 y evento auditado; nunca recuperar credenciales para mostrarlas al navegador.
- Acceso de soporte al historial de sus propios trabajos sin permisos para leer el de otros salvo política explícita.

## 4. Usuarios y perfiles

`User`: `id`, `email`/`username` únicos, `displayName`, `passwordHash`, `role`, `status`, `avatarRef`, `themePreference`, `createdAt`, `updatedAt`, `lastLoginAt`, `passwordChangedAt`; se guardan invitaciones y reset tokens con expiración y hash. El admin puede crear, editar, desactivar y eliminar lógicamente usuarios, restablecer acceso y asignar clientes. No eliminar físicamente un usuario si rompería trazabilidad; desactivar y conservar registro de auditoría. Un SUPPORT puede cambiar su contraseña/avatar/tema, sin editar rol ni asignaciones.

## 5. Clientes y conexiones

`Client` representa una organización. Un cliente puede tener N `ConnectionProfile` con alias visible, `environment` (p.ej. producción/pruebas; **NO equivale** a `ambienteSap` de SAP), `connectionType`, `status`, `allowedModules`, `createdBy` y última fecha de test. Un módulo ve únicamente clientes con perfil compatible, módulo habilitado y asignación de usuario, nunca perfiles confidenciales.

**Perfiles MySQL compatibles objetivo:**

1. `MYSQL_TCP`: host/IP o hostname, puerto, base de datos/schema, usuario, contraseña, TLS (CA/client cert opcionales).
2. `MYSQL_URL`: URI con parsing controlado; no guardar/exportar cadena con password en texto visible; usar parámetros equivalentes al perfil TCP.
3. `MYSQL_SSH`: host SSH, puerto SSH, usuario SSH, auth password o llave privada, passphrase si aplica, fingerprint de host; host/puerto MySQL alcanzable **desde el servidor SSH**, base/schema y credenciales **MySQL distintas**. Mostrar estas dos secciones explícitamente.
4. `SSH_SERVER`: para futuros módulos de consulta de logs con acciones de solo lectura, rutas allowlist y sin shell arbitraria.

Llaves: permitir importación `.pem`, `.ppk` y OpenSSH cuando la librería SSH admita su algoritmo/formato; verificar mediante parsing seguro y conexión real de prueba. `.ppk` no se confunde con certificado TLS `.pem`: son usos distintos. Incluir soporte de passphrase y rotación. La compatibilidad con cada algoritmo y versión PPK debe establecerse en pruebas; si falla, señalar incompatibilidad explícita, no degradar seguridad ni declarar soporte universal.

Credenciales: cifrado autenticado en reposo con llave externa a la base y al repositorio, permisos Unix estrictos, política de backup cifrado, rotación, borrado lógico de perfiles y auditoría de acceso/desencriptado. En pantalla solo mostrar metadata redactada: alias, tipo, entorno, status, último test, fingerprint; **nunca** retornar privateKey, password ni URI completa. Usar confianza de host SSH con fingerprint validado; TLS verificado para MySQL cuando sea compatible y requerido. La existencia de un campo URL no implica conectividad a cualquier tecnología DB: el alcance inicial es **MySQL/MariaDB compatibles verificados**.

`ClientConnectionBroker`: crea conexiones efímeras o pools acotados por perfil, aplica timeouts y límites, cierra conexiones, verifica tipo y permiso, impide acceder a hosts fuera de allowlist administrativa e informa errores redactados. No compartir pools/estado entre clientes. Test de conexión exclusivamente admin, sin escritura ni cambios de esquema. Distinguir: fallo de DNS/red/SSH, llave/paráfrasis, auth MySQL, TLS, base desconocida, permisos insuficientes.

## 6. Módulos: contrato y activación

`ModuleManifest` tipado:

```ts
interface ModuleManifest {
  id: string; // p.ej. 'rf-1'; inmutable
  version: string;
  displayName: string; // 'Insertar facturas en BD'
  route: string;
  supportedConnectionTypes: Array<'MYSQL_TCP' | 'MYSQL_URL' | 'MYSQL_SSH' | 'SSH_SERVER'>;
  requiredCapabilities: string[];
  backendActions: string[];
  minimumCoreVersion: string;
  visibilityDefault: false;
  health: 'ready' | 'degraded' | 'disabled';
}
```

DB del portal: `modules`, `module_role_permissions`, `user_client_assignments`, `client_module_constraints` (si el negocio las requiere). Default OFF. Un admin habilita/deshabilita un módulo **ya desplegado** para ADMIN, SUPPORT o ambos, y la UI consulta el catálogo filtrado. El backend comprueba permisos en **cada** request; invalidar sesiones/claims/cache según corresponda sin esperar un redeploy. Registrar quién activó, cuándo y qué roles. Si el backend está ausente o fallando, el módulo no se ofrece operativo.

Nunca subir código ejecutable desde la UI; incorporación de código requiere PR, revisión, tests y despliegue. Módulos pueden desactivarse con trabajos en curso según política operativa explícita (cancelar nuevas solicitudes; concluir/abortar las existentes de forma segura y auditada).

## 7. UI/UX: sistema visual

Las etiquetas, validaciones y acciones tendrán mensajes claros en español; las funciones, componentes y servicios deberán documentarse conforme a `docs/standards/CLEAN_CODE.md`.

Inspiración Apple: claridad, jerarquía, tipografía del sistema, materiales discretos, bordes suaves y movimiento con propósito; **no** copiar activos de marca. Fondo claro blanco/gris suave; fondo oscuro negro/gris grafito; contraste AA mínimo. Sidebar desktop con avatar configurable, identificador/rol, tarjetas compactas de nombre de cada módulo autorizado, y al pie `Configuración` solo ADMIN y `Cerrar sesión` para todos; responsive mediante navegación accesible y panel plegable.

El dashboard muestra estado operativo, módulos y notificaciones pertinentes; diseño de carga con skeletons, empty states y errores útiles. Tema claro/oscuro/sistema persistido por usuario, también en login según preferencia local cuando no hay sesión. Preferencias `prefers-reduced-motion`, `prefers-reduced-transparency` cuando proceda, navegación completa por teclado, labels de inputs, focus visible, feedback inmediato sin animaciones decorativas excesivas.

## 8. Interfaces de servicio (orientativas)

- `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`, `POST /api/v1/auth/password`, `POST /api/v1/auth/reset/*`.
- `GET /api/v1/modules/available`, `PATCH /api/v1/admin/modules/:id/visibility`.
- `GET|POST /api/v1/admin/users`, `PATCH /api/v1/admin/users/:id`, `POST /api/v1/admin/users/:id/reset`.
- `GET|POST /api/v1/admin/clients`, `GET|POST|PATCH /api/v1/admin/clients/:id/connections`, `POST /api/v1/admin/connections/:id/test`.
- `GET|PATCH /api/v1/me/preferences`, `POST /api/v1/me/avatar`.

Todos los endpoints versionados, respuestas con código de error estable, `requestId` y sin errores internos sensibles. No usar `GET` para operaciones con efecto.

## 9. Auditoría y observabilidad

Registrar: `timestampUTC`, `actorId`, `role`, `clientId`, `connectionProfileId`, `moduleId`, `action`, `requestId`, `jobId`, `inputDigest` cuando aplique, `outcome`, `recordsAffected`, `verification`, `errorCategory` (redactado). Política de retención pendiente; integridad/backup de auditoría; métricas de latencia, errores, fallas de conexión, y registros indeterminados. Dashboard de operación no revela PII más allá del mínimo autorizado.

## 10. Pruebas de aceptación CORE

- `CORE-01` soporte no puede acceder a rutas/endpoints de configuración mediante URL/API directas (403).
- `CORE-02` activación por rol modifica navegación y autorización de API sin redeploy; acceso denegado luego de apagarlo.
- `CORE-03` perfiles de conexión no muestran contraseñas o llaves ni en respuestas JSON, HTML, logs o exportaciones.
- `CORE-04` admin puede crear/desactivar/restablecer usuarios, ver auditoría y revocar sesiones previas.
- `CORE-05` soporte puede cambiar contraseña, avatar y tema, pero no editar su rol.
- `CORE-06` test de conexión por perfil directo o SSH comunica errores precisos sin filtrar secretos.
- `CORE-07` clientes no asignados y conexiones incompatibles no aparecen ni son accesibles vía API.
- `CORE-08` teclado, tema claro/oscuro, responsive, foco y reduced-motion verificados.
- `CORE-09` logs de auditoría conservan trazabilidad tras rotar credenciales o desactivar usuario.
- `CORE-10` credenciales cifradas, política de bootstrap y backup/restauración verificados antes de producción.
