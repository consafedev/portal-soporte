import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ClientConnectionBrokerMySql,
  FabricaConexionMysql2,
  FabricaTunelSsh2,
  PoliticaDestinosConexion,
  SesionInsercionMysqlRf1,
} from '../../packages/connectors/src/index.js';
import type {
  CodigoResultadoPruebaConexion,
  DestinoGatewaySsh,
  DestinoMySqlAutorizado,
  PerfilConexionPrueba,
} from '../../packages/core/src/clients/secret-custody-ports.js';
import type { DatosConexionMySql } from '../../packages/connectors/src/mysql-connection-broker.js';
import type { EntradaMapeoFacturaRf1 } from '../../packages/connectors/src/mysql-rf1-invoice-mapper.js';

interface ConfiguracionFixtureMysql {
  /** Host y puerto de loopback publicados para la conexión TLS directa. */
  readonly mysqlHostPort: number;
  /** Dirección IPv4 del servidor MySQL dentro de la red efímera Docker. */
  readonly mysqlContainerAddress: string;
  /** Nombre, usuario y contraseña sintéticos creados para esta ejecución. */
  readonly database: string;
  readonly username: string;
  readonly password: string;
  /** Rutas efímeras a CA y llaves cliente RSA PEM/PPK de la gateway. */
  readonly caPath: string;
  readonly pemPrivateKeyPath: string;
  readonly ppkPrivateKeyPath: string;
  /** Puerto loopback y huella del host SSH creados durante la ejecución. */
  readonly sshPort: number;
  readonly sshFingerprint: string;
}

const rutaConfiguracion = process.env['PORTAL_MYSQL_FIXTURE_CONFIG'];
if (rutaConfiguracion === undefined) {
  throw new Error('MYSQL_FIXTURE_CONFIGURATION_REQUIRED');
}

const configuracion = JSON.parse(
  readFileSync(rutaConfiguracion, 'utf8'),
) as ConfiguracionFixtureMysql;
const hostMysql = 'mysql.fixture.invalid';
const idDestino = 'mysql_fixture';
const idGateway = 'ssh_fixture';
const gatewayFixture: DestinoGatewaySsh = {
  id: idGateway,
  hostname: 'ssh.fixture.invalid',
  address: '127.0.0.1',
  port: configuracion.sshPort,
  fingerprint: configuracion.sshFingerprint,
};
const perfilBase: PerfilConexionPrueba = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  clientId: '550e8400-e29b-41d4-a716-446655440002',
  tipo: 'MYSQL_TCP',
  destinoMySqlId: idDestino,
  baseDatos: configuracion.database,
};

let servidorSinRespuesta: Server | undefined;

/** Acepta conexiones locales sin emitir protocolo para validar el timeout del broker. */
async function iniciarServidorSinRespuesta(): Promise<number> {
  servidorSinRespuesta = createServer((socket) => {
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolver, rechazar) => {
    servidorSinRespuesta?.once('error', rechazar);
    servidorSinRespuesta?.listen(0, '127.0.0.1', () => resolver());
  });
  const direccion = servidorSinRespuesta.address();
  if (direccion === null || typeof direccion === 'string') {
    throw new Error('MYSQL_FIXTURE_TIMEOUT_LISTENER_UNAVAILABLE');
  }
  return direccion.port;
}

/** Construye el broker real con destino fijo y, cuando aplica, gateway SSH fijada. */
function crearBroker(
  opciones: {
    readonly destino?: DestinoMySqlAutorizado;
    readonly gateway?: DestinoGatewaySsh;
    readonly tiempoMaximoMs?: number;
  } = {},
  perfil: PerfilConexionPrueba = perfilBase,
): ClientConnectionBrokerMySql {
  const usaTunelSsh = perfil.tipo === 'MYSQL_SSH';
  const destino: DestinoMySqlAutorizado = opciones.destino ?? {
    id: idDestino,
    hostname: hostMysql,
    address: usaTunelSsh ? configuracion.mysqlContainerAddress : '127.0.0.1',
    port: usaTunelSsh ? 3306 : configuracion.mysqlHostPort,
  };
  const gateway: DestinoGatewaySsh = opciones.gateway ?? gatewayFixture;
  return new ClientConnectionBrokerMySql(
    new PoliticaDestinosConexion([destino], [gateway]),
    new FabricaConexionMysql2(),
    new FabricaTunelSsh2(),
    opciones.tiempoMaximoMs ?? 5_000,
  );
}

