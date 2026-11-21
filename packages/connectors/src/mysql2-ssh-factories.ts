import { createHash, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { createConnection as abrirSocket, type Socket } from 'node:net';
import {
  createConnection as crearConexionMysql,
  type Connection,
  type ConnectionOptions,
} from 'mysql2/promise';
import type { Client as ClienteSsh2, ConnectConfig } from 'ssh2';
import type {
  AutenticacionSshPrueba,
  ConexionMySqlPrueba,
  DatosConexionMySql,
  DestinoMySqlPermitido,
  FabricaConexionMySql,
  FabricaTunelSsh,
  GatewaySshPermitido,
  TunelSshPrueba,
} from './mysql-connection-broker.js';

/** Carga la API CommonJS completa de ssh2 sin depender de exports ESM sintéticos. */
const cargarModuloCommonJs = createRequire(import.meta.url);
const ssh2 = cargarModuloCommonJs('ssh2') as typeof import('ssh2');
const { Client, utils } = ssh2;

/** Fábrica real de una conexión MySQL efímera con TLS obligatorio. */
export class FabricaConexionMysql2 implements FabricaConexionMySql {
  /** Abre el socket al IP fijado y valida el hostname del certificado TLS. */
  public async conectar(
    datos: DatosConexionMySql,
    senal: AbortSignal,
  ): Promise<ConexionMySqlPrueba> {
    const socket =
      datos.stream === undefined ? await abrirSocketTcpFijado(datos, senal) : datos.stream;
    const silenciarErrorTemprano = (): void => undefined;
    socket.on('error', silenciarErrorTemprano);
    const cancelar = (): void => {
      socket.destroy();
    };
    senal.addEventListener('abort', cancelar, { once: true });

    let conexion: Connection | undefined;
    try {
      conexion = await crearConexionMysql(crearOpcionesConexionMysql(datos, socket));
      socket.removeListener('error', silenciarErrorTemprano);
      if (senal.aborted) {
        conexion.destroy();
        throw new Error('MYSQL_CONNECTION_ABORTED');
      }

      let cerrada = false;
      const abortar = (): void => conexion?.destroy();
      senal.addEventListener('abort', abortar, { once: true });
      return {
        async consultar(consulta: 'SELECT 1'): Promise<void> {
          if (consulta !== 'SELECT 1') {
            throw new Error('MYSQL_QUERY_NOT_ALLOWED');
          }
          await conexion?.query('SELECT 1');
        },
        async cerrar(): Promise<void> {
          if (cerrada) {
            return;
          }
          cerrada = true;
          senal.removeEventListener('abort', abortar);
          senal.removeEventListener('abort', cancelar);
          try {
            await conexion?.end();
          } catch {
            conexion?.destroy();
          }
        },
        abortar,
      };
    } catch (error) {
      senal.removeEventListener('abort', cancelar);
      socket.removeListener('error', silenciarErrorTemprano);
      conexion?.destroy();
      socket.destroy();
      throw error;
    }
  }
}

/** Fábrica SSH que fija el gateway, verifica su host key y crea solo un forward MySQL. */
export class FabricaTunelSsh2 implements FabricaTunelSsh {
  /** Crea el adaptador SSH con un tiempo máximo de handshake acotado. */
  public constructor(private readonly tiempoHandshakeMs: number = 5_000) {
    if (
      !Number.isSafeInteger(tiempoHandshakeMs) ||
      tiempoHandshakeMs < 1 ||
      tiempoHandshakeMs > 15_000
    ) {
      throw new Error('SSH_CONNECTOR_POLICY_INVALID');
    }
  }

  /** Abre SSH con una sola identidad y hace forward al IP MySQL fijado. */
  public async abrir(
    gateway: GatewaySshPermitido,
    destino: DestinoMySqlPermitido,
    credencial: AutenticacionSshPrueba,
    senal: AbortSignal,
  ): Promise<TunelSshPrueba> {
    const configuracion = crearOpcionesConexionSsh(gateway, credencial, this.tiempoHandshakeMs);
    const cliente = await conectarClienteSsh(
      configuracion.opciones,
      configuracion.hostRechazado,
      senal,
    );
    const stream = await abrirForwardMySql(cliente, destino, senal);
    let cerrado = false;
    const abortar = (): void => {
      stream.destroy();
      cliente.end();
    };
    senal.addEventListener('abort', abortar, { once: true });

    return {
      stream,
      async cerrar(): Promise<void> {
        if (cerrado) {
          return;
        }
        cerrado = true;
        senal.removeEventListener('abort', abortar);
        stream.destroy();
        cliente.end();
      },
      abortar,
    };
  }
}

/** Construye opciones mysql2 con socket preconectado, TLS validado y capacidades mínimas. */
export function crearOpcionesConexionMysql(
  datos: DatosConexionMySql,
  stream: NodeJS.ReadWriteStream,
): ConnectionOptions {
  const ssl: NonNullable<ConnectionOptions['ssl']> = {
    ...datos.tls,
    rejectUnauthorized: true,
    verifyIdentity: true,
    minVersion: 'TLSv1.2',
  };
  return {
    host: datos.destino.hostname,
    port: datos.destino.port,
    user: datos.mysqlUsername,
    password: datos.mysqlPassword,
    database: datos.database,
    stream,
    ssl,
    connectTimeout: datos.timeoutMs,
    multipleStatements: false,
    flags: ['-LOCAL_FILES'],
    enableKeepAlive: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
  };
}

/** Compara la huella SHA-256 OpenSSH esperada con la llave pública recibida. */
export function coincideFingerprintSsh(claveHost: Buffer, esperado: string): boolean {
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/u.test(esperado)) {
    return false;
  }
  const huellaCalculada = createHash('sha256').update(claveHost).digest();
  const huellaEsperada = Buffer.from(esperado.slice('SHA256:'.length), 'base64');
  return (
    huellaCalculada.byteLength === huellaEsperada.byteLength &&
    timingSafeEqual(huellaCalculada, huellaEsperada)
  );
}

