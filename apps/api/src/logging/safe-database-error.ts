const TABLAS_AUTH = new Set([
  'audit_events',
  'auth_invariants',
  'auth_throttle_windows',
  'client_connection_profiles',
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

/** Identidad mínima de una excepción para correlación interna sin publicar su mensaje. */
export interface IdentidadErrorSegura {
  /** Nombre estándar del tipo de error o una categoría genérica normalizada. */
  readonly errorType: string;
  /** Código estructurado con formato acotado, si el error lo proporciona. */
  readonly errorCode?: string;
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

/**
 * Extrae solo el nombre estándar y un código estructurado de una cadena causal.
 * Nunca conserva mensaje, consulta, host, usuario, parámetros ni credenciales.
 *
 * @param error Excepción interna original, posiblemente encadenada con cause.
 * @returns Identidad reducida y segura para logs operativos.
 */
export function extraerIdentidadErrorSegura(error: unknown): IdentidadErrorSegura {
  const nombresPermitidos = new Set([
    'Error',
    'TypeError',
    'RangeError',
    'SyntaxError',
    'ReferenceError',
    'URIError',
    'AggregateError',
  ]);
  const vistos = new Set<object>();
  let actual: unknown = error;
  let errorType = 'UnknownError';
  let errorCode: string | undefined;

  for (let nivel = 0; nivel < 5 && typeof actual === 'object' && actual !== null; nivel += 1) {
    if (vistos.has(actual)) break;
    vistos.add(actual);
    const registro = actual as Record<string, unknown>;
    const nombre = registro['name'];
    const codigo = registro['code'];
    if (
      errorType === 'UnknownError' &&
      typeof nombre === 'string' &&
      nombresPermitidos.has(nombre)
    ) {
      errorType = nombre;
    }
    if (
      errorCode === undefined &&
      typeof codigo === 'string' &&
      /^[A-Z][A-Z0-9_]{0,63}$/u.test(codigo)
    ) {
      errorCode = codigo;
    }
    actual = registro['cause'];
  }

  return { errorType, ...(errorCode === undefined ? {} : { errorCode }) };
}
