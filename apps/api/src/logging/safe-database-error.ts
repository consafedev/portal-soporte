const TABLAS_AUTH = new Set([
  'audit_events',
  'auth_invariants',
  'auth_throttle_windows',
  'recovery_tokens',
  'sessions',
  'users',
]);

/** Campos permitidos para registrar un fallo PostgreSQL sin datos de consulta ni valores. */
export interface DiagnosticoBaseDatosSeguro {
  /** SQLSTATE estandarizado, cuando el proveedor lo expone en la cadena causal. */
  readonly databaseCode?: string;
  /** Tabla de autenticación permitida asociada al error, si está disponible. */
  readonly databaseTable?: string;
  /** Tipo de sentencia permitido, derivado de la consulta pero nunca registrado como texto. */
  readonly databaseOperation?: string;
  /** Posición del parser PostgreSQL sin incluir la consulta ni sus parámetros. */
  readonly databasePosition?: number;
}

/**
 * Extrae solo SQLSTATE y tabla propia permitida desde una cadena causal de errores.
 *
 * @param error Error original de una operación interna.
 * @returns Campos allowlisted; omite mensaje, SQL, parámetros, tokens y secretos.
 */
export function extraerDiagnosticoBaseDatosSeguro(error: unknown): DiagnosticoBaseDatosSeguro {
  const vistos = new Set<object>();
  let actual: unknown = error;
  let databaseCode: string | undefined;
  let databaseTable: string | undefined;
  let databaseOperation: string | undefined;
  let databasePosition: number | undefined;

  for (let nivel = 0; nivel < 5 && typeof actual === 'object' && actual !== null; nivel += 1) {
    if (vistos.has(actual)) break;
    vistos.add(actual);
    const registro = actual as Record<string, unknown>;
    const codigo = registro['code'];
    const tabla = registro['table_name'] ?? registro['table'];
    const consulta = registro['query'];
    const posicion = Number(registro['position']);
    if (databaseCode === undefined && typeof codigo === 'string' && /^[A-Z0-9]{5}$/u.test(codigo)) {
      databaseCode = codigo;
    }
    if (databaseTable === undefined && typeof tabla === 'string' && TABLAS_AUTH.has(tabla)) {
      databaseTable = tabla;
    }
    if (typeof consulta === 'string') {
      databaseOperation ??= consulta
        .match(/^\s*(SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/iu)?.[1]
        ?.toUpperCase();
      const coincidencia = consulta.match(
        /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:"?portal"?\.)?"?([a-z_][a-z0-9_]*)"?/iu,
      );
      const tablaConsulta = coincidencia?.[1];
      if (
        databaseTable === undefined &&
        tablaConsulta !== undefined &&
        TABLAS_AUTH.has(tablaConsulta)
      ) {
        databaseTable = tablaConsulta;
      }
    }
    if (
      databasePosition === undefined &&
      Number.isInteger(posicion) &&
      posicion > 0 &&
      posicion <= 1_000_000
    ) {
      databasePosition = posicion;
    }
    actual = registro['cause'];
  }

  return {
    ...(databaseCode === undefined ? {} : { databaseCode }),
    ...(databaseTable === undefined ? {} : { databaseTable }),
    ...(databaseOperation === undefined ? {} : { databaseOperation }),
    ...(databasePosition === undefined ? {} : { databasePosition }),
  };
}
