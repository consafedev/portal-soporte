import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { cargarBundleCaMySql } from '../../apps/api/src/clients/connection-runtime-config.js';
import {
  cargarConfiguracionBasePrueba,
  cargarConfiguracionConexionPrueba,
  cargarConfiguracionEscuchaApi,
  cargarConfiguracionMigracionPrueba,
  exigirArnesPostgresVerificado,
  validarModoEntradaHarnessPrueba,
} from '../../apps/api/src/runtime-config.js';

const permisoMutacionesRemotas = 'portal_soporte_test';

/** Devuelve variables sintéticas para ejercer configuración local sin abrir sockets. */
function crearEntornoEscucha(ajustes: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: 'development', ...ajustes };
}

/** Construye una URL sintética sin dejar una cadena de conexión completa en el archivo. */
function crearUrlBasePrueba(
  host: string,
  puerto = '54322',
  base = 'portal_ps003_test',
  usuario = 'ps003_test',
  contrasena = '',
  consulta = '',
): string {
  const url = new URL(`postgres://${host}/`);
  url.port = puerto;
  url.pathname = `/${base}`;
  url.username = usuario;
  url.password = contrasena;
  url.search = consulta;

  return url.href;
}

/** Construye DSN remoto sintético para validar rol, puerto y base sin conectar. */
function crearUrlRemotaPrueba(
  usuario: 'portal_test_app' | 'portal_test_migrator' = 'portal_test_app',
  puerto = '15432',
  host = '127.0.0.1',
  base = 'portal_soporte_test',
  contrasena = randomBytes(32).toString('base64url'),
  consulta = '',
  fragmento = '',
): string {
  const url = new URL(`postgres://${host}/`);
  url.port = puerto;
  url.pathname = `/${base}`;
  url.username = usuario;
  url.password = contrasena;
  url.search = consulta;
  url.hash = fragmento;

  return url.href;
}

/** Construye el modo remoto explícito con las dos credenciales sintéticas. */
function crearEntornoRemotoPrueba(ajustes: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    TEST_DATABASE_MODE: 'ssh-tunnel',
    PORTAL_TEST_HARNESS_VERIFIED: '1',
    TEST_DATABASE_ALLOW_MUTATIONS: permisoMutacionesRemotas,
    TEST_DATABASE_URL: crearUrlRemotaPrueba('portal_test_app'),
    TEST_MIGRATOR_DATABASE_URL: crearUrlRemotaPrueba('portal_test_migrator'),
    ...ajustes,
  };
}

describe('cargarConfiguracionEscuchaApi', () => {
  it('usa loopback y puerto limitado como valores locales seguros', () => {
    expect(cargarConfiguracionEscuchaApi(crearEntornoEscucha())).toEqual({
      host: '127.0.0.1',
      port: 4100,
    });
  });

  it('permite una IP privada explícita para el runtime de producción', () => {
    expect(
      cargarConfiguracionEscuchaApi({
        NODE_ENV: 'production',
        API_LISTEN_HOST: '10.24.3.7',
        API_LISTEN_PORT: '4200',
      }),
    ).toEqual({ host: '10.24.3.7', port: 4200 });
  });

  it.each(['0.0.0.0', '192.0.2.10', 'api.example.test', '127.0.0.1:4100'])(
    'rechaza una escucha no privada: %s',
    (host) => {
      expect(() =>
        cargarConfiguracionEscuchaApi(crearEntornoEscucha({ API_LISTEN_HOST: host })),
      ).toThrow('API_LISTEN_HOST debe ser loopback o una IP privada explícita.');
    },
  );

  it.each(['0', '65536', '41x', ''])('rechaza un puerto fuera de rango: %s', (port) => {
    expect(() =>
      cargarConfiguracionEscuchaApi(crearEntornoEscucha({ API_LISTEN_PORT: port })),
    ).toThrow('API_LISTEN_PORT debe ser un entero entre 1 y 65535.');
  });
});

describe('cargarBundleCaMySql', () => {
  it('permite omitir el bundle para conservar el almacén TLS predeterminado', () => {
    expect(cargarBundleCaMySql(undefined)).toBeUndefined();
  });

  it('carga únicamente certificados CA PEM desde un archivo absoluto regular', () => {
    const directorio = mkdtempSync(join(tmpdir(), 'portal-ca-test-'));
    const ruta = join(directorio, 'bundle.pem');
    const certificado = rootCertificates.at(0);
    if (certificado === undefined) {
      throw new Error('NODE_ROOT_CERTIFICATE_MISSING');
    }

    try {
      writeFileSync(ruta, certificado, { mode: 0o600 });
      expect(cargarBundleCaMySql(ruta)).toBe(readFileSync(ruta, 'utf8'));
    } finally {
      rmSync(directorio, { recursive: true, force: true });
    }
  });

  it('rechaza rutas relativas y archivos que no contienen una CA válida', () => {
    const directorio = mkdtempSync(join(tmpdir(), 'portal-ca-invalid-'));
    const ruta = join(directorio, 'bundle.pem');

    try {
      writeFileSync(ruta, 'contenido que no es un certificado', { mode: 0o600 });
      expect(() => cargarBundleCaMySql('bundle.pem')).toThrow('MYSQL_CA_BUNDLE_CONFIG_INVALID');
      expect(() => cargarBundleCaMySql(ruta)).toThrow('MYSQL_CA_BUNDLE_CONFIG_INVALID');
    } finally {
      rmSync(directorio, { recursive: true, force: true });
    }
  });
});

