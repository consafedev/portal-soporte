import { isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import type {
  ClientConnectionBroker,
  CodigoResultadoPruebaConexion,
  DestinoMySqlAutorizado,
  DestinoGatewaySsh,
  PerfilConexionPrueba,
  ResultadoPruebaConexion,
  SesionInsercionRf1,
  SesionLecturaRf1,
} from '../../core/src/clients/secret-custody-ports.js';
import { SesionMysqlRf1, type ConsultaFijaRf1 } from './mysql-rf1-catalog.js';
import {
  SesionInsercionMysqlRf1,
  type EjecutorTransaccionFacturaRf1,
} from './mysql-rf1-invoice-insert.js';

/** Destino MySQL fijo, con hostname TLS y dirección IP previamente aprobada. */
export type DestinoMySqlPermitido = DestinoMySqlAutorizado;

/** Gateway SSH fijo con dirección IP y fingerprint de host aprobados. */
export type GatewaySshPermitido = DestinoGatewaySsh;

/** Material TLS descifrado solo durante una prueba de conexión. */
export interface MaterialTlsConexion {
  /** CA privada opcional para validar la cadena del servidor. */
  readonly ca?: string;
  /** Certificado cliente opcional. */
  readonly cert?: string;
  /** Llave privada cliente opcional, emparejada con el certificado. */
  readonly key?: string;
}

/** Credencial SSH de llave privada o contraseña, mantenida en memoria solo durante la operación. */
export type AutenticacionSshPrueba =
  | {
      /** Cuenta del sistema remoto, limitada por longitud y caracteres de control. */
      readonly username: string;
      /** Modalidad de autenticación con material criptográfico local. */
      readonly authentication: 'PRIVATE_KEY';
      /** Llave privada PEM temporal, cifrada antes de persistir. */
      readonly privateKey: string;
      /** Passphrase opcional de una llave cifrada. */
      readonly passphrase?: string;
    }
  | {
      /** Cuenta del sistema remoto, limitada por longitud y caracteres de control. */
      readonly username: string;
      /** Modalidad de autenticación tradicional aceptada por Workbench. */
      readonly authentication: 'PASSWORD';
      /** Contraseña SSH cifrada antes de persistir y nunca devuelta por la API. */
      readonly password: string;
    };

/** Parámetros internos MySQL ya ligados a un destino fijo de la allowlist. */
export interface DatosConexionMySql {
  /** Destino resuelto desde configuración confiable, nunca desde el request. */
  readonly destino: DestinoMySqlPermitido;
  /** Base de datos seleccionada por ADMIN para el perfil. */
  readonly database: string;
  /** Nombre del usuario MySQL, omitido de logs y respuestas de prueba. */
  readonly mysqlUsername: string;
  /** Contraseña MySQL temporal descifrada en memoria. */
  readonly mysqlPassword: string;
  /** Material TLS temporal con validación de servidor obligatoria. */
  readonly tls: MaterialTlsConexion & { readonly rejectUnauthorized: true };
  /** Gateway SSH fijo si el perfil usa túnel. */
  readonly gateway?: GatewaySshPermitido;
  /** Canal SSH que conduce exclusivamente al destino MySQL permitido. */
  readonly stream?: Duplex;
  /** Timeout total máximo de la conexión. */
  readonly timeoutMs: number;
}

/** Consulta permitida por la conexión efímera; no expone ejecución SQL arbitraria. */
export interface ConexionMySqlPrueba {
  /** Ejecuta la consulta fija `SELECT 1` sin aceptar SQL del caller. */
  consultar(consulta: 'SELECT 1'): Promise<void>;
  /**
   * Ejecuta una de las lecturas RF-1 fijas con parámetros ligados.
   * @param consulta Identificador constante de consulta.
   * @param parametros Valores preparados sin concatenación.
   * @returns Filas obtenidas, limitadas por la consulta.
   */
  ejecutarRf1(
    consulta: ConsultaFijaRf1,
    parametros: readonly string[],
  ): Promise<readonly unknown[]>;
  /** Cierra la conexión MySQL al terminar la prueba. */
  cerrar(): Promise<void>;
  /** Interrumpe la conexión cuando se cancela o vence el timeout. */
  abortar(): void;
}

/** Extiende la conexión de lectura solo para el ejecutor transaccional RF-1. */
export interface ConexionMySqlTransaccionalRf1
  extends ConexionMySqlPrueba, EjecutorTransaccionFacturaRf1 {}

/** Crea una única conexión MySQL con TLS obligatorio o stream SSH previamente validado. */
export interface FabricaConexionMySql {
  /** Abre el socket al destino fijado y devuelve un recurso cerrable. */
  conectar(datos: DatosConexionMySql, senal: AbortSignal): Promise<ConexionMySqlPrueba>;
  /** Abre una conexión con sentencias transaccionales RF-1 fijas, si el driver las soporta. */
  conectarParaInsercion?(
    datos: DatosConexionMySql,
    senal: AbortSignal,
  ): Promise<ConexionMySqlTransaccionalRf1>;
}

/** Túnel TCP SSH sin shell ni forwarding a destinos distintos del permitido. */
export interface TunelSshPrueba {
  /** Canal Duplex dedicado al forward MySQL autorizado. */
  readonly stream: Duplex;
  /** Cierra el canal y la sesión SSH de forma ordenada. */
  cerrar(): Promise<void>;
  /** Interrumpe la sesión al vencer el timeout o cancelar la prueba. */
  abortar(): void;
}

/** Abre un único forward autenticado con fingerprint SSH y destino MySQL aprobados. */
export interface FabricaTunelSsh {
  /** Conecta al gateway y redirige exclusivamente al IP/puerto fijado de MySQL. */
  abrir(
    gateway: GatewaySshPermitido,
    destino: DestinoMySqlPermitido,
    credencial: AutenticacionSshPrueba,
    senal: AbortSignal,
  ): Promise<TunelSshPrueba>;
}

/** Mantiene destinos MySQL y gateways SSH fijos y validados, fuera de las peticiones. */
export class PoliticaDestinosConexion {
  private readonly destinosMySql: ReadonlyMap<string, DestinoMySqlPermitido>;
  private readonly gatewaysSsh: ReadonlyMap<string, GatewaySshPermitido>;

  /** Crea índices inmutables de destinos aprobados en configuración confiable. */
  public constructor(
    destinosMySql: readonly DestinoMySqlPermitido[],
    gatewaysSsh: readonly GatewaySshPermitido[],
  ) {
    validarDestinosUnicos(destinosMySql, gatewaysSsh);
    this.destinosMySql = new Map(
      destinosMySql.map((destino) => [destino.id, Object.freeze({ ...destino })]),
    );
    this.gatewaysSsh = new Map(
      gatewaysSsh.map((gateway) => [gateway.id, Object.freeze({ ...gateway })]),
    );
  }

  /** Devuelve un destino MySQL permitido por su identificador operacional. */
  public obtenerMySql(id: string): DestinoMySqlPermitido | undefined {
    return this.destinosMySql.get(id);
  }

  /** Devuelve un gateway SSH permitido por su identificador operacional. */
  public obtenerGatewaySsh(id: string): GatewaySshPermitido | undefined {
    return this.gatewaysSsh.get(id);
  }
}

/** Prueba acceso con sesión única, timeout, destinos fijados y cierre de recursos. */
export class ClientConnectionBrokerMySql implements ClientConnectionBroker {
  private ocupado = false;

  /** Crea el broker con una allowlist y factories de conexión inyectables. */
  public constructor(
    private readonly politica: PoliticaDestinosConexion,
    private readonly mysql: FabricaConexionMySql,
    private readonly ssh: FabricaTunelSsh,
    private readonly timeoutMs: number = 5_000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) {
      throw new Error('CONNECTOR_POLICY_INVALID');
    }
  }

  /**
   * Abre una sesión RF-1 de lectura usando un perfil y destino ya permitidos.
   * @param perfil Perfil validado por la política operacional.
   * @param secretos Buffer mutable de credenciales que se borra al abrir la conexión.
   * @param senalExterna Cancelación propagada al socket y al túnel SSH.
   * @returns Sesión de solo lectura que el llamador debe cerrar en finally.
   * @throws Error con un código estable si perfil, credenciales, destino o conexión no son válidos.
   */
  public async abrirLecturaRf1(
    perfil: PerfilConexionPrueba,
    secretos: Uint8Array,
    senalExterna: AbortSignal,
  ): Promise<SesionLecturaRf1> {
    const recurso = await this.abrirConexionRf1(perfil, secretos, senalExterna, (datos, senal) =>
      this.mysql.conectar(datos, senal),
    );
    return new SesionMysqlRf1(
      {
        ejecutar: (consulta: ConsultaFijaRf1, parametros: readonly string[]) =>
          recurso.conexion.ejecutarRf1(consulta, parametros),
      },
      recurso.cerrar,
      recurso.senal,
      this.timeoutMs,
      recurso.abortar,
    );
  }

  /**
   * Abre una sesión transaccional limitada a las sentencias RF-1 permitidas.
   * @param perfil Perfil activo ya autorizado y perteneciente al cliente.
   * @param secretos Buffer mutable descifrado que se borra durante la conexión.
   * @param senalExterna Cancelación de la operación autenticada.
   * @returns Sesión que inserta y verifica una factura por transacción.
   * @throws Error estable cuando el driver no admite inserciones o el destino no es válido.
   */
  public async abrirInsercionRf1(
    perfil: PerfilConexionPrueba,
    secretos: Uint8Array,
    senalExterna: AbortSignal,
  ): Promise<SesionInsercionRf1> {
    const conectar = this.mysql.conectarParaInsercion;
    if (conectar === undefined) {
      secretos.fill(0);
      throw new Error('RF1_INSERTION_UNAVAILABLE');
    }
    const recurso = await this.abrirConexionRf1(perfil, secretos, senalExterna, (datos, senal) =>
      conectar.call(this.mysql, datos, senal),
    );
    const ejecutor: EjecutorTransaccionFacturaRf1 = {
      iniciarTransaccion: () => recurso.conexion.iniciarTransaccion(),
      ejecutar: (consulta, parametros) => recurso.conexion.ejecutar(consulta, parametros),
      confirmarTransaccion: () => recurso.conexion.confirmarTransaccion(),
      revertirTransaccion: () => recurso.conexion.revertirTransaccion(),
      abortar: recurso.abortar,
      cerrar: recurso.cerrar,
    };
    return new SesionInsercionMysqlRf1(ejecutor, this.timeoutMs);
  }

  /**
   * Abre recursos de lectura o escritura mediante la misma política de red, TLS y SSH.
   * @param perfil Perfil activo cuyo destino está restringido por la allowlist del proceso.
   * @param secretos Buffer mutable de credenciales que se borra en todos los caminos de salida.
   * @param senalExterna Cancelación de la solicitud autenticada que controla socket y túnel.
   * @param conectar Factory específica de lectura o escritura con SQL permitido.
   * @returns Conexión tipada y operaciones de cancelación/cierre idempotentes.
   * @throws Error con código estable si falla perfil, destino, credenciales, SSH, TLS o conexión.
   * @effects Mantiene una sola sesión del broker y libera túnel, conexión y buffers al cerrar.
   */
  private async abrirConexionRf1<T extends ConexionMySqlPrueba>(
    perfil: PerfilConexionPrueba,
    secretos: Uint8Array,
    senalExterna: AbortSignal,
    conectar: (datos: DatosConexionMySql, senal: AbortSignal) => Promise<T>,
  ): Promise<{
    readonly conexion: T;
    readonly senal: AbortSignal;
    readonly abortar: () => void;
    readonly cerrar: () => Promise<void>;
  }> {
    const contenido = Buffer.from(secretos);
    secretos.fill(0);
    if (this.ocupado) {
      contenido.fill(0);
      throw new Error('CONNECTOR_BUSY');
    }
    this.ocupado = true;

    const controlador = new AbortController();
    const recursos: { conexion: T | null; tunel: TunelSshPrueba | null } = {
      conexion: null,
      tunel: null,
    };
    let temporizadorConexion: ReturnType<typeof setTimeout> | undefined;
    let temporizadorSesion: ReturnType<typeof setTimeout> | undefined;
    let conexionVencida = false;
    let etapa: 'SSH' | 'MYSQL' = 'MYSQL';
    let cierre: Promise<void> | null = null;
    const cancelarDesdeSolicitante = (): void => controlador.abort();

    const cerrar = (): Promise<void> => {
      if (cierre !== null) {
        return cierre;
      }
      cierre = (async (): Promise<void> => {
        if (temporizadorConexion !== undefined) clearTimeout(temporizadorConexion);
        if (temporizadorSesion !== undefined) clearTimeout(temporizadorSesion);
        senalExterna.removeEventListener('abort', cancelarDesdeSolicitante);
        controlador.abort();
        await recursos.conexion?.cerrar().catch(() => undefined);
        await recursos.tunel?.cerrar().catch(() => undefined);
        contenido.fill(0);
        this.ocupado = false;
      })();
      return cierre;
    };

    try {
      if (senalExterna.aborted) throw new Error('RF1_SESSION_ABORTED');
      senalExterna.addEventListener('abort', cancelarDesdeSolicitante, { once: true });
      if (!perfilValido(perfil) || contenido.byteLength > TAMANO_MAXIMO_SECRETOS) {
        throw new Error(
          contenido.byteLength > TAMANO_MAXIMO_SECRETOS ? 'INVALID_CREDENTIALS' : 'PROFILE_INVALID',
        );
      }

      const destino = this.politica.obtenerMySql(perfil.destinoMySqlId);
      const gateway =
        perfil.tipo === 'MYSQL_SSH' && perfil.gatewaySshId !== undefined
          ? this.politica.obtenerGatewaySsh(perfil.gatewaySshId)
          : undefined;
      if (destino === undefined || (perfil.tipo === 'MYSQL_SSH' && gateway === undefined)) {
        throw new Error('DESTINATION_NOT_ALLOWED');
      }

      const credenciales = analizarCredenciales(contenido, perfil.tipo);
      if (credenciales === null) throw new Error('INVALID_CREDENTIALS');
      if ('error' in credenciales) throw new Error(credenciales.error);

      const abrir = async (): Promise<void> => {
        let stream: Duplex | undefined;
        let gatewayUsado: GatewaySshPermitido | undefined;
        if (perfil.tipo === 'MYSQL_SSH') {
          if (gateway === undefined) throw new ErrorConectorPrueba('DESTINATION_NOT_ALLOWED');
          if (credenciales.ssh === null) throw new Error('INVALID_CREDENTIALS');
          etapa = 'SSH';
          gatewayUsado = gateway;
          recursos.tunel = await this.ssh.abrir(
            gateway,
            destino,
            credenciales.ssh,
            controlador.signal,
          );
          if (controlador.signal.aborted || cierre !== null) {
            await recursos.tunel.cerrar().catch(() => undefined);
            throw new Error('RF1_SESSION_ABORTED');
          }
          stream = recursos.tunel.stream;
        }
        etapa = 'MYSQL';
        recursos.conexion = await conectar(
          {
            destino,
            database: perfil.baseDatos,
            mysqlUsername: credenciales.mysqlUsername,
            mysqlPassword: credenciales.mysqlPassword,
            tls: { ...credenciales.tls, rejectUnauthorized: true },
            ...(gatewayUsado === undefined ? {} : { gateway: gatewayUsado }),
            ...(stream === undefined ? {} : { stream }),
            timeoutMs: this.timeoutMs,
          },
          controlador.signal,
        );
        if (controlador.signal.aborted || cierre !== null) {
          await recursos.conexion.cerrar().catch(() => undefined);
          throw new Error('RF1_SESSION_ABORTED');
        }
      };

      const plazoConexion = new Promise<never>((_, rechazar) => {
        temporizadorConexion = setTimeout(() => {
          conexionVencida = true;
          controlador.abort();
          rechazar(new Error('RF1_CONNECTION_TIMEOUT'));
        }, this.timeoutMs);
      });
      await Promise.race([abrir(), plazoConexion]);
      const conexion = recursos.conexion;
      if (senalExterna.aborted || controlador.signal.aborted || conexion === null) {
        throw new Error('RF1_SESSION_ABORTED');
      }
      if (temporizadorConexion !== undefined) {
        clearTimeout(temporizadorConexion);
        temporizadorConexion = undefined;
      }
      contenido.fill(0);
      temporizadorSesion = setTimeout(() => controlador.abort(), 15_000);
      return {
        conexion,
        senal: controlador.signal,
        abortar: cancelarDesdeSolicitante,
        cerrar,
      };
    } catch (error: unknown) {
      await cerrar();
      if (conexionVencida) throw new Error('RF1_CONNECTION_TIMEOUT');
      if (error instanceof Error && esCodigoErrorRf1(error.message)) throw new Error(error.message);
      throw new Error(clasificarFalloConector(error, etapa));
    }
  }
  /** Comprueba `SELECT 1`, redacta errores y borra el paquete de credenciales recibido. */
  public async probar(
    perfil: PerfilConexionPrueba,
    secretos: Uint8Array,
  ): Promise<ResultadoPruebaConexion> {
    const contenido = Buffer.from(secretos);
    secretos.fill(0);
    if (this.ocupado) {
      contenido.fill(0);
      return resultadoPrueba('CONNECTOR_BUSY');
    }
    this.ocupado = true;

    const controlador = new AbortController();
    const recursos: {
      conexion: ConexionMySqlPrueba | null;
      tunel: TunelSshPrueba | null;
    } = { conexion: null, tunel: null };
    let etapa: 'SSH' | 'MYSQL' = 'MYSQL';
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      if (!perfilValido(perfil) || contenido.byteLength > TAMANO_MAXIMO_SECRETOS) {
        return resultadoPrueba(
          contenido.byteLength > TAMANO_MAXIMO_SECRETOS ? 'INVALID_CREDENTIALS' : 'PROFILE_INVALID',
        );
      }

      const destino = this.politica.obtenerMySql(perfil.destinoMySqlId);
      const gateway =
        perfil.tipo === 'MYSQL_SSH' && perfil.gatewaySshId !== undefined
          ? this.politica.obtenerGatewaySsh(perfil.gatewaySshId)
          : undefined;
      if (destino === undefined || (perfil.tipo === 'MYSQL_SSH' && gateway === undefined)) {
        return resultadoPrueba('DESTINATION_NOT_ALLOWED');
      }
      const secretosValidos = analizarCredenciales(contenido, perfil.tipo);
      if (secretosValidos === null) {
        return resultadoPrueba('INVALID_CREDENTIALS');
      }
      if ('error' in secretosValidos) {
        return resultadoPrueba(secretosValidos.error);
      }

      let timeoutAlcanzado = false;
      const plazo = new Promise<never>((_, rechazar) => {
        timer = setTimeout(() => {
          timeoutAlcanzado = true;
          controlador.abort();
          rechazar(new Error('CONNECTOR_TIMEOUT'));
        }, this.timeoutMs);
      });
      const operacion = (async (): Promise<void> => {
        let stream: Duplex | undefined;
        let gatewayUsado: GatewaySshPermitido | undefined;
        if (perfil.tipo === 'MYSQL_SSH') {
          if (gateway === undefined) {
            throw new ErrorConectorPrueba('DESTINATION_NOT_ALLOWED');
          }
          if (secretosValidos.ssh === null) {
            throw new Error('INVALID_CREDENTIALS');
          }
          etapa = 'SSH';
          gatewayUsado = gateway;
          recursos.tunel = await this.ssh.abrir(
            gatewayUsado,
            destino,
            secretosValidos.ssh,
            controlador.signal,
          );
          stream = recursos.tunel.stream;
        }

        etapa = 'MYSQL';
        recursos.conexion = await this.mysql.conectar(
          {
            destino,
            database: perfil.baseDatos,
            mysqlUsername: secretosValidos.mysqlUsername,
            mysqlPassword: secretosValidos.mysqlPassword,
            tls: { ...secretosValidos.tls, rejectUnauthorized: true },
            ...(gatewayUsado === undefined ? {} : { gateway: gatewayUsado }),
            ...(stream === undefined ? {} : { stream }),
            timeoutMs: this.timeoutMs,
          },
          controlador.signal,
        );
        controlador.signal.addEventListener('abort', () => recursos.conexion?.abortar(), {
          once: true,
        });
        await recursos.conexion.consultar('SELECT 1');
      })();

      try {
        await Promise.race([operacion, plazo]);
        return resultadoPrueba('CONNECTED');
      } catch (error) {
        controlador.abort();
        if (timeoutAlcanzado) {
          return resultadoPrueba('CONNECTION_TIMEOUT');
        }
        return resultadoPrueba(clasificarFalloConector(error, etapa));
      }
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
      controlador.abort();
      await recursos.conexion?.cerrar().catch(() => undefined);
      await recursos.tunel?.cerrar().catch(() => undefined);
      contenido.fill(0);
      this.ocupado = false;
    }
  }
}

