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
import {
  PoliticaDireccionesDestino,
  type ResolverDireccionesDestino,
} from '../../packages/connectors/src/network-destination-policy.js';
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
const perfilDirectoAutoservicio: PerfilConexionPrueba = {
  ...perfilDirecto,
  destinoMySql: { hostname: 'mysql.autoservicio.test', port: 3306 },
};
const perfilSshAutoservicio: PerfilConexionPrueba = {
  ...perfilDirectoAutoservicio,
  tipo: 'MYSQL_SSH',
  gatewaySshId: gateway.id,
  gatewaySsh: {
    hostname: 'ssh.autoservicio.test',
    port: 22,
    fingerprint: gateway.fingerprint,
  },
};

describe('PoliticaDestinosConexion', () => {
  it('resuelve destinos por hostname y puerto visibles en el formulario', () => {
    const politica = new PoliticaDestinosConexion([destino], [gateway]);

    expect(politica.buscarMySql('DB.TEST.INVALID', 3306)?.id).toBe(destino.id);
    expect(politica.buscarMySql('db.test.invalid', 3307)).toBeUndefined();
    expect(politica.buscarGatewaySsh('SSH.TEST.INVALID', 22)?.id).toBe(gateway.id);
    expect(politica.buscarGatewaySsh('ssh.test.invalid', 2222)).toBeUndefined();
  });

  it('rechaza endpoints ambiguos en lugar de elegir una IP operacional', () => {
    const destinoDuplicado = { ...destino, id: 'otro-id-interno', address: '192.0.2.99' };
    const politica = new PoliticaDestinosConexion([destino, destinoDuplicado], []);

    expect(politica.buscarMySql('db.test.invalid', 3306)).toBeUndefined();
  });
});

