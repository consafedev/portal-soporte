import { describe, expect, it } from 'vitest';
import {
  validarEstadoEsquemaBasePrueba,
  validarIdentidadBasePrueba,
  validarMismaInstanciaBasePrueba,
  type EstadoEsquemaBasePrueba,
  type IdentidadPostgresPrueba,
} from '../../apps/api/src/db/test-database-preflight.js';

const restriccionesEsperadasPrueba = [
  ['__drizzle_migrations', '__drizzle_migrations_pkey', 'p'],
  ['audit_events', 'audit_events_actor_user_id_users_id_fk', 'f'],
  ['audit_events', 'audit_events_outcome_check', 'c'],
  ['audit_events', 'audit_events_pkey', 'p'],
  ['audit_events', 'audit_events_target_user_id_users_id_fk', 'f'],
  ['auth_invariants', 'auth_invariants_pkey', 'p'],
  ['auth_invariants', 'auth_invariants_singleton_check', 'c'],
  ['auth_throttle_windows', 'auth_throttle_attempt_count_check', 'c'],
  ['auth_throttle_windows', 'auth_throttle_expiration_check', 'c'],
  ['auth_throttle_windows', 'auth_throttle_scope_check', 'c'],
  ['auth_throttle_windows', 'auth_throttle_windows_pkey', 'p'],
  ['recovery_tokens', 'recovery_tokens_expiration_check', 'c'],
  ['recovery_tokens', 'recovery_tokens_pkey', 'p'],
  ['recovery_tokens', 'recovery_tokens_purpose_check', 'c'],
  ['recovery_tokens', 'recovery_tokens_target_email_check', 'c'],
  ['recovery_tokens', 'recovery_tokens_token_hash_unique', 'u'],
  ['recovery_tokens', 'recovery_tokens_user_id_users_id_fk', 'f'],
  ['sessions', 'sessions_pkey', 'p'],
  ['sessions', 'sessions_token_hash_unique', 'u'],
  ['sessions', 'sessions_user_id_users_id_fk', 'f'],
  ['users', 'users_credential_state_check', 'c'],
  ['users', 'users_pkey', 'p'],
  ['users', 'users_role_check', 'c'],
  ['users', 'users_status_check', 'c'],
  ['users', 'users_theme_preference_check', 'c'],
].map(([tabla, nombre, tipo]) => ({
  esquema: 'portal',
  tabla: tabla!,
  nombre: nombre!,
  tipo: tipo!,
}));

/** Describe una conexión sintética que debe identificar solo el servidor de pruebas. */
function crearIdentidadPrueba(
  ajustes: Partial<IdentidadPostgresPrueba> = {},
): IdentidadPostgresPrueba {
  const rol = ajustes.rol ?? 'portal_test_app';
  const esMigrador = rol === 'portal_test_migrator';
  return {
    nombreBase: 'portal_soporte_test',
    rol,
    direccionServidor: '127.0.0.1',
    puertoServidor: 5432,
    versionServidor: 180007,
    inicioServidor: '2026-11-18T12:00:00.000Z',
    esSuperusuario: false,
    puedeCrearBases: false,
    puedeCrearRoles: false,
    puedeReplicar: false,
    puedeOmitirRls: false,
    sinMembresias: true,
    heredaRoles: false,
    puedeIniciarSesion: true,
    limiteConexiones: esMigrador ? 2 : 8,
    puedeCrearEsquemas: esMigrador,
    puedeConectar: true,
    puedeCrearTemporales: true,
    puedeUsarEsquemaPublico: true,
    puedeCrearEnEsquemaPublico: false,
    puedeUsarEsquemaPortal: true,
    puedeCrearEnEsquemaPortal: esMigrador,
    aclPublicoLimpio: true,
    permisosDmlExactos: true,
    sinAccesoObjetosFueraPortal: true,
    objetosPropiedadMigrador: true,
    ...ajustes,
  };
}