interface CredencialesConexionAnalizadas {
  /** Usuario MySQL protegido dentro del sobre, no persistido en metadatos. */
  readonly mysqlUsername: string;
  /** Contraseña MySQL en memoria durante la operación. */
  readonly mysqlPassword: string;
  /** CA y credencial TLS cliente opcionales, nunca devueltas al llamador. */
  readonly tls: MaterialTlsConexion;
  /** Credenciales SSH necesarias solo para MYSQL_SSH. */
  readonly ssh: AutenticacionSshPrueba | null;
}

/** Error de formato que el broker puede reportar sin exponer contenido del paquete secreto. */
interface ErrorAnalisisCredenciales {
  /** Resultado estable para una variante PPK que la fábrica no puede interpretar. */
  readonly error: 'SSH_KEY_FORMAT_UNSUPPORTED';
}

/** Identificador de configuración, host y subcadena permitidos para dispositivos del Portal. */
function validarDestinosUnicos(
  destinosMySql: readonly DestinoMySqlPermitido[],
  gatewaysSsh: readonly GatewaySshPermitido[],
): void {
  const ids = new Set<string>();
  for (const destino of destinosMySql) {
    if (ids.has(destino.id) || !destinoValido(destino)) {
      throw new Error('CONNECTOR_POLICY_INVALID');
    }
    ids.add(destino.id);
  }
  for (const gateway of gatewaysSsh) {
    if (ids.has(gateway.id) || !gatewayValido(gateway)) {
      throw new Error('CONNECTOR_POLICY_INVALID');
    }
    ids.add(gateway.id);
  }
}