/** Crea un paquete secreto exclusivamente sintético y nunca registra su contenido. */
function crearCredenciales(
  opciones: {
    readonly password?: string;
    readonly ca?: string;
    readonly privateKey?: string;
    readonly ssh?: boolean;
  } = {},
): Buffer {
  const credenciales = {
    mysqlUsername: configuracion.username,
    mysqlPassword: opciones.password ?? configuracion.password,
    tls: { ca: opciones.ca ?? readFileSync(configuracion.caPath, 'utf8') },
    ...(opciones.ssh
      ? {
          ssh: {
            username: 'fixture',
            authentication: 'PRIVATE_KEY',
            privateKey:
              opciones.privateKey ?? readFileSync(configuracion.pemPrivateKeyPath, 'utf8'),
          },
        }
      : {}),
  };
  return Buffer.from(JSON.stringify(credenciales), 'utf8');
}

/** Ejecuta una conexión real y espera su código de resultado sanitizado. */
async function probarConexion(
  perfil: PerfilConexionPrueba = perfilBase,
  credenciales: Buffer = crearCredenciales(),
  broker: ClientConnectionBrokerMySql = crearBroker({}, perfil),
): Promise<{ readonly code: CodigoResultadoPruebaConexion; readonly secretos: Buffer }> {
  const resultado = await broker.probar(perfil, credenciales);
  return { code: resultado.code, secretos: credenciales };
}

/** Ejecuta las lecturas RF-1 contra el catálogo exclusivamente sintético del fixture. */
async function probarLecturasRf1(perfil: PerfilConexionPrueba): Promise<void> {
  const secretos = crearCredenciales({ ssh: perfil.tipo === 'MYSQL_SSH' });
  const broker = crearBroker({}, perfil);
  const sesion = await broker.abrirLecturaRf1(perfil, secretos, new AbortController().signal);
  try {
    const sociedades = await sesion.buscarSociedadesPorRfc(' xaxx010101000 ');
    expect(sociedades).toHaveLength(2);
    expect(new Set(sociedades.map((fila) => `${fila.sociedad}:${fila.ambienteSap}`))).toEqual(
      new Set(['1000:E1P', '2000:OPE']),
    );
    await expect(
      sesion.buscarProveedoresPorContexto('xaxx010101000', '1000', 'e1p'),
    ).resolves.toEqual([{ idProveedor: 'PROV000001' }]);
    await expect(
      sesion.buscarProveedoresPorContexto('XAXX010101000', '2000', 'OPE'),
    ).resolves.toEqual([{ idProveedor: 'PROV000002' }]);
    await expect(
      sesion.buscarProveedoresPorContexto('COSC8001137NA', '1000', 'E1P'),
    ).resolves.toEqual([{ idProveedor: 'PROV000003' }, { idProveedor: 'PROV000004' }]);
    await expect(
      sesion.buscarProveedoresPorContexto('AAA010101AAA', '1000', 'E1P'),
    ).resolves.toEqual([{ idProveedor: 'PROV000005' }]);
    await expect(sesion.existeUuid('550e8400-e29b-41d4-a716-446655440001')).resolves.toBe(true);
    await expect(sesion.existeUuid('550e8400-e29b-41d4-a716-446655440002')).resolves.toBe(false);
  } finally {
    await sesion.cerrar();
  }
  expect([...secretos].every((byte) => byte === 0)).toBe(true);
}

