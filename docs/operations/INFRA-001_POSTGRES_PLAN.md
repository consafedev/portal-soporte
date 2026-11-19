# INFRA-001 — Inventario y plan de aprovisionamiento PostgreSQL

**Estado:** `BLOQUEADO`; inventario, aprovisionamiento autorizado y validación de la base de pruebas completados; falta resolver la compatibilidad del migrador para la base permanente
**Alcance:** crear exclusivamente dos bases y cuatro roles nuevos para el Portal de Soporte e-Billia. No modificar bases, roles, permisos, servicios, Debian, SSH, firewall, Cloudflare ni configuración global existentes.

**Decisión de permisos del propietario (2026-11-18):** conservar intactas todas las bases existentes y preparar las nuevas para que las aplicaciones del Portal lean y escriban mediante los roles propios `portal_app` y `portal_test_app`. En las bases nuevas se mantiene el patrón general observado de `PUBLIC CONNECT` y `TEMPORARY`; los datos del Portal permanecen en `portal` y reciben grants DML explícitos para el rol de ejecución correspondiente. No conceder DML a `PUBLIC` ni crear tablas de autenticación en `public`.

## Actualización de ejecución — 2026-11-19

- La identidad confirmada sigue siendo Debian 12 / PostgreSQL 15.20, clúster `15/main`, puerto interno 5432, a través del forward SSH local `127.0.0.1:15432` con verificación estricta del host. La identidad de la base permanente y la de prueba coinciden en versión, dirección local y hora de inicio del proceso PostgreSQL.
- Se crearon exclusivamente las bases nuevas `portal_soporte`, `portal_soporte_test` y los roles nuevos `portal_app`, `portal_migrator`, `portal_test_app`, `portal_test_migrator`. El archivo local `.env.infra-001.local` contiene las cuatro credenciales generadas y está ignorado por Git; no se documentan valores ni DSN.
- La base de pruebas usa `portal`; las cuatro migraciones Drizzle están aplicadas, los grants DML de `portal_test_app` se limitaron a las tablas enumeradas y el arnés confirmó la base de pruebas limpia tras integración/E2E. La base permanente conserva los esquemas vacíos `portal` y `public`, sin tablas, secuencias ni rutinas de usuario.
- La migración permanente se intentó únicamente después de aprobar pruebas y ejecutar un preflight de solo lectura. La CLI Drizzle 0.45.4 siempre ejecuta `CREATE SCHEMA IF NOT EXISTS portal` antes del ledger. El rol `portal_migrator` es dueño de `portal` y puede crear objetos dentro del esquema, pero no tiene privilegio PostgreSQL `CREATE` sobre la base; el servidor rechazó el primer paso con SQLSTATE `42501`. El inventario read-only posterior devolvió cero relaciones de usuario y estado `vacio`; no quedó migración ni permiso persistente aplicado.
- **Decisión pendiente del propietario:** autorizar una concesión temporal y exclusiva `GRANT CREATE ON DATABASE portal_soporte TO portal_migrator`, ejecutar las migraciones versionadas y revocarla inmediatamente; o mantener ACL actuales y autorizar una adaptación revisada del runner que omita la creación redundante del esquema existente. Ninguna alternativa se ejecuta sin aprobación. `CREATEDB` seguiría siendo falso en ambos casos.
- No se alteraron bases, roles, permisos, tablas, esquemas o servicios preexistentes; tampoco ACL `PUBLIC`, PostgreSQL global, firewall, SSH o Cloudflare. No hubo acceso a datos de aplicaciones ajenas ni a MySQL de clientes.
- Riesgos vigentes del host: las reglas UFW permiten 5432 desde `Anywhere` aunque `pg_hba.conf` limita los peers a loopback y red privada; el alcance de respaldos PostgreSQL no se verificó. No se cambiarán globales como parte de esta tarea.

## Evidencia disponible y límites

