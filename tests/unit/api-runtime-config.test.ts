import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  cargarConfiguracionEscuchaApi,
  cargarConfiguracionMigracionPrueba,
} from '../../apps/api/src/runtime-config.js';

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

describe('cargarConfiguracionMigracionPrueba', () => {
  it('acepta solamente la URL loopback sin contraseña del esquema efímero', () => {
    expect(
      cargarConfiguracionMigracionPrueba({
        NODE_ENV: 'test',
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
        cargarConfiguracionMigracionPrueba({ NODE_ENV: 'test', TEST_DATABASE_URL: url }),
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