/** Valida host, IP literal, puerto e identificador de un destino MySQL fijo. */
function destinoValido(destino: DestinoMySqlPermitido): boolean {
  return (
    IDENTIFICADOR_DESTINO.test(destino.id) &&
    hostValido(destino.hostname) &&
    isIP(destino.address) !== 0 &&
    Number.isSafeInteger(destino.port) &&
    destino.port >= 1 &&
    destino.port <= 65_535
  );
}

/** Exige además un fingerprint SHA-256 OpenSSH para cada gateway SSH. */
function gatewayValido(gateway: GatewaySshPermitido): boolean {
  return destinoValido(gateway) && /^SHA256:[A-Za-z0-9+/]{43}$/u.test(gateway.fingerprint);
}

/** Acepta un hostname DNS acotado o una IP literal sin usuario ni ruta. */
function hostValido(hostname: string): boolean {
  return (
    typeof hostname === 'string' &&
    hostname.length <= 253 &&
    isIP(hostname) === 0 &&
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(
      hostname,
    )
  );
}

/** Valida metadatos del perfil antes de resolver secretos o usar red. */
function perfilValido(perfil: PerfilConexionPrueba): boolean {
  return (
    typeof perfil === 'object' &&
    perfil !== null &&
    UUID_VALIDO.test(perfil.id) &&
    UUID_VALIDO.test(perfil.clientId) &&
    (perfil.tipo === 'MYSQL_TCP' || perfil.tipo === 'MYSQL_SSH') &&
    IDENTIFICADOR_DESTINO.test(perfil.destinoMySqlId) &&
    (perfil.tipo === 'MYSQL_SSH'
      ? perfil.gatewaySshId !== undefined && IDENTIFICADOR_DESTINO.test(perfil.gatewaySshId)
      : perfil.gatewaySshId === undefined) &&
    /^[A-Za-z0-9_$-]{1,64}$/u.test(perfil.baseDatos)
  );
}