describe('cargarConfiguracionMigracionPrueba', () => {
  it('acepta solamente la URL loopback sin contraseña del esquema efímero', () => {
    expect(
      cargarConfiguracionMigracionPrueba({
        NODE_ENV: 'test',
        TEST_DATABASE_MODE: 'local-ephemeral',
        PORTAL_TEST_HARNESS_VERIFIED: '1',
        TEST_DATABASE_URL: crearUrlBasePrueba('127.0.0.1'),
      }),
    ).toEqual({
      NODE_ENV: 'test',
      DATABASE_URL: crearUrlBasePrueba('127.0.0.1'),
    });
  });

  it('rechaza hosts, bases, usuarios, passwords y consultas no aislados', () => {
    const destinos = [
      crearUrlBasePrueba('db.example.test'),
      crearUrlBasePrueba('127.0.0.1', '54322', 'portal_produccion'),
      crearUrlBasePrueba(
        '127.0.0.1',
        '54322',
        'portal_ps003_test',
        'usuario_prueba',
        randomBytes(32).toString('base64url'),
      ),
      crearUrlBasePrueba(
        '127.0.0.1',
        '54322',
        'portal_ps003_test',
        'ps003_test',
        '',
        '?sslmode=disable',
      ),
    ];

    for (const url of destinos) {
      expect(() =>
        cargarConfiguracionMigracionPrueba({
          NODE_ENV: 'test',
          TEST_DATABASE_MODE: 'local-ephemeral',
          PORTAL_TEST_HARNESS_VERIFIED: '1',
          TEST_DATABASE_URL: url,
        }),
      ).toThrow('TEST_DATABASE_URL debe señalar únicamente a portal_ps003_test en loopback.');
    }
  });

  it('rechaza migraciones solicitadas fuera del entorno de pruebas', () => {
    expect(() =>
      cargarConfiguracionMigracionPrueba({
        NODE_ENV: 'development',
        TEST_DATABASE_URL: crearUrlBasePrueba('127.0.0.1'),
      }),
    ).toThrow('La CLI de migración solo admite NODE_ENV=test.');
  });
});

describe('exigirArnesPostgresVerificado', () => {
  it('rechaza conexiones de prueba que no provienen del harness', () => {
    expect(() => exigirArnesPostgresVerificado({ TEST_DATABASE_MODE: 'ssh-tunnel' })).toThrow(
      'La conexión PostgreSQL de pruebas requiere el harness aislado verificado.',
    );
  });

  it.each(['local-ephemeral', 'ssh-tunnel'] as const)('acepta el modo verificado %s', (modo) => {
    expect(() =>
      exigirArnesPostgresVerificado({
        TEST_DATABASE_MODE: modo,
        PORTAL_TEST_HARNESS_VERIFIED: '1',
      }),
    ).not.toThrow();
  });
});

describe('validarModoEntradaHarnessPrueba', () => {
  it('acepta modo local solo cuando el runner creará un clúster', () => {
    expect(() => validarModoEntradaHarnessPrueba({})).not.toThrow();
    expect(() =>
      validarModoEntradaHarnessPrueba({ TEST_DATABASE_MODE: 'local-ephemeral' }),
    ).not.toThrow();
  });

  it('rechaza URLs locales manuales para prevenir conexiones persistentes accidentales', () => {
    expect(() =>
      validarModoEntradaHarnessPrueba({
        TEST_DATABASE_MODE: 'local-ephemeral',
        TEST_DATABASE_URL: 'postgres://ps003_test@127.0.0.1/portal_ps003_test',
      }),
    ).toThrow('Una URL externa de pruebas requiere el modo SSH remoto explícito.');
  });

  it('exige una URL cuando se selecciona explícitamente el modo remoto', () => {
    expect(() => validarModoEntradaHarnessPrueba({ TEST_DATABASE_MODE: 'ssh-tunnel' })).toThrow(
      'El modo remoto requiere TEST_DATABASE_URL antes de iniciar cualquier prueba.',
    );
  });

  it('rechaza modos de prueba desconocidos antes de iniciar PostgreSQL', () => {
    expect(() => validarModoEntradaHarnessPrueba({ TEST_DATABASE_MODE: 'persistent' })).toThrow(
      'TEST_DATABASE_MODE debe ser local-ephemeral o ssh-tunnel.',
    );
  });
});