/** Construye el estado inicial sin objetos de aplicación. */
function crearEstadoVacio(): EstadoEsquemaBasePrueba {
  return {
    esquemas: ['portal', 'public'],
    tablas: [],
    secuencias: [],
    relaciones: [],
    restricciones: [],
    hashesMigraciones: [],
    objetosAdicionales: {
      rutinas: 0,
      disparadores: 0,
      politicas: 0,
      tiposPersonalizados: 0,
      reglas: 0,
      objetosGrandes: 0,
      extensiones: [],
    },
    filas: {
      usuarios: 0,
      sesiones: 0,
      tokens: 0,
      limitadores: 0,
      auditoria: 0,
      invariantes: 0,
    },
  };
}

/** Construye el único esquema migrado que admite una ejecución remota repetible. */
function crearEstadoMigrado(
  variantesHashesMigracion: readonly (readonly string[])[],
): EstadoEsquemaBasePrueba {
  return {
    esquemas: ['portal', 'public'],
    tablas: [
      '__drizzle_migrations',
      'audit_events',
      'auth_invariants',
      'auth_throttle_windows',
      'recovery_tokens',
      'sessions',
      'users',
    ].map((nombre) => ({ esquema: 'portal', nombre, tipo: 'BASE TABLE' })),
    secuencias: [{ esquema: 'portal', nombre: '__drizzle_migrations_id_seq' }],
    restricciones: restriccionesEsperadasPrueba,
    relaciones: [
      ['__drizzle_migrations', 'r'],
      ['__drizzle_migrations_id_seq', 'S'],
      ['__drizzle_migrations_pkey', 'i'],
      ['audit_events', 'r'],
      ['audit_events_actor_created_idx', 'i'],
      ['audit_events_created_at_idx', 'i'],
      ['audit_events_pkey', 'i'],
      ['audit_events_target_created_idx', 'i'],
      ['auth_invariants', 'r'],
      ['auth_invariants_pkey', 'i'],
      ['auth_throttle_expires_at_idx', 'i'],
      ['auth_throttle_windows', 'r'],
      ['auth_throttle_windows_pkey', 'i'],
      ['recovery_tokens', 'r'],
      ['recovery_tokens_expires_at_idx', 'i'],
      ['recovery_tokens_pkey', 'i'],
      ['recovery_tokens_token_hash_unique', 'i'],
      ['recovery_tokens_user_id_idx', 'i'],
      ['sessions', 'r'],
      ['sessions_absolute_expires_at_idx', 'i'],
      ['sessions_idle_expires_at_idx', 'i'],
      ['sessions_pkey', 'i'],
      ['sessions_token_hash_unique', 'i'],
      ['sessions_user_id_idx', 'i'],
      ['users', 'r'],
      ['users_email_normalized_unique', 'i'],
      ['users_pkey', 'i'],
      ['users_username_normalized_unique', 'i'],
    ].map(([nombre, tipo]) => ({ esquema: 'portal', nombre: nombre!, tipo: tipo! })),
    hashesMigraciones: variantesHashesMigracion.map((variantes) => variantes[0] ?? ''),
    objetosAdicionales: {
      rutinas: 0,
      disparadores: 0,
      politicas: 0,
      tiposPersonalizados: 0,
      reglas: 0,
      objetosGrandes: 0,
      extensiones: [{ nombre: 'plpgsql', esquema: 'pg_catalog' }],
    },
    filas: {
      usuarios: 0,
      sesiones: 0,
      tokens: 0,
      limitadores: 0,
      auditoria: 0,
      invariantes: 1,
    },
  };
}