/** Decodifica un paquete JSON limitado y rechaza campos inesperados o combinaciones inválidas. */
function analizarCredenciales(
  contenido: Buffer,
  tipo: PerfilConexionPrueba['tipo'],
): CredencialesConexionAnalizadas | ErrorAnalisisCredenciales | null {
  try {
    const documento: unknown = JSON.parse(contenido.toString('utf8'));
    if (
      !objetoEstricto(
        documento,
        ['mysqlUsername', 'mysqlPassword'],
        ['mysqlUsername', 'mysqlPassword', 'tls', 'ssh'],
      ) ||
      typeof documento['mysqlUsername'] !== 'string' ||
      !/^[A-Za-z0-9_.@-]{1,128}$/u.test(documento['mysqlUsername']) ||
      !textoSecretoValido(documento['mysqlPassword'], 4_096)
    ) {
      return null;
    }
    const tls = analizarTls(documento['tls']);
    if (tls === null) {
      return null;
    }
    const ssh = analizarAutenticacionSsh(documento['ssh']);
    if (ssh === 'SSH_KEY_FORMAT_UNSUPPORTED') {
      return { error: ssh };
    }
    if (
      (tipo === 'MYSQL_SSH' && ssh === null) ||
      (tipo === 'MYSQL_TCP' && documento['ssh'] !== undefined)
    ) {
      return null;
    }

    return {
      mysqlUsername: documento['mysqlUsername'],
      mysqlPassword: documento['mysqlPassword'],
      tls,
      ssh,
    };
  } catch {
    return null;
  }
}