/** Abre una sesión transaccional contra el único servidor MySQL sintético del fixture. */
async function abrirSesionInsercionRf1(): Promise<SesionInsercionMysqlRf1> {
  const datos: DatosConexionMySql = {
    destino: {
      id: idDestino,
      hostname: hostMysql,
      address: '127.0.0.1',
      port: configuracion.mysqlHostPort,
    },
    database: configuracion.database,
    mysqlUsername: configuracion.username,
    mysqlPassword: configuracion.password,
    tls: {
      ca: readFileSync(configuracion.caPath, 'utf8'),
      rejectUnauthorized: true,
    },
    timeoutMs: 5_000,
  };
  const conexion = await new FabricaConexionMysql2().conectarParaInsercion(
    datos,
    new AbortController().signal,
  );
  return new SesionInsercionMysqlRf1(conexion, 5_000);
}

/** Crea entrada fiscal sintética sin archivos XML ni datos de clientes reales. */
function crearEntradaInsercionRf1(
  uuid: string,
  estatus: 'CONTABILIZADO' | 'PAGADA',
): EntradaMapeoFacturaRf1 {
  return {
    factura: {
      uuid,
      rfcEmisor: 'AAA010101AAA',
      rfcReceptor: 'XAXX010101000',
      fecha: '2025-06-07T23:30:00-06:00',
      subtotal: '1250.50',
      descuento: '0',
      moneda: 'MXN',
      total: '1450.58',
      referencia: 'AB-120',
      tipoComprobante: 'I',
      importeIvaFAC: '200.08',
      retencionIsr: '0',
      retencionIva: '0',
      retencionIeps: '0',
      serie: 'AB-',
      folio: '120',
      metodoPago: 'PUE',
      formaPago: '03',
    },
    resolution: { sociedad: '1000', ambienteSap: 'E1P', idProveedor: 'PROV000005' },
    estatus,
    fechaCarga: new Date('2026-11-22T07:00:00.000Z'),
    documentos: { documentoContable: null, entradaMercancia: null, ordenCompra: null },
  };
}

/** Verifica un UUID mediante la ruta RF-1 de solo lectura y cierra la conexión. */
async function existeUuidEnFixture(uuid: string): Promise<boolean> {
  const secretos = crearCredenciales();
  const broker = crearBroker();
  const sesion = await broker.abrirLecturaRf1(perfilBase, secretos, new AbortController().signal);
  try {
    return await sesion.existeUuid(uuid);
  } finally {
    await sesion.cerrar();
  }
}

/** Verifica selectivo TCP/TLS directo, credenciales erróneas y validación de CA. */
async function probarTcpTlsDirecto(): Promise<void> {
  const correcto = await probarConexion();
  expect(correcto.code).toBe('CONNECTED');
  expect([...correcto.secretos].every((byte) => byte === 0)).toBe(true);

  const credencialesInvalidas = await probarConexion(
    perfilBase,
    crearCredenciales({ password: 'credencial-sintetica-incorrecta' }),
  );
  expect(credencialesInvalidas.code).toBe('MYSQL_AUTHENTICATION_FAILED');
  expect([...credencialesInvalidas.secretos].every((byte) => byte === 0)).toBe(true);

  const caInvalida = await probarConexion(
    perfilBase,
    crearCredenciales({
      ca: '-----BEGIN CERTIFICATE-----\nCA inválida\n-----END CERTIFICATE-----',
    }),
  );
  expect(caInvalida.code).toBe('MYSQL_TLS_FAILED');
  expect([...caInvalida.secretos].every((byte) => byte === 0)).toBe(true);
}

/** Verifica el forward SSH y MySQL TLS con una llave PEM sintética y huella fijada. */
async function probarTunelPem(): Promise<void> {
  const perfil: PerfilConexionPrueba = {
    ...perfilBase,
    tipo: 'MYSQL_SSH',
    gatewaySshId: idGateway,
  };
  const resultado = await probarConexion(perfil, crearCredenciales({ ssh: true }));
  expect(resultado.code).toBe('CONNECTED');
  expect([...resultado.secretos].every((byte) => byte === 0)).toBe(true);
}