- El propietario indicó que el túnel SSH ya está abierto. Se observó el listener local `127.0.0.1:15432` perteneciente a `ssh.exe`, con reenvío local hacia `127.0.0.1:5432` en `daniel@10.18.170.44`. No se creó ni modificó el túnel.
- La clave de host ED25519 local coincide con la huella SHA256:kJFGr6h9jFCslHQC2Ej7Mc4/NTf2AEKTCFgLkaaJ7a0.
- El propietario confirmó por un canal independiente que 10.18.170.44 y esa huella identifican el servidor aprobado para el Portal.
- La inspección local read-only de los almacenes efectivos encontró tres tipos de clave asociados al host (ED25519, RSA y ECDSA); solo ED25519 está confirmado. El verificador fail-closed rechaza el conjunto porque no se puede demostrar cuál autenticó el túnel ya abierto. El túnel no se alteró.
- La sesión autenticada de inventario confirmó Debian GNU/Linux 12 (bookworm), PostgreSQL 15.20, clúster `15/main` en el puerto 5432, directorio `/var/lib/postgresql/15/main` e identificador de sistema `7589844144764889360`. La huella ED25519 fue confirmada de forma independiente por el propietario; no se desactivó la comprobación de host.
- La instancia responde por socket Unix en el servidor. La inspección local previa confirmó que el túnel sigue ligado exclusivamente a `127.0.0.1:15432`; no se creó ni modificó.
- El listener PostgreSQL aparece ligado a `0.0.0.0:5432` y `[::]:5432`. UFW está activo con política entrante por defecto `deny`; existen dos reglas `ALLOW` de 5432 con origen `Anywhere` (IPv4/IPv6). El servidor tiene una dirección global IPv6. `nftables` y `firewalld` aparecen inactivos.
- La lectura agregada de `pg_hba_file_rules` terminó sin errores: cinco reglas host, cero reglas con origen wildcard, dos reglas loopback IPv4, dos loopback IPv6 y una regla de red privada `10.*`. Las cinco usan autenticación por contraseña (`md5`/`scram-sha-256`); no hay reglas `trust`, ni reglas host para IPv6 no loopback o para IPv4 público. Por tanto, aunque UFW permite el puerto desde `Anywhere`, HBA limita el acceso PostgreSQL a loopback y una red privada. La escucha pública/UFW abierto queda como riesgo pendiente de infraestructura; no se cambia firewall ni configuración global.
- No hay colisiones: conteo de bases `portal_soporte`/`portal_soporte_test` = 0; `pg_roles` no devolvió ninguno de los cuatro nombres reservados.
- En las cinco bases preexistentes conectables se contaron cinco grants PUBLIC `CONNECT`, cinco `TEMPORARY` y cero `CREATE`. En cada base, una segunda consulta confirmó exactamente un grant de esquema `public` para `PUBLIC` con `USAGE`, cero con `CREATE`, cero grants DML en tablas/vistas, cero grants sobre secuencias y cero grants `EXECUTE` sobre rutinas `SECURITY DEFINER`. No se leyeron filas de aplicación.
- Capacidad observada: 15 GiB de memoria total y 13 GiB disponibles; 186 GiB libres en `/` y `/var/lib/postgresql`. En los timers revisados solo apareció `dpkg-db-backup.timer`; la configuración completa de respaldos PostgreSQL no está verificada.
- La revisión del propietario aclara que no desea cambios a las bases actuales y que las nuevas deben permitir lectura/escritura a las aplicaciones del Portal. No se modificarán ACL existentes; los roles de ejecución recibirán permisos explícitos y acotados dentro de `portal`.
- La conexión SSH directa se realizó desde un PTY no visible con `StrictHostKeyChecking=yes` y el pin ED25519 local; la contraseña no se repitió en documentación ni se guardó en archivos. Las consultas y comandos de inventario se limitaron a lectura.
- **Historial al corte previo del 2026-11-18:** no se había ejecutado SQL de escritura ni creado roles/bases; PostgreSQL real, `test:migrate-cli` remoto y E2E remotos estaban `NO EJECUTADO`. La actualización de ejecución del 2026-11-19 arriba reemplaza ese estado histórico.
- Drizzle y ORM ahora cualifican tablas y ledger bajo `portal`; migrador real Drizzle y cuatro migraciones pasan en PGlite. La suite PostgreSQL real tras el cambio no se pudo iniciar localmente porque faltan `initdb.exe` y `pg_ctl.exe`.
- El harness local ahora crea un clúster efímero solo cuando no recibe un DSN. Las URLs directas locales se rechazan; el modo remoto exige opt-in explícito, roles y base exactos, el túnel fijado y un estado de esquema vacío o ya migrado sin datos. Sus procesos limitan workers, pool, consultas, bloqueos y tiempos.

## Precondiciones de inventario y aislamiento

1. Confirmar por un canal independiente el fingerprint SSH esperado y que `10.18.170.44` es el activo previsto para el Portal.
2. Obtener un canal local seguro de autenticación SSH/administración que no incluya secretos en argumentos, historial, logs o Git. La autorización de crear los seis recursos ya fue otorgada; no pedirla de nuevo. No usar bases productivas ni datos de clientes.
3. Confirmar que el forward activo está ligado solo a `127.0.0.1:15432` y llega a la misma instancia identificada por SSH.
4. Consultar distribución, versiones, clústeres/listeners, capacidad, respaldos, bases/roles, grants y migraciones sin leer ni exportar contenido de aplicaciones ajenas. Completar el chequeo de HBA y clasificar, de forma agregada y sin imprimir orígenes, las reglas efectivas UFW/nftables de 5432. Resumir resultados sin nombres ajenos ni datos personales.
5. Confirmar que `portal_soporte`, `portal_soporte_test`, `portal_app`, `portal_migrator`, `portal_test_app` y `portal_test_migrator` no existen. Si existe cualquiera, detenerse y revisar propiedad/permisos; no adoptar ni modificar recursos preexistentes.
6. Mantener intactos permisos y objetos preexistentes. La aceptación del patrón PUBLIC significa `CONNECT`/`TEMPORARY` general como el de las otras bases; no significa acceso PUBLIC a filas. Antes de habilitar LOGIN, confirmar que los roles Portal carecen de membresías y de privilegios efectivos sobre tablas/secuencias/funciones `SECURITY DEFINER` de aplicaciones ajenas. Si aparece algún permiso efectivo o no puede descartarse, detenerse sin cambiar ACL existentes.
7. Confirmar que la versión del servidor admite el DDL y las funciones usadas por Drizzle. Verificar que la cuenta administrativa existente puede crear roles/bases y asignar la propiedad del esquema sin añadir membresías ni privilegios a otras cuentas; si no, detenerse. No aplicar migraciones hasta satisfacer estas condiciones y la verificación de alcance de red.