/** Analiza el paquete TLS y exige que certificado y llave cliente aparezcan juntos. */
function analizarTls(valor: unknown): MaterialTlsConexion | null {
  if (valor === undefined) {
    return {};
  }
  if (!objetoEstricto(valor, [], ['ca', 'cert', 'key'])) {
    return null;
  }
  const ca = valor['ca'];
  const cert = valor['cert'];
  const key = valor['key'];
  if (
    (ca !== undefined && !textoSecretoValido(ca, 16_384)) ||
    (cert !== undefined && !textoSecretoValido(cert, 16_384)) ||
    (key !== undefined && !textoSecretoValido(key, 16_384)) ||
    (cert === undefined) !== (key === undefined)
  ) {
    return null;
  }
  return {
    ...(ca === undefined ? {} : { ca }),
    ...(cert === undefined ? {} : { cert }),
    ...(key === undefined ? {} : { key }),
  };
}

/** Valida una única modalidad SSH sin aceptar agente, comandos ni campos no declarados. */
function analizarAutenticacionSsh(
  valor: unknown,
): AutenticacionSshPrueba | 'SSH_KEY_FORMAT_UNSUPPORTED' | null {
  if (valor === undefined) {
    return null;
  }
  if (
    !esObjeto(valor) ||
    typeof valor['username'] !== 'string' ||
    !/^\S.{0,127}$/u.test(valor['username'])
  ) {
    return null;
  }
  if (valor['authentication'] === 'PASSWORD') {
    if (
      !objetoEstricto(
        valor,
        ['username', 'authentication', 'password'],
        ['username', 'authentication', 'password'],
      ) ||
      !textoSecretoValido(valor['password'], 4_096)
    ) {
      return null;
    }
    return {
      username: valor['username'],
      authentication: 'PASSWORD',
      password: valor['password'],
    };
  }
  if (valor['authentication'] === 'PRIVATE_KEY') {
    const llavePrivada = valor['privateKey'];
    if (
      typeof llavePrivada === 'string' &&
      llavePrivada.startsWith('PuTTY-User-Key-File-') &&
      !/^PuTTY-User-Key-File-2: ssh-rsa\r?\n/u.test(llavePrivada)
    ) {
      return 'SSH_KEY_FORMAT_UNSUPPORTED';
    }
    if (
      !objetoEstricto(
        valor,
        ['username', 'authentication', 'privateKey'],
        ['username', 'authentication', 'privateKey', 'passphrase'],
      ) ||
      !textoSecretoValido(llavePrivada, 16_384) ||
      !esLlavePrivadaCompatible(llavePrivada) ||
      (valor['passphrase'] !== undefined && !textoSecretoValido(valor['passphrase'], 1_024))
    ) {
      return null;
    }
    return {
      username: valor['username'],
      authentication: 'PRIVATE_KEY',
      privateKey: llavePrivada,
      ...(valor['passphrase'] === undefined ? {} : { passphrase: valor['passphrase'] }),
    };
  }
  return null;
}