/** Verifica interoperabilidad SSH end-to-end con una llave PPK v2 RSA sintética. */
async function probarTunelPpk(): Promise<void> {
  const perfil: PerfilConexionPrueba = {
    ...perfilBase,
    tipo: 'MYSQL_SSH',
    gatewaySshId: idGateway,
  };
  const llavePpk = readFileSync(configuracion.ppkPrivateKeyPath, 'utf8');
  expect(llavePpk.startsWith('PuTTY-User-Key-File-2: ssh-rsa\n')).toBe(true);
  const resultado = await probarConexion(
    perfil,
    crearCredenciales({ ssh: true, privateKey: llavePpk }),
  );
  expect(resultado.code).toBe('CONNECTED');
  expect([...resultado.secretos].every((byte) => byte === 0)).toBe(true);
}

/** Rechaza una huella no coincidente y un destino que no pertenece a la política fijada. */
async function rechazarHuellaYDestino(): Promise<void> {
  const perfil: PerfilConexionPrueba = {
    ...perfilBase,
    tipo: 'MYSQL_SSH',
    gatewaySshId: idGateway,
  };
  const huellaIncorrecta = `SHA256:${'A'.repeat(43)}`;
  const resultadoHuella = await probarConexion(
    perfil,
    crearCredenciales({ ssh: true }),
    crearBroker({ gateway: { ...gatewayFixture, fingerprint: huellaIncorrecta } }, perfil),
  );
  expect(resultadoHuella.code).toBe('SSH_HOST_KEY_REJECTED');

  const resultadoDestino = await probarConexion(
    { ...perfilBase, destinoMySqlId: 'no_autorizado' },
    crearCredenciales(),
  );
  expect(resultadoDestino.code).toBe('DESTINATION_NOT_ALLOWED');
}

/** Comprueba que la gateway SSH niega un puerto distinto al único MySQL permitido. */
async function rechazarPuertoNoPermitido(): Promise<void> {
  const llave = readFileSync(configuracion.pemPrivateKeyPath, 'utf8');
  const destinoNoPermitido: DestinoMySqlAutorizado = {
    id: idDestino,
    hostname: hostMysql,
    address: configuracion.mysqlContainerAddress,
    port: 3307,
  };
  const credencialSsh = {
    username: 'fixture',
    authentication: 'PRIVATE_KEY' as const,
    privateKey: llave,
  };

  await expect(
    new FabricaTunelSsh2().abrir(
      gatewayFixture,
      destinoNoPermitido,
      credencialSsh,
      new AbortController().signal,
    ),
  ).rejects.toThrow('SSH_FORWARD_FAILED');
}

/** Repite conexiones SSH para demostrar que el broker libera recursos entre operaciones. */
async function reusarTunelTrasCerrarRecursos(): Promise<void> {
  const perfil: PerfilConexionPrueba = {
    ...perfilBase,
    tipo: 'MYSQL_SSH',
    gatewaySshId: idGateway,
  };
  for (let intento = 0; intento < 3; intento += 1) {
    const resultado = await probarConexion(perfil, crearCredenciales({ ssh: true }));
    expect(resultado.code).toBe('CONNECTED');
    expect([...resultado.secretos].every((byte) => byte === 0)).toBe(true);
  }
}

/** Expira una conexión aceptada que nunca completa el saludo MySQL y verifica su aborto. */
async function expirarConexionSinSaludoMysql(): Promise<void> {
  const puerto = await iniciarServidorSinRespuesta();
  const destino: DestinoMySqlAutorizado = {
    id: idDestino,
    hostname: hostMysql,
    address: '127.0.0.1',
    port: puerto,
  };
  const resultado = await probarConexion(
    perfilBase,
    crearCredenciales(),
    crearBroker({ destino, tiempoMaximoMs: 1_000 }),
  );
  expect(resultado.code).toBe('CONNECTION_TIMEOUT');
  expect([...resultado.secretos].every((byte) => byte === 0)).toBe(true);
}

