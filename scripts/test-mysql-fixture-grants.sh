#!/usr/bin/env bash
set -Eeuo pipefail

raiz_repositorio="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${raiz_repositorio}/scripts/mysql-fixture-grants.sh"

# MySQL 8.4 puede presentar SELECT e INSERT de la misma tabla en un solo GRANT.
grants_validos=$'GRANT USAGE ON *.* TO `portal_fixture_app`@`%`\nGRANT SELECT ON `portal_fixture`.`sap_sociedad` TO `portal_fixture_app`@`%`\nGRANT SELECT ON `portal_fixture`.`sap_proveedor` TO `portal_fixture_app`@`%`\nGRANT SELECT, INSERT ON `portal_fixture`.`factura` TO `portal_fixture_app`@`%`'
privilegios_validos=$'portal_fixture.factura:INSERT\nportal_fixture.factura:SELECT\nportal_fixture.sap_proveedor:SELECT\nportal_fixture.sap_sociedad:SELECT'

# Confirma que un conjunto de grants y filas de privilegios se acepte como mínimo.
assert_aceptado() {
  local descripcion="$1"
  local grants="$2"
  local privilegios="$3"
  if ! validar_privilegios_minimos_mysql_fixture "${grants}" "${privilegios}"; then
    echo "FALLO: se rechazó el caso válido: ${descripcion}." >&2
    return 1
  fi
}

# Confirma que un conjunto de grants y filas de privilegios se rechace por exceso o falta.
assert_rechazado() {
  local descripcion="$1"
  local grants="$2"
  local privilegios="$3"
  if validar_privilegios_minimos_mysql_fixture "${grants}" "${privilegios}"; then
    echo "FALLO: se aceptó el caso no permitido: ${descripcion}." >&2
    return 1
  fi
}

assert_aceptado 'MySQL consolida SELECT e INSERT' "${grants_validos}" "${privilegios_validos}"

grants_separados=$'GRANT USAGE ON *.* TO `portal_fixture_app`@`%`\nGRANT SELECT ON `portal_fixture`.`sap_sociedad` TO `portal_fixture_app`@`%`\nGRANT SELECT ON `portal_fixture`.`sap_proveedor` TO `portal_fixture_app`@`%`\nGRANT SELECT ON `portal_fixture`.`factura` TO `portal_fixture_app`@`%`\nGRANT INSERT ON `portal_fixture`.`factura` TO `portal_fixture_app`@`%`'
assert_aceptado 'SELECT e INSERT aparecen separados' "${grants_separados}" "${privilegios_validos}"

grants_con_update="${grants_validos}"$'\nGRANT UPDATE ON `portal_fixture`.`factura` TO `portal_fixture_app`@`%`'
privilegios_con_update="${privilegios_validos}"$'\nportal_fixture.factura:UPDATE'
assert_rechazado 'UPDATE en factura' "${grants_con_update}" "${privilegios_con_update}"

grants_con_permiso_amplio="${grants_validos}"$'\nGRANT SELECT ON `portal_fixture`.* TO `portal_fixture_app`@`%`'
assert_rechazado 'permiso a nivel de esquema' "${grants_con_permiso_amplio}" "${privilegios_validos}"

privilegios_sin_insert=$'portal_fixture.factura:SELECT\nportal_fixture.sap_proveedor:SELECT\nportal_fixture.sap_sociedad:SELECT'
assert_rechazado 'INSERT ausente' "${grants_validos}" "${privilegios_sin_insert}"

echo 'PASS: grants mínimos consolidados, separados y denegación de privilegios extra.'