/** Acepta llaves PEM/OpenSSH o PPK v2 RSA para su validación criptográfica posterior. */
function esLlavePrivadaCompatible(valor: unknown): valor is string {
  return (
    typeof valor === 'string' &&
    (/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----\r?$/mu.test(valor) ||
      /^PuTTY-User-Key-File-2: ssh-rsa\r?\n/u.test(valor))
  );
}

/** Clasifica fallos sin copiar mensajes de drivers, hosts ni credenciales. */
function clasificarFalloConector(
  error: unknown,
  etapa: 'SSH' | 'MYSQL',
): CodigoResultadoPruebaConexion {
  if (error instanceof ErrorConectorPrueba) {
    return error.code;
  }
  if (etapa === 'SSH') {
    if (error instanceof Error && error.message === 'SSH_HOST_KEY_REJECTED') {
      return 'SSH_HOST_KEY_REJECTED';
    }
    if (error instanceof Error && error.message === 'SSH_KEY_FORMAT_UNSUPPORTED') {
      return 'SSH_KEY_FORMAT_UNSUPPORTED';
    }
    if (error instanceof Error && error.message === 'SSH_KEY_INVALID') {
      return 'SSH_KEY_INVALID';
    }
    return 'SSH_CONNECTION_FAILED';
  }
  const codigoDriver = leerCodigoDriver(error);
  if (
    codigoDriver === 'ER_ACCESS_DENIED_ERROR' ||
    codigoDriver === 'ER_DBACCESS_DENIED_ERROR' ||
    codigoDriver === 'ER_NOT_SUPPORTED_AUTH_MODE' ||
    codigoDriver === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR'
  ) {
    return 'MYSQL_AUTHENTICATION_FAILED';
  }
  if (
    codigoDriver === 'HANDSHAKE_SSL_ERROR' ||
    codigoDriver === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    codigoDriver === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    codigoDriver.startsWith('ERR_TLS_') ||
    codigoDriver.startsWith('ERR_SSL_') ||
    codigoDriver.startsWith('ERR_OSSL_') ||
    codigoDriver.startsWith('CERT_')
  ) {
    return 'MYSQL_TLS_FAILED';
  }
  return 'MYSQL_CONNECTION_FAILED';
}