describe('validación de identidad PostgreSQL de prueba', () => {
  it('acepta permisos PUBLIC base y el esquema portal para la aplicación', () => {
    const identidad = crearIdentidadPrueba();

    expect(validarIdentidadBasePrueba(identidad, 'portal_test_app')).toEqual(identidad);
  });

  it('acepta el migrador con CREATE limitado a la base y el esquema de prueba', () => {
    const identidad = crearIdentidadPrueba({
      rol: 'portal_test_migrator',
      puedeCrearEsquemas: true,
    });

    expect(validarIdentidadBasePrueba(identidad, 'portal_test_migrator')).toEqual(identidad);
  });

  it.each([
    ['base', { nombreBase: 'portal_soporte' }],
    ['rol', { rol: 'portal_app' }],
    ['dirección del servidor', { direccionServidor: '10.18.170.44' }],
    ['puerto del servidor', { puertoServidor: 15432 }],
    ['inicio de instancia', { inicioServidor: '' }],
    ['SUPERUSER', { esSuperusuario: true }],
    ['CREATEDB', { puedeCrearBases: true }],
    ['CREATEROLE', { puedeCrearRoles: true }],
    ['REPLICATION', { puedeReplicar: true }],
    ['BYPASSRLS', { puedeOmitirRls: true }],
    ['CREATE para la aplicación', { puedeCrearEsquemas: true }],
    ['TEMPORARY de PUBLIC ausente', { puedeCrearTemporales: false }],
    ['membresía en otro rol', { sinMembresias: false }],
    ['herencia de roles', { heredaRoles: true }],
    ['LOGIN desactivado', { puedeIniciarSesion: false }],
    ['límite de conexiones alto', { limiteConexiones: 99 }],
    ['USAGE de PUBLIC ausente en public', { puedeUsarEsquemaPublico: false }],
    ['CREATE en public', { puedeCrearEnEsquemaPublico: true }],
    ['CREATE en portal para runner', { puedeCrearEnEsquemaPortal: true }],
    ['ACL PUBLIC no aislada', { aclPublicoLimpio: false }],
    ['DML adicional', { permisosDmlExactos: false }],
    ['acceso fuera de portal', { sinAccesoObjetosFueraPortal: false }],
  ])('rechaza una identidad con %s inesperado', (_caso, ajustes) => {
    expect(() =>
      validarIdentidadBasePrueba(crearIdentidadPrueba(ajustes), 'portal_test_app'),
    ).toThrow('La identidad PostgreSQL no coincide con el rol y el destino de pruebas.');
  });

  it('rechaza un migrador sin CREATE limitado a su propia base de pruebas', () => {
    expect(() =>
      validarIdentidadBasePrueba(
        crearIdentidadPrueba({ rol: 'portal_test_migrator', puedeCrearEsquemas: false }),
        'portal_test_migrator',
      ),
    ).toThrow('La identidad PostgreSQL no coincide con el rol y el destino de pruebas.');
  });

  it('detecta que las dos credenciales alcanzan instancias distintas', () => {
    expect(() =>
      validarMismaInstanciaBasePrueba(
        crearIdentidadPrueba(),
        crearIdentidadPrueba({ inicioServidor: '2026-11-18T12:05:00.000Z' }),
      ),
    ).toThrow('Las credenciales de prueba no alcanzan la misma instancia PostgreSQL.');
  });
});