/** Crea la configuración SSH sin agente, teclado interactivo ni redirección de agente. */
function crearOpcionesConexionSsh(
  gateway: GatewaySshPermitido,
  credencial: AutenticacionSshPrueba,
  tiempoHandshakeMs: number,
): { readonly opciones: ConnectConfig; readonly hostRechazado: () => boolean } {
  const autenticacion = crearOpcionesClavePrivada(credencial);
  let hostRechazado = false;
  return {
    opciones: {
      host: gateway.address,
      port: gateway.port,
      username: credencial.username,
      ...autenticacion,
      hostVerifier: (claveHost: Buffer): boolean => {
        hostRechazado = !coincideFingerprintSsh(claveHost, gateway.fingerprint);
        return !hostRechazado;
      },
      readyTimeout: tiempoHandshakeMs,
      keepaliveInterval: 0,
      tryKeyboard: false,
    },
    hostRechazado: () => hostRechazado,
  };
}

/** Valida el formato de la llave privada antes de entregarla al cliente SSH2. */
function crearOpcionesClavePrivada(
  credencial: AutenticacionSshPrueba,
): Pick<ConnectConfig, 'privateKey' | 'passphrase'> {
  const esPem = /^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----\r?$/mu.test(credencial.privateKey);
  const esPpkV2Rsa = /^PuTTY-User-Key-File-2: ssh-rsa\r?\n/u.test(credencial.privateKey);
  if (!esPem && !esPpkV2Rsa) {
    throw new Error('SSH_KEY_FORMAT_UNSUPPORTED');
  }
  const llaveAnalizada = utils.parseKey(credencial.privateKey, credencial.passphrase);
  if (llaveAnalizada instanceof Error || !llaveAnalizada.isPrivateKey()) {
    throw new Error('SSH_KEY_INVALID');
  }
  return {
    privateKey: credencial.privateKey,
    ...(credencial.passphrase === undefined ? {} : { passphrase: credencial.passphrase }),
  };
}

