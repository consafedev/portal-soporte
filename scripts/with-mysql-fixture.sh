#!/usr/bin/env bash
set -Eeuo pipefail
set +x

raiz_repositorio="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
identificador="$(openssl rand -hex 6)"
red="portal-mysql-fixture-${identificador}"
contenedor_mysql="portal-mysql-fixture-db-${identificador}"
contenedor_ssh="portal-mysql-fixture-ssh-${identificador}"
imagen_ssh="portal-mysql-fixture-ssh:${identificador}"
directorio_temporal="$(mktemp -d "${TMPDIR:-/tmp}/portal-mysql-fixture.XXXXXXXX")"
directorio_tls="${directorio_temporal}/mysql-tls"
password_app="$(openssl rand -hex 24)"
password_root="$(openssl rand -hex 24)"
puerto_mysql=""
puerto_ssh=""
ip_mysql=""
huella_ssh=""

# Limpia únicamente los recursos efímeros identificados por esta ejecución.
limpiar_fixture() {
  local codigo_salida="$?"
  trap - EXIT
  if [[ "${codigo_salida}" -ne 0 && -n "${contenedor_ssh}" ]] \
    && docker container inspect "${contenedor_ssh}" >/dev/null 2>&1; then
    echo 'SSH_FIXTURE_DIAGNOSTICS_BEGIN' >&2
    docker logs --tail 120 "${contenedor_ssh}" 2>&1 \
      | sed -E 's/(password|passphrase|secret|token|private.?key|authorization)([=:[:space:]]+)[^[:space:]]+/\1\2[REDACTED]/Ig' \
      || true
    echo 'SSH_FIXTURE_DIAGNOSTICS_END' >&2
  fi
  if [[ -n "${contenedor_ssh}" ]]; then docker rm --force "${contenedor_ssh}" >/dev/null 2>&1 || true; fi
  if [[ -n "${contenedor_mysql}" ]]; then docker rm --force "${contenedor_mysql}" >/dev/null 2>&1 || true; fi
  if [[ -n "${red}" ]]; then docker network rm "${red}" >/dev/null 2>&1 || true; fi
  if [[ -n "${imagen_ssh}" ]]; then docker image rm "${imagen_ssh}" >/dev/null 2>&1 || true; fi
  rm -rf -- "${directorio_temporal}"
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
  docker network create "${red}" >/dev/null
  docker run --detach --name "${contenedor_mysql}" --network "${red}" \
    --network-alias mysql.fixture.invalid --publish 127.0.0.1::3306 \
    --mount "type=bind,source=${directorio_tls},target=/run/mysql-tls,readonly" \
    --env MYSQL_DATABASE=portal_fixture \
    --env "MYSQL_ROOT_PASSWORD=${password_root}" \
    mysql:8.4 \
    --require_secure_transport=ON \
    --ssl-ca=/run/mysql-tls/ca.pem \
    --ssl-cert=/run/mysql-tls/server-cert.pem \
    --ssl-key=/run/mysql-tls/server-key.pem >/dev/null

  local listo='false'
  for _ in $(seq 1 90); do
    if docker exec --env "MYSQL_PWD=${password_root}" "${contenedor_mysql}" \
      mysqladmin ping --host=127.0.0.1 --user=root >/dev/null 2>&1; then
      listo='true'
      break
    fi
    sleep 1
  done
  if [[ "${listo}" != 'true' ]]; then
    echo 'MYSQL_FIXTURE_DATABASE_START_TIMEOUT' >&2
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
    printf "GRANT SELECT ON portal_fixture.* TO 'portal_fixture_app'@'%%';\n"
  } > "${directorio_temporal}/fixture-user.sql"
  aplicar_permisos_restrictivos 0600 "${directorio_temporal}/fixture-user.sql" archivo
  docker exec --env "MYSQL_PWD=${password_root}" -i "${contenedor_mysql}" \
    mysql --host=127.0.0.1 --user=root < "${directorio_temporal}/fixture-user.sql"
  local privilegios
  privilegios="$(docker exec --env "MYSQL_PWD=${password_root}" "${contenedor_mysql}" \
    mysql --batch --skip-column-names --host=127.0.0.1 --user=root \
    --execute="SHOW GRANTS FOR 'portal_fixture_app'@'%'" 2>/dev/null)"
  if [[ "$(grep -c 'GRANT SELECT ON' <<< "${privilegios}")" -ne 1 ]] \
    || [[ "${privilegios}" != *'portal_fixture'* ]] \
    || grep -Eiq 'ALL PRIVILEGES|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT OPTION|FILE|SUPER' \
      <<< "${privilegios}"; then
    echo 'MYSQL_FIXTURE_READ_ONLY_GRANT_INVALID' >&2
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
};
writeFileSync(ruta, JSON.stringify(configuracion), { mode: 0o600 });
chmodSync(ruta, 0o600);
NODE
}

generar_certificados_tls
generar_llaves_ssh_sinteticas
iniciar_contenedores_aislados
escribir_configuracion_fixture

echo 'MySQL fixture sintético listo; ejecutando pruebas TCP/TLS y SSH.'
cd "${raiz_repositorio}"
PORTAL_MYSQL_FIXTURE_CONFIG="${directorio_temporal}/fixture.json" \
  corepack pnpm@12.21.0 exec vitest run --config vitest.mysql-fixture.config.ts