describe('validación del estado persistente de la base de pruebas', () => {
  const hashesEsperados = ['hash-0000', 'hash-0001', 'hash-0002', 'hash-0003', 'hash-0004'].map(
    (hash) => [hash],
  );

  it('acepta una base nueva antes de aplicar migraciones', () => {
    expect(validarEstadoEsquemaBasePrueba(crearEstadoVacio(), hashesEsperados)).toBe('vacio');
  });

  it('acepta la base vacía con el esquema portal ya creado por aprovisionamiento', () => {
    expect(
      validarEstadoEsquemaBasePrueba(
        { ...crearEstadoVacio(), esquemas: ['public', 'portal'] },
        hashesEsperados,
      ),
    ).toBe('vacio');
  });

  it('acepta solo las tablas versionadas y vacías del Portal tras migrar', () => {
    expect(
      validarEstadoEsquemaBasePrueba(crearEstadoMigrado(hashesEsperados), hashesEsperados),
    ).toBe('migrado');
  });

  it('acepta únicamente el esquema vacío inmediatamente anterior a la última migración', () => {
    const estadoAnterior = crearEstadoMigrado(hashesEsperados.slice(0, -1));
    const restriccionesAnteriores = estadoAnterior.restricciones.filter(
      (restriccion) => restriccion.nombre !== 'users_theme_preference_check',
    );

    expect(
      validarEstadoEsquemaBasePrueba(
        { ...estadoAnterior, restricciones: restriccionesAnteriores },
        hashesEsperados,
      ),
    ).toBe('migracion-pendiente');
  });

  it('acepta hashes equivalentes de archivos con finales de línea Windows o Unix', () => {
    const variantes = ['hash-0000', 'hash-0001', 'hash-0002', 'hash-0003', 'hash-0004'].map(
      (hash) => [`${hash}-windows`, `${hash}-unix`],
    );
    const estado = crearEstadoMigrado(variantes);

    expect(
      validarEstadoEsquemaBasePrueba(
        { ...estado, hashesMigraciones: variantes.map((hashes) => hashes[1] ?? '') },
        variantes,
      ),
    ).toBe('migrado');
  });

  it.each([
    ['esquema extra', { ...crearEstadoVacio(), esquemas: ['public', 'otra_app'] }],
    [
      'índice extra',
      {
        ...crearEstadoMigrado(hashesEsperados),
        relaciones: [
          ...crearEstadoMigrado(hashesEsperados).relaciones,
          { esquema: 'portal', nombre: 'users_extra_idx', tipo: 'i' },
        ],
      },
    ],
    [
      'restricción CHECK extra',
      {
        ...crearEstadoMigrado(hashesEsperados),
        restricciones: [
          ...crearEstadoMigrado(hashesEsperados).restricciones,
          {
            esquema: 'portal',
            tabla: 'users',
            nombre: 'users_external_check',
            tipo: 'c',
          },
        ],
      },
    ],
    [
      'clave foránea extra',
      {
        ...crearEstadoMigrado(hashesEsperados),
        restricciones: [
          ...crearEstadoMigrado(hashesEsperados).restricciones,
          {
            esquema: 'portal',
            tabla: 'users',
            nombre: 'users_external_fk',
            tipo: 'f',
          },
        ],
      },
    ],
    [
      'tabla extra',
      {
        ...crearEstadoVacio(),
        tablas: [{ esquema: 'public', nombre: 'datos', tipo: 'BASE TABLE' }],
      },
    ],
    ['historial incompleto', crearEstadoMigrado(hashesEsperados.slice(0, 2))],
    ['hash de migración distinto', crearEstadoMigrado([['externo'], ...hashesEsperados.slice(1)])],
    [
      'usuario previo',
      {
        ...crearEstadoMigrado(hashesEsperados),
        filas: { ...crearEstadoMigrado(hashesEsperados).filas, usuarios: 1 },
      },
    ],
    [
      'auditoría residual',
      {
        ...crearEstadoMigrado(hashesEsperados),
        filas: { ...crearEstadoMigrado(hashesEsperados).filas, auditoria: 1 },
      },
    ],
    [
      'función SECURITY DEFINER',
      {
        ...crearEstadoMigrado(hashesEsperados),
        objetosAdicionales: {
          ...crearEstadoMigrado(hashesEsperados).objetosAdicionales,
          rutinas: 1,
        },
      },
    ],
    [
      'disparador externo',
      {
        ...crearEstadoMigrado(hashesEsperados),
        objetosAdicionales: {
          ...crearEstadoMigrado(hashesEsperados).objetosAdicionales,
          disparadores: 1,
        },
      },
    ],
    [
      'large object',
      {
        ...crearEstadoMigrado(hashesEsperados),
        objetosAdicionales: {
          ...crearEstadoMigrado(hashesEsperados).objetosAdicionales,
          objetosGrandes: 1,
        },
      },
    ],
    [
      'extensión ajena',
      {
        ...crearEstadoMigrado(hashesEsperados),
        objetosAdicionales: {
          ...crearEstadoMigrado(hashesEsperados).objetosAdicionales,
          extensiones: [{ nombre: 'extension_ajena', esquema: 'public' }],
        },
      },
    ],
  ])('rechaza estado no limpio con %s', (_caso, estado) => {
    expect(() => validarEstadoEsquemaBasePrueba(estado, hashesEsperados)).toThrow(
      /^La base de pruebas contiene objetos o datos fuera del estado aprobado/,
    );
  });
});
