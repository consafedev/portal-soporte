#!/usr/bin/env bash
set -Eeuo pipefail
set +x

raiz_repositorio="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${raiz_repositorio}/scripts/mysql-fixture-grants.sh"
identificador="$(openssl rand -hex 6)"
red="portal-mysql-fixture-${identificador}"
contenedor_mysql="portal-mysql-fixture-db-${identificador}"
contenedor_ssh="portal-mysql-fixture-ssh-${identificador}"
imagen_ssh="portal-mysql-fixture-ssh:${identificador}"
directorio_temporal="$(mktemp -d "${TMPDIR:-/tmp}/portal-mysql-fixture.XXXXXXXX")"
directorio_tls="${directorio_temporal}/mysql-tls"
password_app="$(openssl rand -hex 24)"
password_root="$(openssl rand -hex 24)"
password_ssh="$(openssl rand -hex 32)"
puerto_mysql=""
puerto_ssh=""
ip_mysql=""
huella_ssh=""
docker_disponible='false'
diagnostico_mysql_emitido='false'
motivo_fallo_mysql='fixture-failed'
detalle_readiness_mysql=''

# Redacta en la entrada estándar secretos reconocibles de diagnósticos; recibe texto y escribe texto saneado en stdout.
redactar_diagnosticos_mysql() {
  sed -E \
    -e 's/((password|passwd|passphrase|secret|token|private.?key|authorization|dsn)[[:alnum:]_.-]*"?[[:space:]]*[:=][[:space:]]*"?)[^"[:space:],;]+/\1[REDACTED]/Ig' \
    -e 's/((password|passwd|passphrase|secret|token|private.?key|authorization|dsn)[[:alnum:]_.-]*[[:space:]]+)[^"[:space:],;]+/\1[REDACTED]/Ig' \
    -e 's#(://[^:/[:space:]]+:)[^@/[:space:]]+@#\1[REDACTED]@#g'
}

# Registra en stderr el estado, la salida, los volúmenes y los últimos logs del contenedor exacto; recibe el motivo y solo lee Docker.
diagnosticar_mysql_fixture() {
  local motivo="$1"
  diagnostico_mysql_emitido='true'
  echo "MYSQL_FIXTURE_DIAGNOSTICS_BEGIN reason=${motivo}" >&2
  if docker container inspect "${contenedor_mysql}" >/dev/null 2>&1; then
    docker container inspect \
      --format 'status={{.State.Status}} exit_code={{.State.ExitCode}} oom_killed={{.State.OOMKilled}} state_error={{.State.Error}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}} mounts={{range .Mounts}}{{.Source}}->{{.Destination}}:rw={{.RW}};{{end}}' \
      "${contenedor_mysql}" 2>&1 | redactar_diagnosticos_mysql || true
    docker logs --tail 120 "${contenedor_mysql}" 2>&1 | redactar_diagnosticos_mysql || true
  else
    echo 'MYSQL_FIXTURE_CONTAINER_NOT_FOUND' >&2
  fi
  if [[ -n "${detalle_readiness_mysql}" ]]; then
    printf 'readiness_detail=%s\n' "${detalle_readiness_mysql}" | redactar_diagnosticos_mysql >&2
  fi
  echo 'MYSQL_FIXTURE_DIAGNOSTICS_END' >&2
}

# Comprueba por TCP/TLS la disponibilidad autenticada en loopback y captura únicamente el error saneado.
comprobar_readiness_mysql() {
  local salida_ping
  local salida_consulta
  local codigo_error

  if salida_ping="$(docker exec --env "MYSQL_PWD=${password_root}" "${contenedor_mysql}" \
    mysqladmin ping --ssl-mode=REQUIRED --host=127.0.0.1 --user=root 2>&1)"; then
    :
  else
    codigo_error="$?"
    detalle_readiness_mysql="$(printf 'mysqladmin exit=%s output=%s' "${codigo_error}" "${salida_ping}" \
      | redactar_diagnosticos_mysql)"
    return 1
  fi

  if salida_consulta="$(docker exec --env "MYSQL_PWD=${password_root}" "${contenedor_mysql}" \
    mysql --ssl-mode=REQUIRED --batch --skip-column-names --host=127.0.0.1 --user=root \
    --execute='SELECT 1' 2>&1)"; then
    :
  else
    codigo_error="$?"
    detalle_readiness_mysql="$(printf 'mysql SELECT 1 exit=%s output=%s' "${codigo_error}" "${salida_consulta}" \
      | redactar_diagnosticos_mysql)"
    return 1
  fi

  detalle_readiness_mysql=''
  return 0
}

