import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  ClientConnectionBrokerMySql,
  PoliticaDestinosConexion,
  type ConexionMySqlPrueba,
  type DatosConexionMySql,
  type FabricaConexionMySql,
  type FabricaTunelSsh,
  type TunelSshPrueba,
} from '../../packages/connectors/src/mysql-connection-broker.js';
import type {
  DestinoGatewaySsh,
  PerfilConexionPrueba,
} from '../../packages/core/src/clients/secret-custody-ports.js';

const destino = {
  id: 'db-sintetica',
  hostname: 'db.test.invalid',
  address: '192.0.2.11',
  port: 3306,
};
const gateway: DestinoGatewaySsh = {
  id: 'ssh-sintetico',
  hostname: 'ssh.test.invalid',
  address: '192.0.2.12',
  port: 22,
  fingerprint: `SHA256:${'A'.repeat(43)}`,
};
const perfilDirecto: PerfilConexionPrueba = {
  id: '00000000-0000-4000-8000-000000000003',
  clientId: '00000000-0000-4000-8000-000000000001',
  tipo: 'MYSQL_TCP',
  destinoMySqlId: destino.id,
  baseDatos: 'base_sintetica',
};

/** Construye factories que registran únicamente datos sintéticos y el SQL fijo del broker. */
function crearFactories(
  consulta: () => Promise<void> = async () => undefined,
  falloConexion?: Error,
): {
  readonly mysql: FabricaConexionMySql;
  readonly ssh: FabricaTunelSsh;
  readonly mysqlDatos: DatosConexionMySql[];
  readonly consultas: string[];
  readonly tunelesCreados: number[];
  readonly cierresMySql: number[];
  readonly cierresSsh: number[];
} {
  const mysqlDatos: DatosConexionMySql[] = [];
  const consultas: string[] = [];
  const tunelesCreados: number[] = [];
  const cierresMySql: number[] = [];
  const cierresSsh: number[] = [];
  const stream = new PassThrough();
  const mysql: FabricaConexionMySql = {
    async conectar(datos): Promise<ConexionMySqlPrueba> {
      mysqlDatos.push(datos);
      if (falloConexion !== undefined) {
        throw falloConexion;
      }
      return {
        async consultar(sql): Promise<void> {
          consultas.push(sql);
          await consulta();
        },
        async cerrar(): Promise<void> {
          cierresMySql.push(1);
        },
        abortar(): void {},
      };
    },
  };
  const ssh: FabricaTunelSsh = {
    async abrir(): Promise<TunelSshPrueba> {
      tunelesCreados.push(1);
      return {
        stream,
        async cerrar(): Promise<void> {
          cierresSsh.push(1);
          stream.destroy();
        },
        abortar(): void {
          stream.destroy();
        },
      };
    },
  };

  return { mysql, ssh, mysqlDatos, consultas, tunelesCreados, cierresMySql, cierresSsh };
}

/** Crea una credencial sintética que debe ser borrada por el broker al terminar. */
function crearSecretos(ssh: boolean = false): Buffer {
  return Buffer.from(
    JSON.stringify({
      mysqlUsername: 'usuario_sintetico',
      mysqlPassword: 'clave-sintetica-de-prueba',
      tls: { ca: 'CERTIFICADO CA SINTÉTICO' },
      ...(ssh
        ? {
            ssh: {
              username: 'ssh_sintetico',
              authentication: 'PRIVATE_KEY',
              privateKey:
                '-----BEGIN OPENSSH PRIVATE KEY-----\nllave-sintetica\n-----END OPENSSH PRIVATE KEY-----',
            },
          }
        : {}),
    }),
    'utf8',
  );
}

/** Construye credenciales sintéticas con el texto de llave indicado para validar su formato. */
function crearSecretosConLlave(llave: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      mysqlUsername: 'usuario_sintetico',
      mysqlPassword: 'clave-sintetica-de-prueba',
      ssh: {
        username: 'ssh_sintetico',
        authentication: 'PRIVATE_KEY',
        privateKey: llave,
      },
    }),
    'utf8',
  );
}