/** Inserta estados aprobados, detecta duplicados concurrentes y confirma rollback sintético. */
async function probarInsercionTransaccionalSintetica(): Promise<void> {
  const pagada = await abrirSesionInsercionRf1();
  try {
    await expect(
      pagada.insertar(crearEntradaInsercionRf1('550E8400-E29B-41D4-A716-446655440002', 'PAGADA')),
    ).resolves.toEqual({ status: 'INSERTADA_VERIFICADA' });
    await expect(
      pagada.insertar(crearEntradaInsercionRf1('550E8400-E29B-41D4-A716-446655440002', 'PAGADA')),
    ).resolves.toEqual({ status: 'YA_EXISTE' });
  } finally {
    await pagada.cerrar();
  }

  const contabilizado = await abrirSesionInsercionRf1();
  try {
    await expect(
      contabilizado.insertar(
        crearEntradaInsercionRf1('550E8400-E29B-41D4-A716-446655440003', 'CONTABILIZADO'),
      ),
    ).resolves.toEqual({ status: 'INSERTADA_VERIFICADA' });
  } finally {
    await contabilizado.cerrar();
  }

  const concurrentes = await Promise.all([abrirSesionInsercionRf1(), abrirSesionInsercionRf1()]);
  try {
    const resultados = await Promise.all(
      concurrentes.map((sesion) =>
        sesion.insertar(crearEntradaInsercionRf1('550E8400-E29B-41D4-A716-446655440005', 'PAGADA')),
      ),
    );
    expect(resultados.map((resultado) => resultado.status).sort()).toEqual([
      'INSERTADA_VERIFICADA',
      'YA_EXISTE',
    ]);
  } finally {
    await Promise.all(concurrentes.map((sesion) => sesion.cerrar()));
  }

  const rollback = await abrirSesionInsercionRf1();
  try {
    await expect(
      rollback.insertar(
        crearEntradaInsercionRf1('550E8400-E29B-41D4-A716-446655440004', 'CONTABILIZADO'),
      ),
    ).resolves.toEqual({ status: 'ERROR_REVERTIDO' });
  } finally {
    await rollback.cerrar();
  }
  await expect(existeUuidEnFixture('550E8400-E29B-41D4-A716-446655440004')).resolves.toBe(false);
}

/** Cierra el listener local del caso de timeout al terminar la suite aislada. */
async function cerrarServidorSinRespuesta(): Promise<void> {
  if (servidorSinRespuesta === undefined) {
    return;
  }
  await new Promise<void>((resolver, rechazar) => {
    servidorSinRespuesta?.close((error) => (error ? rechazar(error) : resolver()));
  });
}

describe('conector MySQL real con servicios sintéticos efímeros', () => {
  beforeAll(() => {
    expect(configuracion.database).toBe('portal_fixture');
    expect(configuracion.username).toBe('portal_fixture_app');
  });
  afterAll(cerrarServidorSinRespuesta);

  it(
    'ejecuta SELECT 1 con TCP/TLS y falla de forma controlada con CA o credenciales inválidas',
    probarTcpTlsDirecto,
  );
  it('resuelve catálogos RF-1 con TCP/TLS y cuenta MySQL de solo lectura', async () => {
    await probarLecturasRf1(perfilBase);
  });
  it('ejecuta SELECT 1 por SSH y TLS con llave PEM', probarTunelPem);
  it('resuelve catálogos RF-1 a través de SSH y TLS', async () => {
    await probarLecturasRf1({ ...perfilBase, tipo: 'MYSQL_SSH', gatewaySshId: idGateway });
  });
  it('ejecuta SELECT 1 por SSH y TLS con llave PPK v2 RSA', probarTunelPpk);
  it('rechaza fingerprint SSH incorrecta y destinos fuera de allowlist', rechazarHuellaYDestino);
  it(
    'rechaza puertos no permitidos aunque el cliente solicite un forward',
    rechazarPuertoNoPermitido,
  );
  it('libera recursos y acepta conexiones SSH sucesivas', reusarTunelTrasCerrarRecursos);
  it('aborta por timeout un servidor sin saludo MySQL', expirarConexionSinSaludoMysql);
  it(
    'inserta sintéticos por transacción, detecta duplicados concurrentes y revierte errores',
    probarInsercionTransaccionalSintetica,
  );
});
