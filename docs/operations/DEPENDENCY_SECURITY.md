# Hallazgo de seguridad: picomatch en herramientas de desarrollo

**Revisión:** 2026-11-17 · **Estado:** riesgo abierto, aceptación temporal condicionada solo para desarrollo; no resuelto · **Alcance:** lockfile pnpm de la línea base v0.2.

## Advisory y comportamiento

GitHub Advisory Database registra `GHSA-fc5q-39xc-vjpf` / `CVE-2026-112366` como severidad alta (CVSS 4.0: 8.7). El rango declarado es `picomatch <=4.0.7`; el advisory no publica una versión corregida. Patrones extglob repetidos de una sola rama, como `+(*)` y `+(*a)`, pueden generar retroceso exponencial de expresiones regulares y bloquear el event loop de Node.js al compararse con entradas construidas para ese patrón. El impacto descrito es denegación de servicio por consumo de CPU/disponibilidad; no se atribuye exposición de confidencialidad ni integridad.

Fuentes consultadas el 2026-11-17: [advisory de GitHub](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), [releases de picomatch](https://github.com/micromatch/picomatch/releases), [PR #237](https://github.com/micromatch/picomatch/pull/237) y [PR #238](https://github.com/micromatch/picomatch/pull/238).

## Árbol observado en este workspace

La salida de `pnpm why -r picomatch` y `pnpm audit --json` muestra que todas las coincidencias de la alerta son dependencias de desarrollo (`dev: true`):

- `picomatch@2.3.2`: `eslint-config-next@16.4.6` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `picomatch`.
- `picomatch@4.0.7`: `eslint-config-next@16.4.6` → `eslint-import-resolver-typescript` / `typescript-eslint` → `tinyglobby` / `fdir` → `picomatch`.
- `picomatch@4.0.7`: `secretlint@14.0.1` → `@secretlint/core` / `@secretlint/walker` → `picomatch`.
- `picomatch@4.0.7`: `vitest@5.1.0` → `vite@8.3.8` / `tinyglobby` / `fdir` → `picomatch`.

`pnpm why -r --prod picomatch` no devuelve rutas y `pnpm audit --prod --audit-level high` informa que no conoce vulnerabilidades. Por tanto, el lockfile inspeccionado no conecta estas instancias con dependencias de producción. El análisis completo sí marca **ambas versiones instaladas**, `2.3.2` y `4.0.7`, dentro del rango publicado por el advisory.

## Alcance y posibilidad de explotación aquí

La aplicación no importa `picomatch` directamente. En esta línea base el paquete solo llega mediante linters, el escáner de secretos y el runner de pruebas; no hay endpoints de usuario ni servicios productivos implementados que reciban patrones glob. El riesgo práctico actual está en las herramientas locales y el job de CI: si una configuración o código de una rama/PR hace que esas herramientas compilen un patrón extglob malicioso, el proceso Node puede consumir CPU y retrasar o bloquear ese job. La configuración de CI usa `permissions: contents: read` y no referencia secretos; el job puede leer código de una PR, así que esto limita el impacto a la disponibilidad del runner/build, no elimina la posibilidad de que el propio contenido de PR influya en herramientas.

## Corrección y contención

Al momento de la revisión, el registro npm y la página de releases muestran `4.0.7` como la última versión publicada; GitHub marca `Patched versions: None`. Hay propuestas de corrección en PR #237 y PR #238, pero siguen abiertas y no son releases consumibles desde el registro. El maintainer también disputó públicamente la clasificación del caso; el advisory revisado de GitHub permanece activo y `pnpm audit` lo reporta. Sin una versión publicada y compatible no se fuerza un override a una rama, commit o versión que siga dentro del rango.

Controles aplicados o vigentes:

- El comando completo `pnpm audit --audit-level high` permanece estricto y devuelve FAIL ante el advisory. En CI, el wrapper conserva y muestra su JSON y código de salida originales; un gate independiente evalúa la excepción aprobada sin cambiar el resultado de la auditoría.
- La auditoría de producción (`pnpm audit --prod --audit-level high`) permanece como paso estricto de CI.
- Mantener las coincidencias de lint/test/secret scan estáticas y no aceptar patrones de usuario o de sistemas externos en las herramientas que resuelven globs.
- Conservar `permissions: contents: read` en CI y no pasar secretos a ese job.
- Actualizar el lockfile cuando haya una versión corregida publicada; después repetir `pnpm why`, auditorías completa y de producción, pruebas y build. La excepción debe dejar de permitir el gate ante un advisory parchado o un cambio del esquema de auditoría.

**Riesgo residual:** el propietario aceptó el 2026-11-17 este riesgo de forma temporal y condicionada, exclusivamente para herramientas y CI de desarrollo. El advisory permanece abierto, la auditoría completa continúa fallando y la aceptación no autoriza automáticamente ningún despliegue productivo. Resolver al publicarse una versión corregida compatible, actualizar el lockfile y volver a pasar la auditoría completa, la auditoría de producción y las verificaciones de calidad pertinentes.

## Aceptación temporal condicionada

- **Aprobación y fecha:** propietario del proyecto, 2026-11-17, registrada explícitamente en la autorización de PS-002.2.
- **Responsable de aceptación del riesgo:** propietario del proyecto. **Responsable del seguimiento y la remediación técnica:** equipo de ingeniería del portal; Codex registra y verifica la actualización.
- **Ámbito aceptado:** exclusivamente dependencias de desarrollo utilizadas en estaciones locales y CI de validación de desarrollo. No incluye runtime de producción, artefactos desplegados, ni jobs con secretos o permisos de escritura.
- **Mitigaciones requeridas mientras permanezca abierto:** conservar visible el resultado FAIL de la auditoría completa; mantener permisos mínimos de CI (`contents: read`) y no suministrar secretos; no construir patrones glob desde entradas no confiables; ejecutar auditoría estricta de producción; no añadir excepciones, overrides o supresiones adicionales sin aprobación separada y trazable.
- **Condición para resolver:** una versión corregida publicada y compatible debe reemplazar las instancias afectadas; actualizar el lockfile; confirmar el árbol con pnpm why; obtener PASS de auditoría completa y de producción; repetir format, lint, typecheck, tests, build, skill y secreto. Registrar evidencia y revisión del propietario.
- **Límite de autorización:** esta aceptación temporal no cambia el resultado FAIL de la auditoría completa y no constituye autorización para producción. La excepción de CI requiere y recibió una aprobación expresa separada, descrita a continuación.

## Excepción temporal de CI — aprobada, activa y limitada

**Aprobación:** el propietario autorizó expresamente su implementación el 2026-11-17. La excepción está codificada en `.github/dependency-audit-allowlist.json` y el evaluador fail-closed está en `scripts/check-dependency-audit.mjs`. La aprobación es válida hasta el final del **2026-12-17 UTC**; desde el 2026-12-18 el gate falla mientras siga presente la alerta.

La única combinación admitida es `GHSA-fc5q-39xc-vjpf` / `CVE-2026-112366`, paquete `picomatch`, versiones `2.3.2` y `4.0.7`, severidad high y alcance `development`. Cada instancia debe conservar `dev: true`; el resultado de `pnpm audit --audit-level high --json` debe seguir siendo código 1 y el esquema de pnpm 12.21.0 debe coincidir exactamente con el validado. El evaluador también exige que el resumen y los advisories coincidan y que no haya otra alerta high/critical.

El wrapper imprime completa la salida JSON y mantiene visible `pnpm audit --audit-level high: FAIL (código 1)`. El paso de CI solo informa que la política permitió continuar bajo la excepción aprobada; **no convierte ni reporta la auditoría completa como PASS**. La auditoría de producción permanece en un paso separado y estricto. El audit local `pnpm check:dependencies` sigue siendo estricto y devuelve FAIL ante el hallazgo actual.

La excepción falla cerrada ante cualquier otra alerta high/critical, instancia que no sea dev, paquete/rango/versión/severidad inesperados, advisory parchado, código de salida inconsistente, JSON o esquema desconocido, conteos incongruentes, allowlist modificada o vencimiento. No aplica a artefactos desplegados, producción ni jobs con secretos o permisos de escritura. El riesgo de disponibilidad permanece abierto y requiere actualizar el lockfile al publicarse una versión corregida, volver a obtener PASS de la auditoría completa y de producción, repetir las verificaciones de calidad y solicitar revisión del propietario.