# Limpia únicamente los recursos efímeros identificados por esta ejecución.
limpiar_fixture() {
  local codigo_salida="$?"
  trap - EXIT
  if [[ "${codigo_salida}" -ne 0 && "${docker_disponible}" == 'true' \
    && "${diagnostico_mysql_emitido}" != 'true' ]] \
    && docker container inspect "${contenedor_mysql}" >/dev/null 2>&1; then
    diagnosticar_mysql_fixture "${motivo_fallo_mysql}"
  fi
  if [[ "${codigo_salida}" -ne 0 && -n "${contenedor_ssh}" ]] \
    && docker container inspect "${contenedor_ssh}" >/dev/null 2>&1; then
    echo 'SSH_FIXTURE_DIAGNOSTICS_BEGIN' >&2
    docker logs --tail 120 "${contenedor_ssh}" 2>&1 \
      | sed -E 's/(password|passphrase|secret|token|private.?key|authorization)([=:[:space:]]+)[^[:space:]]+/\1\2[REDACTED]/Ig' \
      || true
    echo 'SSH_FIXTURE_DIAGNOSTICS_END' >&2
  fi
  if [[ "${docker_disponible}" == 'true' ]]; then
    if ! docker info >/dev/null 2>&1; then
      echo 'MYSQL_FIXTURE_CLEANUP_DOCKER_UNAVAILABLE' >&2
      codigo_salida=1
    else
      if [[ -n "${contenedor_ssh}" ]]; then docker rm --force "${contenedor_ssh}" >/dev/null 2>&1 || true; fi
      if [[ -n "${contenedor_mysql}" ]]; then docker rm --force "${contenedor_mysql}" >/dev/null 2>&1 || true; fi
      if [[ -n "${red}" ]]; then docker network rm "${red}" >/dev/null 2>&1 || true; fi
      if [[ -n "${imagen_ssh}" ]]; then docker image rm "${imagen_ssh}" >/dev/null 2>&1 || true; fi

      if [[ -n "${contenedor_ssh}" ]] && docker container inspect "${contenedor_ssh}" >/dev/null 2>&1; then
        echo 'MYSQL_FIXTURE_CLEANUP_SSH_CONTAINER_REMAINS' >&2
        codigo_salida=1
      fi
      if [[ -n "${contenedor_mysql}" ]] && docker container inspect "${contenedor_mysql}" >/dev/null 2>&1; then
        echo 'MYSQL_FIXTURE_CLEANUP_MYSQL_CONTAINER_REMAINS' >&2
        codigo_salida=1
      fi
      if [[ -n "${red}" ]] && docker network inspect "${red}" >/dev/null 2>&1; then
        echo 'MYSQL_FIXTURE_CLEANUP_NETWORK_REMAINS' >&2
        codigo_salida=1
      fi
      if [[ -n "${imagen_ssh}" ]] && docker image inspect "${imagen_ssh}" >/dev/null 2>&1; then
        echo 'MYSQL_FIXTURE_CLEANUP_IMAGE_REMAINS' >&2
        codigo_salida=1
      fi
    fi
  fi
  rm -rf -- "${directorio_temporal}" || codigo_salida=1
  if [[ -e "${directorio_temporal}" ]]; then
    echo 'MYSQL_FIXTURE_CLEANUP_TEMPORARY_DIRECTORY_REMAINS' >&2
    codigo_salida=1
  fi
  exit "${codigo_salida}"
}

trap limpiar_fixture EXIT

# Aplica permisos POSIX o, en Git Bash sobre NTFS, una ACL exclusiva del usuario actual.
aplicar_permisos_restrictivos() {
  local modo="$1"
  local ruta="$2"
  local tipo="$3"
  if chmod "${modo}" "${ruta}" 2>/dev/null; then
    return
  fi
  if ! command -v icacls.exe >/dev/null 2>&1 || ! command -v cygpath >/dev/null 2>&1; then
    echo 'MYSQL_FIXTURE_RESTRICTIVE_PERMISSIONS_UNAVAILABLE' >&2
    return 1
  fi

  local ruta_windows
  local cuenta_windows
  local permiso_windows
  ruta_windows="$(cygpath -w "${ruta}")"
  cuenta_windows="$(whoami.exe)"
  permiso_windows="${cuenta_windows}:F"
  if [[ "${tipo}" == 'directorio' ]]; then
    permiso_windows="${cuenta_windows}:(OI)(CI)F"
  fi
  icacls.exe "${ruta_windows}" /inheritance:r /grant:r "${permiso_windows}" \
    >/dev/null 2>&1 || {
    echo 'MYSQL_FIXTURE_RESTRICTIVE_PERMISSIONS_FAILED' >&2
    return 1
  }
}