/** Construye factories que registran únicamente datos sintéticos y el SQL fijo del broker. */
function crearFactories(
  consulta: () => Promise<void> = async () => undefined,
  falloConexion?: Error,
  falloSsh?: Error,
): {
  readonly mysql: FabricaConexionMySql;
  readonly ssh: FabricaTunelSsh;
  readonly mysqlDatos: DatosConexionMySql[];
  readonly consultas: string[];
  readonly consultasRf1: { readonly sql: string; readonly parametros: readonly string[] }[];
  readonly tunelesCreados: number[];
  readonly destinosSsh: {
    readonly gateway: DestinoGatewaySsh;
    readonly destino: DatosConexionMySql['destino'];
  }[];
  readonly cierresMySql: number[];
  readonly cierresSsh: number[];
} {
  const mysqlDatos: DatosConexionMySql[] = [];
  const consultas: string[] = [];
  const consultasRf1: { readonly sql: string; readonly parametros: readonly string[] }[] = [];
  const tunelesCreados: number[] = [];
  const destinosSsh: {
    readonly gateway: DestinoGatewaySsh;
    readonly destino: DatosConexionMySql['destino'];
  }[] = [];
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
        async ejecutarRf1(consulta, parametros): Promise<readonly unknown[]> {
          consultasRf1.push({ sql: consulta, parametros });
          return consulta.includes('factura') ? [{ encontrado: 1 }] : [];
        },
        async cerrar(): Promise<void> {
          cierresMySql.push(1);
        },
        abortar(): void {},
      };
    },
  };
  const ssh: FabricaTunelSsh = {
    async abrir(gatewayUsado, destinoUsado): Promise<TunelSshPrueba> {
      if (falloSsh !== undefined) {
        throw falloSsh;
      }
      tunelesCreados.push(1);
      destinosSsh.push({ gateway: gatewayUsado, destino: destinoUsado });
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

  return {
    mysql,
    ssh,
    mysqlDatos,
    consultas,
    consultasRf1,
    tunelesCreados,
    destinosSsh,
    cierresMySql,
    cierresSsh,
  };
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

/** Compone el broker de autoservicio con DNS sintético y un fallback legacy aislado. */
function crearBrokerAutoservicio(
  factories: ReturnType<typeof crearFactories>,
  resolver: ResolverDireccionesDestino,
  timeoutDnsMs: number = 100,
  destinosLegacy: readonly (typeof destino)[] = [destino],
  gatewaysLegacy: readonly DestinoGatewaySsh[] = [gateway],
): ClientConnectionBrokerMySql {
  return new ClientConnectionBrokerMySql(
    new PoliticaDestinosConexion(destinosLegacy, gatewaysLegacy),
    factories.mysql,
    factories.ssh,
    100,
    new PoliticaDireccionesDestino({ resolver, timeoutMs: timeoutDnsMs }),
  );
}

/** Crea un resolver controlado que nunca consulta DNS externo durante las pruebas. */
function crearResolverPorHost(
  respuestas: Readonly<Record<string, readonly string[]>>,
): ResolverDireccionesDestino {
  return {
    async resolver(hostname): Promise<readonly string[]> {
      return respuestas[hostname] ?? [];
    },
  };
}

describe('ClientConnectionBrokerMySql', () => {
  it('conecta por un endpoint del perfil aunque no exista en la allowlist operacional', async () => {
    const factories = crearFactories();
    const resolver = crearResolverPorHost({ 'mysql.autoservicio.test': ['93.184.216.34'] });
    const broker = crearBrokerAutoservicio(factories, resolver, 100, [], []);

    const resultado = await broker.probar(perfilDirectoAutoservicio, crearSecretos());

    expect(resultado.code).toBe('CONNECTED');
    expect(factories.mysqlDatos[0]?.destino).toMatchObject({
      hostname: 'mysql.autoservicio.test',
      address: '93.184.216.34',
      port: 3306,
    });
    expect(factories.mysqlDatos[0]?.destino.hostname).toBe('mysql.autoservicio.test');
    expect(factories.mysqlDatos[0]?.tls).toEqual({
      ca: 'CERTIFICADO CA SINTÉTICO',
      rejectUnauthorized: true,
    });
    expect(factories.consultas).toEqual(['SELECT 1']);
  });

  it('rechaza IP privada directa antes de abrir sockets', async () => {
    const factories = crearFactories();
    const resolver = crearResolverPorHost({ 'mysql.autoservicio.test': ['10.22.0.8'] });
    const broker = crearBrokerAutoservicio(factories, resolver);
    const secretos = crearSecretos();

    const resultado = await broker.probar(perfilDirectoAutoservicio, secretos);

    expect(resultado.code).toBe('DESTINATION_NOT_ALLOWED');
    expect(factories.mysqlDatos).toHaveLength(0);
    expect(factories.consultas).toHaveLength(0);
    expect([...secretos].every((byte) => byte === 0)).toBe(true);
  });

  it('rechaza una respuesta DNS mixta antes de abrir sockets', async () => {
    const factories = crearFactories();
    const resolver = crearResolverPorHost({
      'mysql.autoservicio.test': ['93.184.216.34', '127.0.0.1'],
    });
    const broker = crearBrokerAutoservicio(factories, resolver);

    const resultado = await broker.probar(perfilDirectoAutoservicio, crearSecretos());

    expect(resultado.code).toBe('DESTINATION_NOT_ALLOWED');
    expect(factories.mysqlDatos).toHaveLength(0);
  });

  it('vuelve a resolver el perfil en cada prueba y bloquea un cambio de DNS a IP privada', async () => {
    const factories = crearFactories();
    const respuestas = [['93.184.216.34'], ['10.22.0.8']];
    let intentos = 0;
    const resolver: ResolverDireccionesDestino = {
      async resolver(): Promise<readonly string[]> {
        const respuesta = respuestas[intentos];
        intentos += 1;
        return respuesta ?? [];
      },
    };
    const broker = crearBrokerAutoservicio(factories, resolver);

    const primera = await broker.probar(perfilDirectoAutoservicio, crearSecretos());
    const segunda = await broker.probar(perfilDirectoAutoservicio, crearSecretos());

    expect(primera.code).toBe('CONNECTED');
    expect(segunda.code).toBe('DESTINATION_NOT_ALLOWED');
    expect(intentos).toBe(2);
    expect(factories.mysqlDatos).toHaveLength(1);
  });

  it('falla de forma acotada ante un timeout DNS sin abrir sockets', async () => {
    const factories = crearFactories();
    const resolver: ResolverDireccionesDestino = {
      resolver: async () => new Promise<readonly string[]>(() => undefined),
    };
    const broker = crearBrokerAutoservicio(factories, resolver, 5);

    const resultado = await broker.probar(perfilDirectoAutoservicio, crearSecretos());

    expect(resultado.code).toBe('DESTINATION_NOT_ALLOWED');
    expect(factories.mysqlDatos).toHaveLength(0);
  });

  it('rechaza gateway SSH no público o fingerprint inválida antes de abrir el túnel', async () => {
    for (const respuesta of [
      { hosts: { 'ssh.autoservicio.test': ['192.168.1.10'] }, fingerprint: gateway.fingerprint },
      { hosts: { 'ssh.autoservicio.test': ['1.1.1.1'] }, fingerprint: 'SHA256:invalida' },
    ]) {
      const factories = crearFactories();
      const resolver = crearResolverPorHost({
        'mysql.autoservicio.test': ['93.184.216.34'],
        ...respuesta.hosts,
      });
      const broker = crearBrokerAutoservicio(factories, resolver);

      const resultado = await broker.probar(
        {
          ...perfilSshAutoservicio,
          gatewaySsh: { ...perfilSshAutoservicio.gatewaySsh!, fingerprint: respuesta.fingerprint },
        },
        crearSecretos(true),
      );

      expect(resultado.code).toBe('DESTINATION_NOT_ALLOWED');
      expect(factories.tunelesCreados).toHaveLength(0);
      expect(factories.mysqlDatos).toHaveLength(0);
    }
  });

  it('rechaza targets metadata y link-local antes del forward SSH', async () => {
    for (const address of ['169.254.169.254', '169.254.0.9']) {
      const factories = crearFactories();
      const resolver = crearResolverPorHost({ 'mysql.autoservicio.test': [address] });
      const broker = crearBrokerAutoservicio(factories, resolver);

      const resultado = await broker.probar(perfilSshAutoservicio, crearSecretos(true));

      expect(resultado.code).toBe('DESTINATION_NOT_ALLOWED');
      expect(factories.tunelesCreados).toHaveLength(0);
      expect(factories.mysqlDatos).toHaveLength(0);
    }
  });

  it('no abre MySQL cuando la fábrica SSH rechaza la fingerprint del gateway', async () => {
    const factories = crearFactories(
      async () => undefined,
      undefined,
      new Error('SSH_HOST_KEY_REJECTED'),
    );
    const resolver = crearResolverPorHost({
      'mysql.autoservicio.test': ['10.20.30.40'],
      'ssh.autoservicio.test': ['1.1.1.1'],
    });
    const broker = crearBrokerAutoservicio(factories, resolver);

    const resultado = await broker.probar(perfilSshAutoservicio, crearSecretos(true));

    expect(resultado.code).toBe('SSH_HOST_KEY_REJECTED');
    expect(factories.destinosSsh).toHaveLength(0);
    expect(factories.mysqlDatos).toHaveLength(0);
  });

  it('fija el endpoint del perfil antes de abrir la sesión de lectura RF-1', async () => {
    const factories = crearFactories();
    const resolver = crearResolverPorHost({ 'mysql.autoservicio.test': ['93.184.216.34'] });
    const broker = crearBrokerAutoservicio(factories, resolver);

    const sesion = await broker.abrirLecturaRf1(
      perfilDirectoAutoservicio,
      crearSecretos(),
      new AbortController().signal,
    );
    const existe = await sesion.existeUuid('550e8400-e29b-41d4-a716-446655440001');
    await sesion.cerrar();

    expect(existe).toBe(true);
    expect(factories.mysqlDatos[0]?.destino.address).toBe('93.184.216.34');
    expect(factories.consultasRf1).toHaveLength(1);
    expect(factories.cierresMySql).toEqual([1]);
  });

  it('rechaza el endpoint inseguro antes de abrir la sesión de lectura RF-1', async () => {
    const factories = crearFactories();
    const resolver = crearResolverPorHost({ 'mysql.autoservicio.test': ['127.0.0.1'] });
    const broker = crearBrokerAutoservicio(factories, resolver);
    const secretos = crearSecretos();

    await expect(
      broker.abrirLecturaRf1(perfilDirectoAutoservicio, secretos, new AbortController().signal),
    ).rejects.toThrow('DESTINATION_NOT_ALLOWED');

    expect(factories.mysqlDatos).toHaveLength(0);
    expect(factories.consultasRf1).toHaveLength(0);
    expect([...secretos].every((byte) => byte === 0)).toBe(true);
  });

  it('permite target loopback/RFC1918 solo dentro del forward SSH del perfil', async () => {
    for (const address of ['127.0.0.1', '10.20.30.40']) {
      const factories = crearFactories();
      const resolver = crearResolverPorHost({
        'mysql.autoservicio.test': [address],
        'ssh.autoservicio.test': ['1.1.1.1'],
      });
      const broker = crearBrokerAutoservicio(factories, resolver);

      const resultado = await broker.probar(perfilSshAutoservicio, crearSecretos(true));

      expect(resultado.code).toBe('CONNECTED');
      expect(factories.destinosSsh[0]?.destino.address).toBe(address);
      expect(factories.tunelesCreados).toHaveLength(1);
    }
  });

  it('abre sesión RF-1 tipada, borra el paquete de entrada y libera recursos al cerrar', async () => {
    const factories = crearFactories();
    const secretos = crearSecretos();
    const broker = crearBroker(factories);

    const sesion = await broker.abrirLecturaRf1(
      perfilDirecto,
      secretos,
      new AbortController().signal,
    );
    const existe = await sesion.existeUuid('550e8400-e29b-41d4-a716-446655440001');
    await sesion.cerrar();

    expect(existe).toBe(true);
    expect(factories.consultasRf1).toEqual([
      {
        sql: 'SELECT 1 AS encontrado FROM factura WHERE uuid = ? LIMIT 1',
        parametros: ['550E8400-E29B-41D4-A716-446655440001'],
      },
    ]);
    expect(factories.cierresMySql).toEqual([1]);
    expect([...secretos].every((byte) => byte === 0)).toBe(true);
  });

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

  it('acepta contraseña SSH sin exponerla y distingue un PPK fuera de formato', async () => {
    const factories = crearFactories();
    const broker = crearBroker(factories);
    const paquetes = [
      {
        ssh: {
          username: 'ssh_sintetico',
          authentication: 'PASSWORD',
          password: 'secreto-sintetico',
        },
        code: 'CONNECTED',
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
      expect(JSON.stringify(resultado)).not.toContain('secreto-sintetico');
      expect([...secretos].every((byte) => byte === 0)).toBe(true);
    }
    expect(factories.tunelesCreados).toHaveLength(1);
    expect(factories.mysqlDatos).toHaveLength(1);
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