/** Compone el broker con una allowlist explícita de direcciones reservadas para pruebas. */
function crearBroker(factories: ReturnType<typeof crearFactories>): ClientConnectionBrokerMySql {
  return new ClientConnectionBrokerMySql(
    new PoliticaDestinosConexion([destino], [gateway]),
    factories.mysql,
    factories.ssh,
    100,
  );
}

describe('ClientConnectionBrokerMySql', () => {
  it('usa destino fijado, TLS verificado y solo ejecuta SELECT 1 en modo directo', async () => {
    const factories = crearFactories();
    const secretos = crearSecretos();
    const broker = crearBroker(factories);

    const resultado = await broker.probar(perfilDirecto, secretos);

    expect(resultado.code).toBe('CONNECTED');
    expect(factories.mysqlDatos[0]).toMatchObject({
      destino: { address: '192.0.2.11', hostname: 'db.test.invalid' },
      database: 'base_sintetica',
      mysqlUsername: 'usuario_sintetico',
      tls: { ca: 'CERTIFICADO CA SINTÉTICO', rejectUnauthorized: true },
    });
    expect(factories.consultas).toEqual(['SELECT 1']);
    expect(factories.cierresMySql).toEqual([1]);
    expect([...secretos].every((byte) => byte === 0)).toBe(true);
  });

  it('rechaza un destino ajeno a la allowlist sin abrir sockets ni ejecutar consultas', async () => {
    const factories = crearFactories();
    const secretos = crearSecretos();
    const broker = crearBroker(factories);

    const resultado = await broker.probar(
      { ...perfilDirecto, destinoMySqlId: 'destino-no-configurado' },
      secretos,
    );

    expect(resultado.code).toBe('DESTINATION_NOT_ALLOWED');
    expect(factories.mysqlDatos).toHaveLength(0);
    expect(factories.consultas).toHaveLength(0);
    expect([...secretos].every((byte) => byte === 0)).toBe(true);
  });

  it('abre el gateway autorizado, hace un único forward acotado y lo cierra', async () => {
    const factories = crearFactories();
    const secretos = crearSecretos(true);
    const broker = crearBroker(factories);
    const perfil: PerfilConexionPrueba = {
      ...perfilDirecto,
      tipo: 'MYSQL_SSH',
      gatewaySshId: gateway.id,
    };

    const resultado = await broker.probar(perfil, secretos);

    expect(resultado.code).toBe('CONNECTED');
    expect(factories.tunelesCreados).toEqual([1]);
    expect(factories.mysqlDatos[0]?.destino.address).toBe('192.0.2.11');
    expect(factories.mysqlDatos[0]?.gateway?.address).toBe('192.0.2.12');
    expect(factories.consultas).toEqual(['SELECT 1']);
    expect(factories.cierresSsh).toEqual([1]);
    expect([...secretos].every((byte) => byte === 0)).toBe(true);
  });

  it('cierra recursos cuando la consulta falla y redacta el error del driver', async () => {
    const factories = crearFactories(async () => {
      throw new Error('clave-sintetica-de-prueba usuario_sintetico db.test.invalid');
    });
    const broker = crearBroker(factories);
    const secretos = crearSecretos();

    const resultado = await broker.probar(perfilDirecto, secretos);

    expect(resultado.code).toBe('MYSQL_CONNECTION_FAILED');
    expect(JSON.stringify(resultado)).not.toContain('clave-sintetica-de-prueba');
    expect(JSON.stringify(resultado)).not.toContain('db.test.invalid');
    expect(factories.cierresMySql).toEqual([1]);
  });

  it('rechaza paquetes de credenciales mal formados sin intentar conectarse', async () => {
    const factories = crearFactories();
    const broker = crearBroker(factories);
    const secretos = Buffer.from('{mal formado', 'utf8');

    const resultado = await broker.probar(perfilDirecto, secretos);

    expect(resultado.code).toBe('INVALID_CREDENTIALS');
    expect(factories.mysqlDatos).toHaveLength(0);
    expect([...secretos].every((byte) => byte === 0)).toBe(true);
  });

  it('clasifica fallos MySQL sin propagar mensajes del driver', async () => {
    const falloAutenticacion = Object.assign(
      new Error('usuario_sintetico clave-sintetica db.sensible.invalid'),
      { code: 'ER_ACCESS_DENIED_ERROR' },
    );
    const falloTls = Object.assign(new Error('CERT_HAS_EXPIRED'), {
      code: 'CERT_HAS_EXPIRED',
    });

    for (const caso of [
      { fallo: falloAutenticacion, esperado: 'MYSQL_AUTHENTICATION_FAILED' },
      { fallo: falloTls, esperado: 'MYSQL_TLS_FAILED' },
    ] as const) {
      const factories = crearFactories(async () => undefined, caso.fallo);
      const broker = crearBroker(factories);
      const resultado = await broker.probar(perfilDirecto, crearSecretos());

      expect(resultado.code).toBe(caso.esperado);
      expect(JSON.stringify(resultado)).not.toContain('usuario_sintetico');
      expect(JSON.stringify(resultado)).not.toContain('db.sensible.invalid');
    }
  });

  it('rechaza contraseña SSH y distingue un PPK fuera de formato', async () => {
    const factories = crearFactories();
    const broker = crearBroker(factories);
    const paquetes = [
      {
        ssh: {
          username: 'ssh_sintetico',
          authentication: 'PASSWORD',
          password: 'secreto-sintetico',
        },
        code: 'INVALID_CREDENTIALS',
      },
      {
        ssh: {
          username: 'ssh_sintetico',
          authentication: 'PRIVATE_KEY',
          privateKey: 'PuTTY-User-Key-File-3: ssh-ed25519',
        },
        code: 'SSH_KEY_FORMAT_UNSUPPORTED',
      },
    ];

    for (const paquete of paquetes) {
      const secretos = Buffer.from(
        JSON.stringify({
          mysqlUsername: 'usuario_sintetico',
          mysqlPassword: 'clave-sintetica-de-prueba',
          ssh: paquete.ssh,
        }),
        'utf8',
      );
      const resultado = await broker.probar(
        { ...perfilDirecto, tipo: 'MYSQL_SSH', gatewaySshId: gateway.id },
        secretos,
      );

      expect(resultado.code).toBe(paquete.code);
      expect([...secretos].every((byte) => byte === 0)).toBe(true);
    }
    expect(factories.tunelesCreados).toHaveLength(0);
  });

  it('acepta el encabezado PPK v2 RSA para que la fábrica real valide su contenido', async () => {
    const factories = crearFactories();
    const broker = crearBroker(factories);
    const llaveSintetica = [
      'PuTTY-User-Key-File-2: ssh-rsa',
      'Encryption: none',
      'Comment: fixture sintético',
      'Public-Lines: 1',
      'AA==',
      'Private-Lines: 1',
      'AA==',
      'Private-MAC: 0000000000000000000000000000000000000000',
    ].join('\n');
    const secretos = crearSecretosConLlave(llaveSintetica);

    const resultado = await broker.probar(
      { ...perfilDirecto, tipo: 'MYSQL_SSH', gatewaySshId: gateway.id },
      secretos,
    );

    expect(resultado.code).toBe('CONNECTED');
    expect(factories.tunelesCreados).toEqual([1]);
    expect([...secretos].every((byte) => byte === 0)).toBe(true);
  });

  it('rechaza el paquete cifrado lógico si falta el usuario MySQL', async () => {
    const factories = crearFactories();
    const broker = crearBroker(factories);
    const secretos = Buffer.from(
      JSON.stringify({ mysqlPassword: 'clave-sintetica-de-prueba' }),
      'utf8',
    );

    const resultado = await broker.probar(perfilDirecto, secretos);

    expect(resultado.code).toBe('INVALID_CREDENTIALS');
    expect(factories.mysqlDatos).toHaveLength(0);
    expect([...secretos].every((byte) => byte === 0)).toBe(true);
  });
});