### Consultas read-only para el inventario de ACL `PUBLIC`

La primera consulta devuelve solo conteos de bases existentes con `CONNECT` para `PUBLIC`; no revela nombres. La segunda debe ejecutarse en cada base conectable, también sin leer filas de aplicación:

```sql
SELECT count(*) AS bases_existentes_con_connect_public
FROM pg_database AS db
CROSS JOIN LATERAL aclexplode(
  COALESCE(db.datacl, acldefault('d', db.datdba))
) AS acl
WHERE NOT db.datistemplate
  AND db.datallowconn
  AND db.datname NOT IN ('portal_soporte', 'portal_soporte_test')
  AND acl.grantee = 0
  AND acl.privilege_type = 'CONNECT';
```

```sql
WITH grants_esquema AS (
  SELECT esquema.nspname, acl.privilege_type
  FROM pg_namespace AS esquema
  CROSS JOIN LATERAL aclexplode(
    COALESCE(esquema.nspacl, acldefault('n', esquema.nspowner))
  ) AS acl
  WHERE esquema.nspname !~ '^pg_'
    AND esquema.nspname <> 'information_schema'
    AND acl.grantee = 0
), grants_tabla AS (
  SELECT clase.oid, acl.privilege_type
  FROM pg_class AS clase
  JOIN pg_namespace AS esquema ON esquema.oid = clase.relnamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(clase.relacl, acldefault('r', clase.relowner))
  ) AS acl
  WHERE esquema.nspname !~ '^pg_'
    AND esquema.nspname <> 'information_schema'
    AND clase.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND acl.grantee = 0
), grants_secuencia AS (
  SELECT secuencia.oid, acl.privilege_type
  FROM pg_class AS secuencia
  JOIN pg_namespace AS esquema ON esquema.oid = secuencia.relnamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(secuencia.relacl, acldefault('s', secuencia.relowner))
  ) AS acl
  WHERE esquema.nspname !~ '^pg_'
    AND esquema.nspname <> 'information_schema'
    AND secuencia.relkind = 'S'
    AND acl.grantee = 0
), grants_rutina AS (
  SELECT rutina.prosecdef, acl.privilege_type
  FROM pg_proc AS rutina
  JOIN pg_namespace AS esquema ON esquema.oid = rutina.pronamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(rutina.proacl, acldefault('f', rutina.proowner))
  ) AS acl
  WHERE esquema.nspname !~ '^pg_'
    AND esquema.nspname <> 'information_schema'
    AND acl.grantee = 0
), grants_objeto_grande AS (
  SELECT acl.privilege_type
  FROM pg_largeobject_metadata AS objeto
  CROSS JOIN LATERAL aclexplode(
    COALESCE(objeto.lomacl, acldefault('L', objeto.lomowner))
  ) AS acl
  WHERE acl.grantee = 0
)
SELECT (SELECT count(*) FROM grants_esquema
         WHERE privilege_type IN ('USAGE', 'CREATE')) AS esquemas_accesibles_por_public,
       (SELECT count(*) FROM grants_tabla
         WHERE privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) AS tablas_con_dml_public,
       (SELECT count(*) FROM grants_secuencia
         WHERE privilege_type IN ('USAGE', 'SELECT', 'UPDATE')) AS secuencias_accesibles_por_public,
       (SELECT count(*) FROM grants_rutina
         WHERE privilege_type = 'EXECUTE') AS rutinas_ejecutables_por_public,
       (SELECT count(*) FROM grants_rutina
         WHERE privilege_type = 'EXECUTE' AND prosecdef) AS rutinas_definer_ejecutables_por_public,
       (SELECT count(*) FROM grants_objeto_grande
         WHERE privilege_type IN ('SELECT', 'UPDATE')) AS objetos_grandes_accesibles_por_public;
```

Después de crear los roles `NOLOGIN`, pero antes de habilitar LOGIN, usar la consulta siguiente en cada base existente para obtener solo conteos de objetos a los que las nuevas cuentas tendrían permisos efectivos. No devuelve nombres ni contenido de tablas:

```sql
SELECT
  (SELECT count(*)
   FROM pg_namespace AS esquema
   WHERE esquema.nspname !~ '^pg_'
     AND esquema.nspname <> 'information_schema'
     AND (
       has_schema_privilege('portal_app', esquema.oid, 'CREATE')
       OR has_schema_privilege('portal_test_app', esquema.oid, 'CREATE')
     )) AS esquemas_ajenos_creables,
  (SELECT count(*)
   FROM pg_namespace AS esquema
   WHERE esquema.nspname !~ '^pg_'
     AND esquema.nspname <> 'information_schema'
     AND (
       has_schema_privilege('portal_app', esquema.oid, 'USAGE')
       OR has_schema_privilege('portal_test_app', esquema.oid, 'USAGE')
     )) AS esquemas_ajenos_usables,
  (SELECT count(*)
   FROM pg_class AS relacion
   JOIN pg_namespace AS esquema ON esquema.oid = relacion.relnamespace
   WHERE esquema.nspname !~ '^pg_'
     AND esquema.nspname <> 'information_schema'
     AND relacion.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND (has_table_privilege('portal_app', relacion.oid, 'SELECT')
       OR has_table_privilege('portal_app', relacion.oid, 'INSERT')
       OR has_table_privilege('portal_app', relacion.oid, 'UPDATE')
       OR has_table_privilege('portal_app', relacion.oid, 'DELETE')
       OR has_table_privilege('portal_test_app', relacion.oid, 'SELECT')
       OR has_table_privilege('portal_test_app', relacion.oid, 'INSERT')
       OR has_table_privilege('portal_test_app', relacion.oid, 'UPDATE')
       OR has_table_privilege('portal_test_app', relacion.oid, 'DELETE'))) AS tablas_accesibles,
  (SELECT count(*)
   FROM pg_proc AS rutina
   JOIN pg_namespace AS esquema ON esquema.oid = rutina.pronamespace
   WHERE esquema.nspname !~ '^pg_'
     AND esquema.nspname <> 'information_schema'
     AND (has_function_privilege('portal_app', rutina.oid, 'EXECUTE')
       OR has_function_privilege('portal_test_app', rutina.oid, 'EXECUTE'))) AS rutinas_ejecutables,
  (SELECT count(*)
   FROM pg_proc AS rutina
   JOIN pg_namespace AS esquema ON esquema.oid = rutina.pronamespace
   WHERE esquema.nspname !~ '^pg_'
     AND esquema.nspname <> 'information_schema'
     AND rutina.prosecdef
     AND (has_function_privilege('portal_app', rutina.oid, 'EXECUTE')
       OR has_function_privilege('portal_test_app', rutina.oid, 'EXECUTE'))) AS rutinas_definer_accesibles,
  (SELECT count(*)
   FROM pg_class AS secuencia
   JOIN pg_namespace AS esquema ON esquema.oid = secuencia.relnamespace
   WHERE esquema.nspname !~ '^pg_'
     AND esquema.nspname <> 'information_schema'
     AND secuencia.relkind = 'S'
     AND (has_sequence_privilege('portal_app', secuencia.oid, 'USAGE')
       OR has_sequence_privilege('portal_app', secuencia.oid, 'SELECT')
       OR has_sequence_privilege('portal_app', secuencia.oid, 'UPDATE')
       OR has_sequence_privilege('portal_test_app', secuencia.oid, 'USAGE')
       OR has_sequence_privilege('portal_test_app', secuencia.oid, 'SELECT')
       OR has_sequence_privilege('portal_test_app', secuencia.oid, 'UPDATE'))) AS secuencias_accesibles,
  (SELECT count(*)
   FROM pg_largeobject_metadata AS objeto
   CROSS JOIN LATERAL aclexplode(
     COALESCE(objeto.lomacl, acldefault('L', objeto.lomowner))
   ) AS acl
   WHERE (acl.grantee = 0 OR acl.grantee IN (
     (SELECT oid FROM pg_roles WHERE rolname = 'portal_app'),
     (SELECT oid FROM pg_roles WHERE rolname = 'portal_test_app')
   )) AND acl.privilege_type IN ('SELECT', 'UPDATE')) AS objetos_grandes_accesibles;
```

Si el conteo agregado de CONNECT de PUBLIC es mayor que cero para una base preexistente, las cuentas nuevas heredarían ese permiso. Como esta tarea prohíbe alterar ACL preexistentes, se bloquea la creación en el clúster compartido y se requiere un clúster dedicado o autorización separada para cambiar esas ACL. PostgreSQL concede CONNECT y TEMPORARY a PUBLIC por defecto en bases, pero la consulta debe confirmar el estado real. Si la consulta de objetos arroja esquemas ajenos creables, tablas/secuencias/objetos grandes accesibles, o PUBLIC puede ejecutar funciones SECURITY DEFINER cuyo efecto no pueda descartarse, también se detiene el plan. Los permisos USAGE sobre esquemas ajenos se revisan junto con sus objetos efectivos; cualquier acceso o incertidumbre bloquea. Esta auditoría no autoriza revocar permisos en bases preexistentes.

## Recursos exactos propuestos

| Base | Esquema | Rol de ejecución | Rol migrador |
|---|---|---|---|
| `portal_soporte` | `portal` | `portal_app` | `portal_migrator` |
| `portal_soporte_test` | `portal` | `portal_test_app` | `portal_test_migrator` |

Los cuatro roles tendrán credenciales distintas y LOGIN solo después de asignar las contraseñas por un canal seguro. Ninguno recibe SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS o membresías. Los roles de aplicación no son propietarios, no reciben CREATE y solo acceden al esquema `portal`. `portal_app` y `portal_test_app` reciben los permisos por tabla que requiere el código; `audit_events` es de solo inserción y el ledger Drizzle queda sin acceso. Todas las claves primarias actuales son UUID/texto y no hay secuencias que necesiten privilegios de aplicación. `portal_migrator` será dueño solo del esquema `portal` en la base permanente y no tendrá CREATE sobre la base. `portal_test_migrator` recibe CREATE limitado a la base de pruebas para los esquemas temporales aleatorios de las pruebas de migración. Ningún rol es dueño de las bases ni del esquema `public`. Límites propuestos: 10 conexiones para `portal_app`, 2 para cada migrador y 8 para `portal_test_app`.

## Plan SQL aprobado — autorización de ejecución otorgada el 2026-11-18

