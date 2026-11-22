#!/usr/bin/env bash

# Comprueba que la cuenta efímera tenga solo los permisos RF-1 necesarios.
#
# @param grants - Sentencias devueltas por SHOW GRANTS para la cuenta del fixture.
# @param privilegios_tabla - Filas schema.tabla:privilegio de INFORMATION_SCHEMA.TABLE_PRIVILEGES.
# @returns Código cero si coinciden el alcance y los privilegios mínimos; otro si hay diferencias.
validar_privilegios_minimos_mysql_fixture() {
  local grants="$1"
  local privilegios_tabla="$2"
  local expresion_uso='^GRANT USAGE ON \*\.\* TO .portal_fixture_app.@.%.$'
  local expresion_tabla='^GRANT (SELECT|INSERT)(, (SELECT|INSERT))* ON .portal_fixture.\..(sap_sociedad|sap_proveedor|factura). TO .portal_fixture_app.@.%.$'
  local cantidad_uso
  local grants_no_permitidos
  local privilegios_actuales
  local privilegios_esperados

  cantidad_uso="$(grep -Eic "${expresion_uso}" <<< "${grants}" || true)"
  if [[ "${cantidad_uso}" -ne 1 ]]; then
    return 1
  fi

  grants_no_permitidos="$(grep -Eiv "${expresion_uso}|${expresion_tabla}" <<< "${grants}" || true)"
  if [[ -n "${grants_no_permitidos}" ]]; then
    return 1
  fi

  privilegios_actuales="$(printf '%s\n' "${privilegios_tabla}" | sed '/^$/d' | LC_ALL=C sort)"
  privilegios_esperados="$(printf '%s\n' \
    'portal_fixture.factura:INSERT' \
    'portal_fixture.factura:SELECT' \
    'portal_fixture.sap_proveedor:SELECT' \
    'portal_fixture.sap_sociedad:SELECT' | LC_ALL=C sort)"

  [[ "${privilegios_actuales}" == "${privilegios_esperados}" ]]
}