aplicar_permisos_restrictivos 0700 "${directorio_temporal}" directorio
mkdir "${directorio_tls}"
aplicar_permisos_restrictivos 0700 "${directorio_tls}" directorio

if ! docker info >/dev/null 2>&1; then
  echo 'MYSQL_FIXTURE_REQUIRES_DOCKER_ENGINE' >&2
  exit 2
fi
docker_disponible='true'
if ! command -v puttygen >/dev/null 2>&1; then
  echo 'MYSQL_FIXTURE_REQUIRES_PUTTYGEN' >&2
  exit 2
fi

# Genera una CA y certificado efímeros para verificar identidad TLS sin desactivar validaciones.
generar_certificados_tls() {
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
    -subj '/CN=Portal MySQL fixture CA' \
    -keyout "${directorio_tls}/ca-key.pem" -out "${directorio_tls}/ca.pem" >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes \
    -subj '/CN=mysql.fixture.invalid' \
    -keyout "${directorio_tls}/server-key.pem" -out "${directorio_tls}/server.csr" >/dev/null 2>&1
  cat > "${directorio_tls}/server.ext" <<'EOF'
subjectAltName=DNS:mysql.fixture.invalid,IP:127.0.0.1
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF
  openssl x509 -req -days 1 -sha256 \
    -in "${directorio_tls}/server.csr" \
    -CA "${directorio_tls}/ca.pem" -CAkey "${directorio_tls}/ca-key.pem" -CAcreateserial \
    -extfile "${directorio_tls}/server.ext" \
    -out "${directorio_tls}/server-cert.pem" >/dev/null 2>&1
  aplicar_permisos_restrictivos 0600 "${directorio_tls}/ca-key.pem" archivo
  aplicar_permisos_restrictivos 0644 "${directorio_tls}/server-key.pem" archivo
  aplicar_permisos_restrictivos 0644 "${directorio_tls}/ca.pem" archivo
  aplicar_permisos_restrictivos 0644 "${directorio_tls}/server-cert.pem" archivo
}

# Crea una clave de cliente desechable y su conversión PPK v2 RSA para las pruebas.
generar_llaves_ssh_sinteticas() {
  ssh-keygen -q -t rsa -b 3072 -m PEM -N '' -C 'fixture-portal' \
    -f "${directorio_temporal}/ssh-client.pem"
  : > "${directorio_temporal}/empty-passphrase"
  puttygen "${directorio_temporal}/ssh-client.pem" \
    --new-passphrase "${directorio_temporal}/empty-passphrase" \
    --ppk-param version=2 -o "${directorio_temporal}/ssh-client.ppk" >/dev/null 2>&1
  aplicar_permisos_restrictivos 0600 "${directorio_temporal}/ssh-client.pem" archivo
  aplicar_permisos_restrictivos 0600 "${directorio_temporal}/ssh-client.ppk" archivo
}