Se ejecutaría con una cuenta administrativa existente mediante `psql`, una vez completados inventario y revisión. `CREATE DATABASE` se ejecuta fuera de transacción por requisito de PostgreSQL. El bloque de precondiciones evita colisiones; si un recurso existe, falla sin modificarlo.

### 1. Verificar endpoint y ausencia de nombres reservados; crear cuatro roles

```sql
\set ON_ERROR_STOP on
SELECT current_database() AS base_actual,
       current_user AS rol_actual,
       inet_server_addr() AS direccion_servidor,
       inet_server_port() AS puerto_servidor,
       current_setting('server_version_num') AS version_servidor,
       (SELECT system_identifier::text FROM pg_control_system()) AS identificador_sistema;

BEGIN;
DO $verificar$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN (
      'portal_app', 'portal_migrator',
      'portal_test_app', 'portal_test_migrator'
    )
  ) THEN
    RAISE EXCEPTION 'Ya existe un rol reservado al Portal; detener y revisar';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_database
    WHERE datname IN ('portal_soporte', 'portal_soporte_test')
  ) THEN
    RAISE EXCEPTION 'Ya existe una base reservada al Portal; detener y revisar';
  END IF;
END
$verificar$;

CREATE ROLE portal_app
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE portal_migrator
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE portal_test_app
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE portal_test_migrator
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
COMMIT;
```

### 2. Crear las dos bases nuevas

```sql
CREATE DATABASE portal_soporte
  TEMPLATE template0 ENCODING 'UTF8';
CREATE DATABASE portal_soporte_test
  TEMPLATE template0 ENCODING 'UTF8';
```

Al omitir `OWNER`, cada base nueva queda inicialmente bajo la cuenta administrativa que ejecuta `CREATE DATABASE`. Esa propiedad se conserva para mantenimiento/reversión puntuales; no se transfiere a ningún rol de aplicación o migración.

Verificar por separado `current_database()`, `current_user`, dirección/puerto y versión al conectar a cada destino. Si el endpoint o nombre no coincide, desconectar y detenerse.

Si la creación de cualquiera de las bases falla, detenerse y revisar manualmente los objetos parciales; no ejecutar un rollback automático por nombre. Registrar la constancia únicamente después de que ambas bases y los esquemas portal hayan sido creados y sus propietarios verificados.

```sql
SELECT current_setting('server_version_num') AS version_servidor,
       pg_postmaster_start_time() AS inicio_servidor,
       db.datname,
       db.oid AS oid_base,
       db.datdba AS oid_propietario_base,
       propietario.rolname AS propietario_base,
       esquema.oid AS oid_esquema_portal,
       esquema.nspowner AS oid_propietario_esquema,
       portal.rolname AS propietario_esquema,
       app.oid AS oid_rol_app,
       migrador.oid AS oid_rol_migrador
FROM pg_database AS db
JOIN pg_roles AS propietario ON propietario.oid = db.datdba
JOIN pg_namespace AS esquema ON esquema.nspname = 'portal'
JOIN pg_roles AS portal ON portal.oid = esquema.nspowner
JOIN pg_roles AS app ON app.rolname = CASE db.datname
  WHEN 'portal_soporte' THEN 'portal_app'
  ELSE 'portal_test_app'
END
JOIN pg_roles AS migrador ON migrador.rolname = CASE db.datname
  WHEN 'portal_soporte' THEN 'portal_migrator'
  ELSE 'portal_test_migrator'
END
WHERE db.datname = current_database()
  AND db.datname IN ('portal_soporte', 'portal_soporte_test');
```

Después de completar la etapa 3, ejecutar esta consulta una vez conectado a portal_soporte y otra vez conectado a portal_soporte_test. Cada ejecución devuelve una fila; reunir ambas en una constancia local de exactamente dos filas. Guardarla con ACL restringida fuera de Git, sin contraseña, DSN, token o dato de otra aplicación.

### 3. Mantener el modelo PUBLIC general y crear el esquema `portal`

Conectar a cada base nueva y comprobar otra vez nombre, propietario, OID, sistema e inicio de servidor antes de ejecutar. El bloque modifica únicamente la base nombrada. El modelo general replica el observado en las bases existentes: `PUBLIC` puede conectar y crear tablas temporales; `PUBLIC` no recibe `CREATE` de base ni del esquema `public`, ni grants de datos. El código del portal no crea tablas en `public`.

```sql
BEGIN;
GRANT CONNECT, TEMPORARY ON DATABASE portal_soporte TO PUBLIC;
REVOKE CREATE ON DATABASE portal_soporte FROM PUBLIC;
GRANT CONNECT ON DATABASE portal_soporte TO portal_app, portal_migrator;
GRANT USAGE ON SCHEMA public TO PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA portal AUTHORIZATION portal_migrator;
GRANT USAGE ON SCHEMA portal TO portal_app;
REVOKE ALL ON SCHEMA portal FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE portal_migrator IN SCHEMA portal
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE portal_migrator IN SCHEMA portal
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE portal_migrator IN SCHEMA portal
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
```

Para la base de pruebas, usar exactamente:

```sql
BEGIN;
GRANT CONNECT, TEMPORARY ON DATABASE portal_soporte_test TO PUBLIC;
REVOKE CREATE ON DATABASE portal_soporte_test FROM PUBLIC;
GRANT CONNECT ON DATABASE portal_soporte_test TO portal_test_app, portal_test_migrator;
GRANT CREATE ON DATABASE portal_soporte_test TO portal_test_migrator;
GRANT USAGE ON SCHEMA public TO PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA portal AUTHORIZATION portal_test_migrator;
GRANT USAGE ON SCHEMA portal TO portal_test_app;
REVOKE ALL ON SCHEMA portal FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE portal_test_migrator IN SCHEMA portal
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE portal_test_migrator IN SCHEMA portal
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE portal_test_migrator IN SCHEMA portal
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
```

Los `GRANT`/`REVOKE` de PUBLIC son exclusivamente sobre las dos bases nuevas y no alteran ACL de bases existentes. En `portal`, las migraciones revocan los grants por defecto de tablas, secuencias y rutinas a PUBLIC; los roles de aplicación no heredan permisos públicos de datos. En la base permanente, `portal_migrator` crea objetos solo dentro del esquema `portal` que posee. En la base de pruebas, `portal_test_migrator` necesita CREATE local de base para crear los esquemas temporales aleatorios de las pruebas de migración; este permiso no concede CREATEDB ni afecta otras bases. Ningún rol de ejecución recibe privilegios de creación.

Mantener los roles `NOLOGIN` durante la creación y restricción de ambas bases. Esto evita que las cuentas recién creadas se conecten mientras se revisan ACL. Tras completar esta etapa, asignar cuatro secretos distintos mediante estos prompts de `psql`, que no muestran el valor introducido. No escribir valores de contraseña en comandos, argv, historial, archivos del repositorio, logs o bitácora:

```text
\\password portal_app
\\password portal_migrator
\\password portal_test_app
\\password portal_test_migrator
```

Después, habilitar LOGIN con los límites indicados:

```sql
ALTER ROLE portal_app LOGIN CONNECTION LIMIT 10;
ALTER ROLE portal_migrator LOGIN CONNECTION LIMIT 2;
ALTER ROLE portal_test_app LOGIN CONNECTION LIMIT 8;
ALTER ROLE portal_test_migrator LOGIN CONNECTION LIMIT 2;
```

Generar cuatro credenciales criptográficamente aleatorias, distintas, y almacenarlas solo en `.env.infra-001.local` con ACL de usuario restringida, ignorado por Git. El propietario podrá abrir y respaldar ese archivo solo localmente; nunca imprimir su contenido ni compartirlo. No guardar la contraseña SSH/sudo en ese archivo. Los cuatro DSN serán distintos y se mantendrán fuera del API, salvo el DSN del rol de ejecución que corresponda.

### 4. Aplicar migraciones y otorgar DML de las tablas de aplicación

Solo después de aprobar la fase de infraestructura, revisar el destino vacío, confirmar identidad y ejecutar únicamente las migraciones versionadas del Portal en la base correspondiente. Tras migrar cada base, ejecutar el bloque correspondiente dentro de ella:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  portal.auth_throttle_windows
TO portal_app;
GRANT SELECT, INSERT, UPDATE ON TABLE
  portal.users,
  portal.sessions,
  portal.recovery_tokens