/** Espera handshake SSH usando solo eventos y cancelación del broker. */
function conectarClienteSsh(
  configuracion: ConnectConfig,
  hostRechazado: () => boolean,
  senal: AbortSignal,
): Promise<ClienteSsh2> {
  if (senal.aborted) {
    return Promise.reject(new Error('SSH_CONNECTION_ABORTED'));
  }
  const cliente = new Client();
  return new Promise((resolver, rechazar) => {
    let resuelto = false;
    const finalizar = (): void => {
      senal.removeEventListener('abort', alAbortar);
      cliente.removeListener('ready', alListo);
    };
    const alError = (): void => {
      if (resuelto) {
        return;
      }
      resuelto = true;
      finalizar();
      cliente.end();
      rechazar(new Error(hostRechazado() ? 'SSH_HOST_KEY_REJECTED' : 'SSH_CONNECTION_FAILED'));
    };
    const alListo = (): void => {
      if (resuelto) {
        return;
      }
      resuelto = true;
      finalizar();
      resolver(cliente);
    };
    const alAbortar = (): void => {
      if (resuelto) {
        cliente.end();
        return;
      }
      resuelto = true;
      finalizar();
      cliente.end();
      rechazar(new Error('SSH_CONNECTION_ABORTED'));
    };

    cliente.on('error', alError);
    cliente.once('ready', alListo);
    senal.addEventListener('abort', alAbortar, { once: true });
    cliente.connect(configuracion);
  });
}

/** Abre exactamente un canal TCP SSH con el IP y puerto MySQL de la allowlist. */
function abrirForwardMySql(
  cliente: ClienteSsh2,
  destino: DestinoMySqlPermitido,
  senal: AbortSignal,
): Promise<import('node:stream').Duplex> {
  if (senal.aborted) {
    cliente.end();
    return Promise.reject(new Error('SSH_FORWARD_ABORTED'));
  }
  return new Promise((resolver, rechazar) => {
    let terminado = false;
    const alAbortar = (): void => {
      if (!terminado) {
        terminado = true;
        cliente.end();
        rechazar(new Error('SSH_FORWARD_ABORTED'));
      }
    };
    senal.addEventListener('abort', alAbortar, { once: true });
    cliente.forwardOut('127.0.0.1', 0, destino.address, destino.port, (error, canal) => {
      if (terminado) {
        canal?.destroy();
        return;
      }
      terminado = true;
      senal.removeEventListener('abort', alAbortar);
      if (error !== undefined || canal === undefined) {
        cliente.end();
        rechazar(new Error('SSH_FORWARD_FAILED'));
        return;
      }
      resolver(canal);
    });
  });
}

/** Abre socket TCP solo al IP ya resuelto y aprobado por la política del Portal. */
function abrirSocketTcpFijado(datos: DatosConexionMySql, senal: AbortSignal): Promise<Socket> {
  if (senal.aborted) {
    return Promise.reject(new Error('MYSQL_SOCKET_ABORTED'));
  }
  const socket = abrirSocket({ host: datos.destino.address, port: datos.destino.port });
  return new Promise((resolver, rechazar) => {
    let terminado = false;
    const timer = setTimeout(() => finalizar(new Error('MYSQL_SOCKET_TIMEOUT')), datos.timeoutMs);
    const limpiar = (): void => {
      clearTimeout(timer);
      socket.removeListener('connect', alConectar);
      socket.removeListener('error', alError);
      senal.removeEventListener('abort', alAbortar);
    };
    const finalizar = (error?: Error): void => {
      if (terminado) {
        return;
      }
      terminado = true;
      limpiar();
      if (error === undefined) {
        resolver(socket);
      } else {
        socket.destroy();
        rechazar(error);
      }
    };
    const alConectar = (): void => finalizar();
    const alError = (): void => finalizar(new Error('MYSQL_SOCKET_FAILED'));
    const alAbortar = (): void => finalizar(new Error('MYSQL_SOCKET_ABORTED'));

    socket.on('error', () => undefined);
    socket.once('connect', alConectar);
    socket.once('error', alError);
    senal.addEventListener('abort', alAbortar, { once: true });
  });
}