/**
 * Reconoce códigos internos sanitizados que pueden salir del broker RF-1.
 * @param codigo Mensaje de error ya reducido a un código estable.
 * @returns Si el código puede propagarse sin revelar detalles operativos.
 */
function esCodigoErrorRf1(codigo: string): boolean {
  return [
    'CONNECTOR_BUSY',
    'PROFILE_INVALID',
    'DESTINATION_NOT_ALLOWED',
    'INVALID_CREDENTIALS',
    'SSH_KEY_FORMAT_UNSUPPORTED',
    'RF1_SESSION_ABORTED',
    'RF1_CONNECTION_TIMEOUT',
  ].includes(codigo);
}

/** Lee únicamente el identificador estable de un error de driver sin conservar su mensaje. */
function leerCodigoDriver(error: unknown): string {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error) ||
    typeof error.code !== 'string'
  ) {
    return '';
  }
  return error.code;
}

/** Construye la respuesta de prueba con instante del servidor y código sanitizado. */
function resultadoPrueba(code: CodigoResultadoPruebaConexion): ResultadoPruebaConexion {
  return { code, completedAt: new Date() };
}

/** Comprueba que el valor sea un objeto JSON con solo propiedades permitidas. */
function objetoEstricto(
  valor: unknown,
  requeridas: readonly string[],
  permitidas: readonly string[],
): valor is Record<string, unknown> {
  return (
    esObjeto(valor) &&
    requeridas.every((campo) => Object.hasOwn(valor, campo)) &&
    Object.keys(valor).every((campo) => permitidas.includes(campo))
  );
}

/** Valida secretos de texto acotados y sin caracteres de control no imprimibles. */
function textoSecretoValido(valor: unknown, maximo: number): valor is string {
  return (
    typeof valor === 'string' &&
    valor.length > 0 &&
    valor.length <= maximo &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(valor)
  );
}

/** Distingue objetos JSON de arrays, nulos y valores primitivos. */
function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Error local con código fijo que el broker puede traducir sin divulgar la causa. */
class ErrorConectorPrueba extends Error {
  /** Construye un error interno estable y libre de valores de la conexión. */
  public constructor(public readonly code: CodigoResultadoPruebaConexion) {
    super(code);
  }
}

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IDENTIFICADOR_DESTINO = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const TAMANO_MAXIMO_SECRETOS = 65_536;