TO portal_app;
GRANT INSERT ON TABLE portal.audit_events TO portal_app;
GRANT SELECT, UPDATE ON TABLE portal.auth_invariants TO portal_app;
REVOKE ALL ON TABLE portal.__drizzle_migrations FROM portal_app;
```

En `portal_soporte_test`, sustituir `portal_app` por `portal_test_app`. Estos permisos permiten al API consultar/crear/modificar cuentas, sesiones y tokens; eliminar ventanas de throttling caducadas; insertar eventos de auditoría sin alterarlos; y bloquear la fila invariante de administradores con `SELECT ... FOR UPDATE`. No hay DELETE de usuarios/sesiones/tokens, ni UPDATE/DELETE de auditoría. No conceder acceso al ledger, a tablas futuras, secuencias o a objetos de otros esquemas. Cada tabla nueva requiere revisión explícita de permisos.

## Verificación de permisos y no interferencia

Antes de crear recursos, conservar solo resultados agregados de inventario. Después, limitar verificaciones al catálogo/ACL, tablas y roles del Portal:

- Confirmar en `pg_roles` que los cuatro flags administrativos son falsos, los roles no tienen membresías y sus límites de conexión coinciden con el plan.
- En cada base Portal, confirmar `PUBLIC CONNECT`/`TEMPORARY` y `public USAGE` sin `CREATE`, y que no hay DML PUBLIC sobre tablas/secuencias de `portal`. Confirmar que `portal` pertenece al migrador, el rol app solo tiene `USAGE` en `portal` y los grants por tabla listados; no tiene CREATE, permisos de ledger, ni privilegios sobre objetos de otros esquemas.
- Verificar el ledger y las seis tablas dentro de `portal`, sin tablas de autenticación en `public`, y comparar el hash/secuencia de migraciones con el repositorio.
- Comprobar de forma read-only, para cada base preexistente, que las nuevas cuentas no reciben privilegios efectivos sobre tablas, secuencias o funciones `SECURITY DEFINER` por `PUBLIC` o membresías. No seleccionar contenido de tablas ajenas. Si no se puede verificar o aparece un permiso efectivo, no habilitar LOGIN y no modificar ACL preexistentes.
- Probar como cada rol de ejecución sus permisos dentro de su propia base y que no puede leer ni escribir objetos ajenos. Reportar solo éxito/fallo y conteos agregados, sin imprimir nombres de recursos de terceros.

## Reversión

La comparación de OID y la reversión no son atómicas en PostgreSQL. Solo proceder en una ventana de mantenimiento exclusiva después de confirmar que ningún otro operador o automatización puede renombrar, borrar o recrear esos nombres. Revalidar inmediatamente antes de cada DROP; si no se puede excluir concurrencia, no ejecutar la reversión.

Solo antes de migraciones, datos, aplicaciones conectadas y grants de objetos. Requiere el recibo de esta ejecución. En una sesión administrativa read-only, comparar para cada recurso actual los OID, propietario y huella/inicio de servidor con los del recibo. Si falta el recibo, algún OID difiere, el servidor/inicio no coincide, hay sesiones o hay cualquier objeto/dependencia inesperada, detenerse; no borrar por nombre.

Cuando la comparación exacta coincida y las bases estén vacías, conectar a otra base y ejecutar individualmente `DROP DATABASE portal_soporte_test;` y `DROP DATABASE portal_soporte;` sin `CASCADE` ni `WITH (FORCE)`. Si cualquiera falla, detenerse; no terminar sesiones automáticamente. Después, confirmar que los cuatro OID de rol aún coinciden con el recibo y ejecutar `DROP ROLE portal_test_app;`, `DROP ROLE portal_test_migrator;`, `DROP ROLE portal_app;` y `DROP ROLE portal_migrator;`, siempre sin `CASCADE`. Toda diferencia o dependencia detiene la reversión.

Después de aplicar migraciones o crear datos no se elimina ni recrea una base como rollback. Se detiene el procedimiento y se presenta una restauración desde respaldo verificado para autorización independiente. No se reinicia PostgreSQL, no se borra el esquema global ni se recrea un clúster compartido.

## Estado de ejecución

La autorización de aprovisionamiento se ejecutó solo para las dos bases y los cuatro roles nuevos especificados. `portal_soporte_test` está migrada y verificada; `portal_soporte` permanece vacía porque la CLI Drizzle requiere un permiso de base que el diseño permanente no concede. La incompatibilidad se registró con evidencia de SQLSTATE y verificación read-only posterior. No se concede permiso adicional ni se cambia el migrador hasta decisión del propietario. El estado de PS-003 permanece `EN_REVISION` e INFRA-001 queda `BLOQUEADO` por esta decisión.

### Revalidación del 2026-11-19 después de autorización del grant temporal

El propietario autorizó GRANT CREATE ON DATABASE portal_soporte TO portal_migrator solo durante la migración, seguido de REVOKE inmediato. La autorización no se ejecutó porque el preflight autenticado encontró una conexión ociosa en portal_soporte bajo una cuenta que no es ninguno de los cuatro roles del Portal. No se reveló el rol ni el origen, no se cerró la conexión y no se realizó ninguna escritura PostgreSQL. La base queda intacta hasta que el responsable identifique o cierre esa conexión.

Evidencia read-only: host Debian 12 serverAlcazar, huella ED25519 verificada SHA256:kJFGr6h9jFCslHQC2Ej7Mc4/NTf2AEKTCFgLkaaJ7a0, PostgreSQL 15.20, clúster 15/main, system identifier 7589844144764889360; portal_soporte OID 326145, portal_soporte_test OID 326144. Cuatro roles con atributos administrativos desactivados y sin membresías. portal_soporte.portal pertenece a portal_migrator, tiene cero objetos y no tiene ledger. El migrador no tiene CREATE en base, sí en esquema; el rol app no tiene CREATE en base, portal ni public. Se registró una sesión ociosa adicional fuera de los roles Portal. No se aplicó grant temporal ni migración.

Estado: INFRA-001 BLOQUEADO por conexión inesperada; PS-003 sigue EN_REVISION. Reanudar solo tras aclaración del responsable y nuevo preflight.

### Ejecución completada tras la confirmación del propietario · [2026-11-19T10:22:58-06:00]

Preflight revalidado con huella SSH pinneada, servidor Debian 12 serverAlcazar, PostgreSQL 15.20, clúster 15/main, system identifier 7589844144764889360, OID portal_soporte=326145 y portal_soporte_test=326144. El propietario confirmó que la sesión ociosa vista anteriormente era suya. En la revalidación seguía apareciendo una conexión inactiva, superuser/propietaria, originada en la estación del propietario, sin transacción abierta; no se cerró. Se continuó bajo la autorización expresa y sin interferencia sobre esa sesión.

Se concedió CREATE ON DATABASE portal_soporte a portal_migrator únicamente para la operación; el runner Drizzle validó DSN/rol/base/puerto/OID, aplicó las cuatro migraciones versionadas y el permiso se revocó inmediatamente. Postflight: portal contiene seis tablas de aplicación, veinte índices y cuatro entradas del ledger; public no contiene tablas; no quedaron permisos CREATE de base para portal_migrator ni portal_app. Se aplicó en una transacción solo el DML previsto a portal_app; sus permisos efectivos son SELECT=5 tablas, INSERT=5, UPDATE=5, DELETE=1. El ledger queda sin permisos para app. PUBLIC no tiene privilegios de datos ni en el esquema portal.

Validación read-only como portal_app por el túnel: conexión a portal_soporte correcta, recuento sintético de usuarios igual a cero, lectura del ledger denegada (SQLSTATE 42501). No se crearon cuentas, sesiones ni datos de prueba en la base permanente. Las suites unitarias/integración/E2E previas se ejecutaron solo en la base aislada de pruebas.

Inventario agregado read-only de cuatro bases PostgreSQL preexistentes: los cuatro roles Portal tienen CONNECT heredado por PUBLIC, pero cero permisos efectivos de lectura/escritura sobre tablas, secuencias, rutinas SECURITY DEFINER y cero CREATE en esquemas. No se cambiaron ACL de ninguna base preexistente ni ACL global de PUBLIC. El CONNECT heredado puede permitir conexión y lectura de metadatos; para impedir también la conexión sería necesaria una decisión/aprobación distinta sobre ACL por base, fuera del alcance actual.

Resultado: grant temporal revocado; las bases existentes y su configuración no recibieron escrituras. Mantener como riesgo de revisión el CONNECT heredado de PUBLIC y no intentar revocarlo sin autorización. No se ejecutaron suites destructivas contra portal_soporte.

### Estado vigente al 2026-11-19 · revisión PS-003.2 + DEPLOY-001

Esta sección supersede las notas históricas anteriores que dejaron INFRA-001 bloqueado antes de conceder el grant temporal aprobado. El aprovisionamiento y las migraciones ya concluyeron: `portal_soporte` y `portal_soporte_test` tienen cuatro migraciones versionadas bajo `portal`; la base permanente contiene seis tablas de aplicación y veinte índices, sin tablas de autenticación en `public`. `portal_migrator` recibió `CREATE` en `portal_soporte` solo durante la migración y el permiso se revocó inmediatamente. `portal_app` usa solo el DML mínimo aprobado y no puede leer el ledger.

Las cuatro cuentas Portal carecen de privilegios administrativos y membresías. En cuatro bases preexistentes se confirmó solo el `CONNECT` heredado de `PUBLIC`; no se detectaron permisos efectivos de tablas, secuencias, funciones `SECURITY DEFINER` ni `CREATE` de esquema para los roles Portal. No se modificaron las ACL de esas bases ni `PUBLIC` global. El alcance residual de `CONNECT` se mantiene como riesgo y no se intenta corregir en este trabajo.

En PS-003.2 se repitieron las pruebas unitarias (213/213), integración PostgreSQL remota (53/53), migración CLI remota y E2E (8/8) exclusivamente contra `portal_soporte_test`. Las pruebas dejaron el esquema en el estado migrado esperado y sin datos sintéticos persistentes. No se ejecutó prueba destructiva en `portal_soporte`.

La base de pruebas, la permanente, los roles, PostgreSQL global, otras bases, servicios y configuraciones del servidor no se modificaron en esta iteración. INFRA-001 queda `EN_REVISION`; los respaldos y la restauración siguen sin verificar.

### Ejecución completada tras la confirmación del propietario · [2026-11-19T10:22:58-06:00]

Preflight revalidado con huella SSH pinneada, servidor Debian 12 serverAlcazar, PostgreSQL 15.20, clúster 15/main, system identifier 7589844144764889360, OID portal_soporte=326145 y portal_soporte_test=326144. El propietario confirmó que la sesión ociosa vista anteriormente era suya. En la revalidación seguía apareciendo una conexión inactiva, superuser/propietaria, originada en la estación del propietario, sin transacción abierta; no se cerró. Se continuó bajo la autorización expresa y sin interferencia sobre esa sesión.

Se concedió CREATE ON DATABASE portal_soporte a portal_migrator únicamente para la operación; el runner Drizzle validó DSN/rol/base/puerto/OID, aplicó las cuatro migraciones versionadas y el permiso se revocó inmediatamente. Postflight: portal contiene seis tablas de aplicación, veinte índices y cuatro entradas del ledger; public no contiene tablas; no quedaron permisos CREATE de base para portal_migrator ni portal_app. Se aplicó en una transacción solo el DML previsto a portal_app; sus permisos efectivos son SELECT=5 tablas, INSERT=5, UPDATE=5, DELETE=1. El ledger queda sin permisos para app. PUBLIC no tiene privilegios de datos ni en el esquema portal.

Validación read-only como portal_app por el túnel: conexión a portal_soporte correcta, recuento sintético de usuarios igual a cero, lectura del ledger denegada (SQLSTATE 42501). No se crearon cuentas, sesiones ni datos de prueba en la base permanente. Las suites unitarias/integración/E2E previas se ejecutaron solo en la base aislada de pruebas.

Inventario agregado read-only de cuatro bases PostgreSQL preexistentes: los cuatro roles Portal tienen CONNECT heredado por PUBLIC, pero cero permisos efectivos de lectura/escritura sobre tablas, secuencias, rutinas SECURITY DEFINER y cero CREATE en esquemas. No se cambiaron ACL de ninguna base preexistente ni ACL global de PUBLIC. El CONNECT heredado puede permitir conexión y lectura de metadatos; para impedir también la conexión sería necesaria una decisión/aprobación distinta sobre ACL por base, fuera del alcance actual.

Resultado: grant temporal revocado; las bases existentes y su configuración no recibieron escrituras. Mantener como riesgo de revisión el CONNECT heredado de PUBLIC y no intentar revocarlo sin autorización. No se ejecutaron suites destructivas contra portal_soporte.