# Crea solo la red, base, gateway y certificados efímeros identificados por esta ejecución.
iniciar_contenedores_aislados() {
  # El proceso mysql debe atravesar el bind mount; el padre temporal permanece privado en modo 0700.
  chmod 0755 "${directorio_tls}"
  docker network create "${red}" >/dev/null
  if ! docker run --detach --name "${contenedor_mysql}" --network "${red}" \
    --network-alias mysql.fixture.invalid --publish 127.0.0.1::3306 \
    --mount "type=bind,source=${directorio_tls},target=/run/mysql-tls,readonly" \
    --env MYSQL_DATABASE=portal_fixture \
    --env "MYSQL_ROOT_PASSWORD=${password_root}" \
    mysql:8.4 \
    --require_secure_transport=ON \
    --ssl-ca=/run/mysql-tls/ca.pem \
    --ssl-cert=/run/mysql-tls/server-cert.pem \
    --ssl-key=/run/mysql-tls/server-key.pem >/dev/null \
    2>"${directorio_temporal}/mysql-container-start.stderr"; then
    echo 'MYSQL_FIXTURE_MYSQL_CONTAINER_START_FAILED' >&2
    echo '::error title=MySQL fixture start::MYSQL_FIXTURE_MYSQL_CONTAINER_START_FAILED' >&2
    motivo_fallo_mysql='container-start-failed'
    redactar_diagnosticos_mysql \
      < "${directorio_temporal}/mysql-container-start.stderr" >&2 || true
    diagnosticar_mysql_fixture "${motivo_fallo_mysql}"
    exit 3
  fi

  local listo='false'
  local motivo_fallo='startup-timeout'
  local inicio_espera="${SECONDS}"
  local limite_espera_segundos=180
  local intervalo_espera_segundos=2
  local estado_contenedor
  while (( SECONDS - inicio_espera < limite_espera_segundos )); do
    # Comprueba vida y autenticación desde el contenedor exacto, por loopback y como root.
    if comprobar_readiness_mysql; then
      listo='true'
      break
    fi
    estado_contenedor="$(docker container inspect --format '{{.State.Status}}' "${contenedor_mysql}" 2>/dev/null || true)"
    if [[ "${estado_contenedor}" != 'running' ]]; then
      motivo_fallo='container-exited-before-readiness'
      break
    fi
    sleep "${intervalo_espera_segundos}"
  done
  if [[ "${listo}" != 'true' ]]; then
    if [[ "${motivo_fallo}" == 'startup-timeout' ]]; then
      echo 'MYSQL_FIXTURE_DATABASE_START_TIMEOUT' >&2
      echo '::error title=MySQL fixture readiness::MYSQL_FIXTURE_DATABASE_START_TIMEOUT' >&2
    else
      echo 'MYSQL_FIXTURE_DATABASE_CONTAINER_EXITED' >&2
      echo '::error title=MySQL fixture readiness::MYSQL_FIXTURE_DATABASE_CONTAINER_EXITED' >&2
    fi
    motivo_fallo_mysql="${motivo_fallo}"
    exit 3
  fi

  docker exec --env "MYSQL_PWD=${password_root}" -i "${contenedor_mysql}" \
    mysql --host=127.0.0.1 --user=root --database=portal_fixture \
    < "${raiz_repositorio}/tests/fixtures/mysql-rf1/schema.sql"
  docker exec --env "MYSQL_PWD=${password_root}" -i "${contenedor_mysql}" \
    mysql --host=127.0.0.1 --user=root --database=portal_fixture \
    < "${raiz_repositorio}/tests/fixtures/mysql-rf1/seed.sql"
  {
    printf "CREATE USER 'portal_fixture_app'@'%%' IDENTIFIED BY '%s';\n" "${password_app}"
    printf "GRANT SELECT ON portal_fixture.sap_sociedad TO 'portal_fixture_app'@'%%';\n"
    printf "GRANT SELECT ON portal_fixture.sap_proveedor TO 'portal_fixture_app'@'%%';\n"
    printf "GRANT SELECT ON portal_fixture.factura TO 'portal_fixture_app'@'%%';\n"
    printf "GRANT INSERT ON portal_fixture.factura TO 'portal_fixture_app'@'%%';\n"
  } > "${directorio_temporal}/fixture-user.sql"
  aplicar_permisos_restrictivos 0600 "${directorio_temporal}/fixture-user.sql" archivo
  docker exec --env "MYSQL_PWD=${password_root}" -i "${contenedor_mysql}" \
    mysql --host=127.0.0.1 --user=root < "${directorio_temporal}/fixture-user.sql"
  local privilegios
  privilegios="$(docker exec --env "MYSQL_PWD=${password_root}" "${contenedor_mysql}" \
    mysql --batch --skip-column-names --host=127.0.0.1 --user=root \
    --execute="SHOW GRANTS FOR 'portal_fixture_app'@'%'" 2>/dev/null)"
  local privilegios_tabla
  privilegios_tabla="$(docker exec --env "MYSQL_PWD=${password_root}" "${contenedor_mysql}" \
    mysql --batch --skip-column-names --host=127.0.0.1 --user=root \
    --execute="SELECT CONCAT(TABLE_SCHEMA, '.', TABLE_NAME, ':', PRIVILEGE_TYPE) \
      FROM information_schema.TABLE_PRIVILEGES \
      WHERE GRANTEE = CONCAT(QUOTE('portal_fixture_app'), '@', QUOTE('%')) \
      ORDER BY TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE" 2>/dev/null)"
  if ! validar_privilegios_minimos_mysql_fixture "${privilegios}" "${privilegios_tabla}"; then
    echo 'MYSQL_FIXTURE_MINIMAL_INSERT_GRANT_INVALID' >&2
    echo '::error title=MySQL fixture privileges::MYSQL_FIXTURE_MINIMAL_INSERT_GRANT_INVALID' >&2
    exit 3
  fi

  ip_mysql="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${contenedor_mysql}")"
  docker build --quiet --tag "${imagen_ssh}" \
    --file "${raiz_repositorio}/tests/fixtures/mysql-ssh-gateway/Dockerfile" \
    "${raiz_repositorio}/tests/fixtures/mysql-ssh-gateway" >/dev/null
  docker run --detach --name "${contenedor_ssh}" --network "${red}" \
    --publish 127.0.0.1::22 \
    --mount "type=bind,source=${directorio_temporal}/ssh-client.pem.pub,target=/run/fixture/authorized_keys,readonly" \
    --env "FIXTURE_MYSQL_DESTINATION=${ip_mysql}:3306" \
    --env "FIXTURE_SSH_PASSWORD=${password_ssh}" \
    "${imagen_ssh}" >/dev/null

  puerto_mysql="$(docker port "${contenedor_mysql}" 3306/tcp | sed -E 's/^127\.0\.0\.1://')"
  puerto_ssh="$(docker port "${contenedor_ssh}" 22/tcp | sed -E 's/^127\.0\.0\.1://')"
  huella_ssh="$(docker exec "${contenedor_ssh}" ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256 | awk '{print $2}')"
}