describe('cargarConfiguracionBasePrueba', () => {
  it('acepta portal_test_app como el rol de ejecución remota aprobado', () => {
    const urlAplicacion = new URL(crearUrlRemotaPrueba('portal_test_app'));
    urlAplicacion.username = 'portal_test_app';
    const entorno = crearEntornoRemotoPrueba({ TEST_DATABASE_URL: urlAplicacion.href });

    expect(cargarConfiguracionBasePrueba(entorno).TEST_DATABASE_URL).toBe(urlAplicacion.href);
  });

  it('acepta el destino remoto únicamente con ambos roles y opt-in exacto', () => {
    const entorno = crearEntornoRemotoPrueba();
    const configuracion = cargarConfiguracionBasePrueba(entorno);

    expect(configuracion).toEqual({
      modo: 'ssh-tunnel',
      TEST_DATABASE_URL: entorno['TEST_DATABASE_URL'],
      TEST_MIGRATOR_DATABASE_URL: entorno['TEST_MIGRATOR_DATABASE_URL'],
    });
    expect(cargarConfiguracionMigracionPrueba(entorno)).toEqual({
      NODE_ENV: 'test',
      DATABASE_URL: entorno['TEST_MIGRATOR_DATABASE_URL'],
    });
  });

  it.each([
    ['modo ausente', { TEST_DATABASE_MODE: undefined }],
    [
      'base distinta',
      {
        TEST_DATABASE_URL: crearUrlRemotaPrueba(
          'portal_test_app',
          '15432',
          '127.0.0.1',
          'portal_soporte',
        ),
      },
    ],
    [
      'rol de aplicación distinto',
      { TEST_DATABASE_URL: crearUrlRemotaPrueba('portal_test_migrator') },
    ],
    [
      'host distinto',
      { TEST_DATABASE_URL: crearUrlRemotaPrueba('portal_test_app', '15432', '10.18.170.44') },
    ],
    ['puerto distinto', { TEST_DATABASE_URL: crearUrlRemotaPrueba('portal_test_app', '5432') }],
    [
      'password ausente',
      {
        TEST_DATABASE_URL: crearUrlRemotaPrueba(
          'portal_test_app',
          '15432',
          '127.0.0.1',
          'portal_soporte_test',
          '',
        ),
      },
    ],
    [
      'query string',
      {
        TEST_DATABASE_URL: crearUrlRemotaPrueba(
          'portal_test_app',
          '15432',
          '127.0.0.1',
          'portal_soporte_test',
          randomBytes(32).toString('base64url'),
          '?sslmode=disable',
        ),
      },
    ],
    [
      'fragmento',
      {
        TEST_DATABASE_URL: crearUrlRemotaPrueba(
          'portal_test_app',
          '15432',
          '127.0.0.1',
          'portal_soporte_test',
          randomBytes(32).toString('base64url'),
          '',
          '#secreto',
        ),
      },
    ],
    [
      'rol de migración distinto',
      { TEST_MIGRATOR_DATABASE_URL: crearUrlRemotaPrueba('portal_test_app') },
    ],
    ['opt-in de escritura distinto', { TEST_DATABASE_ALLOW_MUTATIONS: 'portal_soporte' }],
  ])('rechaza el destino remoto con %s', (_caso, ajustes) => {
    expect(() => cargarConfiguracionBasePrueba(crearEntornoRemotoPrueba(ajustes))).toThrow();
  });

  it('no incluye credenciales ni DSN en los errores de validación', () => {
    const secretoSintetico = randomBytes(32).toString('base64url');
    const entorno = crearEntornoRemotoPrueba({
      TEST_DATABASE_URL: crearUrlRemotaPrueba(
        'portal_test_app',
        '15432',
        '127.0.0.1',
        'portal_soporte_test',
        secretoSintetico,
      ),
      TEST_DATABASE_ALLOW_MUTATIONS: 'no',
    });

    let mensaje = '';
    try {
      cargarConfiguracionBasePrueba(entorno);
    } catch (error) {
      mensaje = error instanceof Error ? error.message : String(error);
    }

    expect(mensaje).not.toContain(secretoSintetico);
    expect(mensaje).not.toContain('postgres://');
  });
});

describe('cargarConfiguracionConexionPrueba', () => {
  it('valida el DSN de aplicación sin requerir ni cargar el DSN migrador', () => {
    const entorno = crearEntornoRemotoPrueba();
    const urlApp = entorno['TEST_DATABASE_URL'];
    delete entorno['TEST_MIGRATOR_DATABASE_URL'];

    expect(cargarConfiguracionConexionPrueba(entorno, 'portal_test_app')).toEqual({
      modo: 'ssh-tunnel',
      DATABASE_URL: urlApp,
    });
  });

  it('resuelve solo el DSN migrador cuando el runtime lo solicita explícitamente', () => {
    const entorno = crearEntornoRemotoPrueba();
    const urlMigrador = entorno['TEST_MIGRATOR_DATABASE_URL'];
    delete entorno['TEST_DATABASE_URL'];

    expect(cargarConfiguracionConexionPrueba(entorno, 'portal_test_migrator')).toEqual({
      modo: 'ssh-tunnel',
      DATABASE_URL: urlMigrador,
    });
  });
});
