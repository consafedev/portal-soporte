import { createHash, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { createConnection as abrirSocket, type Socket } from 'node:net';
import {
  createConnection as crearConexionMysql,
  type Connection,
  type ConnectionOptions,
} from 'mysql2/promise';
import { getCACertificates } from 'node:tls';
import type { Client as ClienteSsh2, ConnectConfig } from 'ssh2';
import type {
  AutenticacionSshPrueba,
  ConexionMySqlPrueba,
  ConexionMySqlTransaccionalRf1,
  DatosConexionMySql,
  DestinoMySqlPermitido,
  FabricaConexionMySql,
  FabricaTunelSsh,
  GatewaySshPermitido,
  TunelSshPrueba,
} from './mysql-connection-broker.js';
import type { ConsultaFijaRf1 } from './mysql-rf1-catalog.js';
import {
  esConsultaFacturaRf1Permitida,
  type ConsultaFacturaRf1,
  type ResultadoConsultaFacturaRf1,
} from './mysql-rf1-invoice-insert.js';

/** Carga la API CommonJS completa de ssh2 sin depender de exports ESM sintéticos. */
const cargarModuloCommonJs = createRequire(import.meta.url);
const ssh2 = cargarModuloCommonJs('ssh2') as typeof import('ssh2');
const { Client, utils } = ssh2;

/** Fábrica real MySQL efímera con validación TLS y raíces CA adicionales opcionales. */
export class FabricaConexionMysql2 implements FabricaConexionMySql {
  /** Bundle CA operacional adicional, combinado con raíces Node y CA del perfil. */
  private readonly caAdicional: string | undefined;

  /**
   * Crea la fábrica con un bundle adicional de autoridades confiables para MySQL.
   *
   * @param caAdicional Bundle PEM de CA adicionales; nunca desactiva verificación de identidad.
   */
  public constructor(caAdicional?: string) {
    this.caAdicional = caAdicional;
  }

  /** Abre el socket al IP fijado y valida el hostname del certificado TLS. */
  public async conectar(
    datos: DatosConexionMySql,
    senal: AbortSignal,
  ): Promise<ConexionMySqlPrueba> {
    return this.conectarInterno(datos, senal);
  }

  /** Abre una conexión transaccional RF-1 que requiere autorización en una capa superior. */
  public async conectarParaInsercion(
    datos: DatosConexionMySql,
    senal: AbortSignal,
  ): Promise<ConexionMySqlTransaccionalRf1> {
    return this.conectarInterno(datos, senal);
  }

  /** Construye recursos compartidos y aplica límites de SQL y transacción. */
  private async conectarInterno(
    datos: DatosConexionMySql,
    senal: AbortSignal,
  ): Promise<ConexionMySqlTransaccionalRf1> {
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
      conexion = await crearConexionMysql(
        crearOpcionesConexionMysql(datos, socket, this.caAdicional),
      );
      socket.removeListener('error', silenciarErrorTemprano);
      if (senal.aborted) {
        conexion.destroy();
        throw new Error('MYSQL_CONNECTION_ABORTED');
      }

      let cerrada = false;
      let transaccionActiva = false;
      const abortar = (): void => conexion?.destroy();
      senal.addEventListener('abort', abortar, { once: true });
      return {
        async consultar(consulta: 'SELECT 1'): Promise<void> {
          if (consulta !== 'SELECT 1') {
            throw new Error('MYSQL_QUERY_NOT_ALLOWED');
          }
          await conexion?.query('SELECT 1');
        },
        /**
         * Ejecuta una sentencia RF-1 preparada de la lista estática.
         * @param consulta Sentencia constante autorizada.
         * @param parametros Valores ligados por mysql2.
         * @returns Filas del conjunto de resultados, sin forma controlable por el usuario.
         * @throws Error con código constante si la consulta no pertenece al conjunto aprobado.
         */
        async ejecutarRf1(
          consulta: ConsultaFijaRf1,
          parametros: readonly string[],
        ): Promise<readonly unknown[]> {
          if (!consultaRf1Permitida(consulta, parametros.length)) {
            throw new Error('MYSQL_QUERY_NOT_ALLOWED');
          }
          const [filas] = await conexion!.execute(consulta, [...parametros]);
          return Array.isArray(filas) ? (filas as readonly unknown[]) : [];
        },
        async iniciarTransaccion(): Promise<void> {
          if (cerrada || transaccionActiva) {
            throw new Error('RF1_TRANSACTION_STATE_INVALID');
          }
          await conexion!.beginTransaction();
          transaccionActiva = true;
        },
        /** Ejecuta únicamente SQL fijo de catálogo, UUID, inserción y verificación RF-1. */
        async ejecutar(
          consulta: ConsultaFacturaRf1,
          parametros: readonly (string | null)[],
        ): Promise<ResultadoConsultaFacturaRf1> {
          const lecturaVerificacionPosterior =
            consulta ===
            'SELECT uuid, sociedad, estatus, totalFAC, creadoPor FROM factura WHERE uuid = ? LIMIT 1';
          if (
            cerrada ||
            (!transaccionActiva && !lecturaVerificacionPosterior) ||
            !esConsultaFacturaRf1Permitida(consulta, parametros.length)
          ) {
            throw new Error('MYSQL_QUERY_NOT_ALLOWED');
          }
          const [resultado] = await conexion!.execute(consulta, [...parametros]);
          if (Array.isArray(resultado)) {
            return { rows: resultado as readonly unknown[], affectedRows: 0 };
          }
          const affectedRows =
            typeof resultado === 'object' && resultado !== null && 'affectedRows' in resultado
              ? resultado.affectedRows
              : 0;
          return {
            rows: [],
            affectedRows: typeof affectedRows === 'number' ? affectedRows : 0,
          };
        },
        async confirmarTransaccion(): Promise<void> {
          if (cerrada || !transaccionActiva) {
            throw new Error('RF1_TRANSACTION_STATE_INVALID');
          }
          try {
            await conexion!.commit();
            transaccionActiva = false;
          } catch {
            throw new Error('RF1_COMMIT_FAILED');
          }
        },
        async revertirTransaccion(): Promise<void> {
          if (!transaccionActiva) {
            return;
          }
          try {
            await conexion!.rollback();
            transaccionActiva = false;
          } catch {
            throw new Error('RF1_ROLLBACK_FAILED');
          }
        },
        async cerrar(): Promise<void> {
          if (cerrada) {
            return;
          }
          cerrada = true;
          senal.removeEventListener('abort', abortar);
          senal.removeEventListener('abort', cancelar);
          if (transaccionActiva) {
            try {
              await conexion?.rollback();
              transaccionActiva = false;
            } catch {
              conexion?.destroy();
            }
          }
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

/**
 * Rechaza cualquier consulta o cantidad de parámetros ajena al catálogo RF-1 fijo.
 * @param consulta Identificador constante de la consulta.
 * @param cantidadParametros Cantidad de valores enlazados por la sesión.
 * @returns Si consulta y aridad pertenecen al conjunto aprobado.
 */
function consultaRf1Permitida(consulta: ConsultaFijaRf1, cantidadParametros: number): boolean {
  return (
    (consulta === 'SELECT sociedad, ambienteSap FROM sap_sociedad WHERE rfc = ? LIMIT 101' &&
      cantidadParametros === 1) ||
    (consulta ===
      'SELECT idProveedor FROM sap_proveedor WHERE rfc = ? AND sociedad = ? AND ambienteSap = ? LIMIT 2' &&
      cantidadParametros === 3) ||
    (consulta === 'SELECT 1 AS encontrado FROM factura WHERE uuid = ? LIMIT 1' &&
      cantidadParametros === 1)
  );
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

/**
 * Construye opciones mysql2 con socket preconectado y TLS obligatorio.
 *
 * @param datos Destino fijado, credenciales temporales y material TLS del perfil.
 * @param stream Socket TCP fijado o forward SSH previamente validado.
 * @param caAdicional Bundle CA operativo que se combina con las raíces estándar y del perfil.
 * @returns Opciones limitadas de mysql2 con hostname, TLS y SQL múltiple controlados.
 */
export function crearOpcionesConexionMysql(
  datos: DatosConexionMySql,
  stream: NodeJS.ReadWriteStream,
  caAdicional?: string,
): ConnectionOptions {
  const ca = combinarAutoridadesCertificadoras(datos.tls.ca, caAdicional);
  const ssl: NonNullable<ConnectionOptions['ssl']> = {
    ...datos.tls,
    ...(ca === undefined ? {} : { ca }),
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

/**
 * Combina las raíces habituales con CA del Portal y CA específica del perfil si existen.
 *
 * @param caPerfil Bundle CA proporcionado para este perfil, si existe.
 * @param caAdicional Bundle CA confiable configurado para el conector MySQL, si existe.
 * @returns Cadena PEM original o lista de raíces combinadas para Node TLS.
 */
function combinarAutoridadesCertificadoras(
  caPerfil: string | undefined,
  caAdicional: string | undefined,
): string | string[] | undefined {
  if (caAdicional === undefined) {
    return caPerfil;
  }
  return [...getCACertificates(), caAdicional, ...(caPerfil === undefined ? [] : [caPerfil])];
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
  const autenticacion = crearOpcionesAutenticacionSsh(credencial);
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

/** Convierte la modalidad validada en opciones SSH sin activar agente ni teclado interactivo.
 * @param credencial Material SSH ya validado por el broker y descifrado para esta operación.
 * @returns Solo los campos de autenticación requeridos por ssh2.
 */
export function crearOpcionesAutenticacionSsh(
  credencial: AutenticacionSshPrueba,
): Pick<ConnectConfig, 'privateKey' | 'passphrase' | 'password'> {
  if (credencial.authentication === 'PASSWORD') {
    return { password: credencial.password };
  }
  return crearOpcionesClavePrivada(credencial);
}

/** Valida el formato de la llave privada antes de entregarla al cliente SSH2. */
function crearOpcionesClavePrivada(
  credencial: Extract<AutenticacionSshPrueba, { readonly authentication: 'PRIVATE_KEY' }>,
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