# Escribe la configuración efímera con permisos restrictivos sin imprimir secretos ni llaves.
escribir_configuracion_fixture() {
  export FIXTURE_MYSQL_HOST_PORT="${puerto_mysql}"
  export FIXTURE_MYSQL_CONTAINER_ADDRESS="${ip_mysql}"
  export FIXTURE_MYSQL_PASSWORD="${password_app}"
  export FIXTURE_MYSQL_CA_PATH="${directorio_tls}/ca.pem"
  export FIXTURE_SSH_PORT="${puerto_ssh}"
  export FIXTURE_SSH_FINGERPRINT="${huella_ssh}"
  export FIXTURE_SSH_PEM_PATH="${directorio_temporal}/ssh-client.pem"
  export FIXTURE_SSH_PPK_PATH="${directorio_temporal}/ssh-client.ppk"
  export FIXTURE_SSH_PASSWORD="${password_ssh}"
  node --input-type=module - "${directorio_temporal}/fixture.json" <<'NODE'
import { chmodSync, writeFileSync } from 'node:fs';
const ruta = process.argv[2];
const configuracion = {
  mysqlHostPort: Number(process.env['FIXTURE_MYSQL_HOST_PORT']),
  mysqlContainerAddress: process.env['FIXTURE_MYSQL_CONTAINER_ADDRESS'],
  database: 'portal_fixture',
  username: 'portal_fixture_app',
  password: process.env['FIXTURE_MYSQL_PASSWORD'],
  caPath: process.env['FIXTURE_MYSQL_CA_PATH'],
  sshPort: Number(process.env['FIXTURE_SSH_PORT']),
  sshFingerprint: process.env['FIXTURE_SSH_FINGERPRINT'],
  pemPrivateKeyPath: process.env['FIXTURE_SSH_PEM_PATH'],
  ppkPrivateKeyPath: process.env['FIXTURE_SSH_PPK_PATH'],
  sshPassword: process.env['FIXTURE_SSH_PASSWORD'],
};
writeFileSync(ruta, JSON.stringify(configuracion), { mode: 0o600 });
chmodSync(ruta, 0o600);
NODE
  unset password_ssh FIXTURE_SSH_PASSWORD
}

generar_certificados_tls
generar_llaves_ssh_sinteticas
iniciar_contenedores_aislados
escribir_configuracion_fixture

echo 'MySQL fixture sintético listo; ejecutando pruebas TCP/TLS y SSH.'
cd "${raiz_repositorio}"
PORTAL_MYSQL_FIXTURE_CONFIG="${directorio_temporal}/fixture.json" \
  corepack pnpm@12.21.0 exec vitest run --config vitest.mysql-fixture.config.ts
