import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  coincideFingerprintSsh,
  crearOpcionesConexionMysql,
} from '../../packages/connectors/src/mysql2-ssh-factories.js';
import type { DatosConexionMySql } from '../../packages/connectors/src/mysql-connection-broker.js';

const destino = {
  id: 'db-sintetica',
  hostname: 'mysql.test.invalid',
  address: '192.0.2.20',
  port: 3306,
};

/** Construye una configuración de conexión solo con datos sintéticos de prueba. */
function crearDatos(stream?: PassThrough): DatosConexionMySql {
  return {
    destino,
    database: 'portal_sintetico',
    mysqlUsername: 'usuario_sintetico',
    mysqlPassword: 'secreto-sintetico',
    tls: {
      ca: 'CA sintética',
      cert: 'certificado sintético',
      key: 'llave sintética',
      rejectUnauthorized: true,
    },
    ...(stream === undefined ? {} : { stream }),
    timeoutMs: 4_000,
  };
}

describe('configuración de fábricas MySQL y SSH', () => {
  it('fija el stream a la IP permitida y exige TLS con identidad del hostname', () => {
    const stream = new PassThrough();

    const opciones = crearOpcionesConexionMysql(crearDatos(), stream);

    expect(opciones).toMatchObject({
      host: 'mysql.test.invalid',
      port: 3306,
      user: 'usuario_sintetico',
      password: 'secreto-sintetico',
      database: 'portal_sintetico',
      stream,
      connectTimeout: 4_000,
      multipleStatements: false,
      flags: ['-LOCAL_FILES'],
      ssl: {
        ca: 'CA sintética',
        cert: 'certificado sintético',
        key: 'llave sintética',
        rejectUnauthorized: true,
        verifyIdentity: true,
        minVersion: 'TLSv1.2',
      },
    });
  });

  it('genera el verificador de fingerprint OpenSSH sin padding base64', () => {
    const claveHostSintetica = Buffer.from('clave-host-ssh-sintetica');
    const fingerprint = `SHA256:${createHash('sha256').update(claveHostSintetica).digest('base64').replace(/=+$/u, '')}`;

    expect(coincideFingerprintSsh(claveHostSintetica, fingerprint)).toBe(true);
    expect(coincideFingerprintSsh(claveHostSintetica, `${fingerprint.slice(0, -1)}x`)).toBe(false);
    expect(coincideFingerprintSsh(claveHostSintetica, 'SHA256:huella-invalida')).toBe(false);
  });
});
