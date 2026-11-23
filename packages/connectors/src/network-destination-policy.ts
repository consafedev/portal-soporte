import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import type { EndpointConexionAdmin } from '../../contracts/src/clients.js';

/** Código estable que puede traducir la API sin incluir hostnames ni direcciones. */
export type CodigoErrorPoliticaDestino =
  'DESTINATION_INVALID' | 'DESTINATION_UNSAFE' | 'DNS_RESOLUTION_FAILED';

/** Error sanitizado de validación o resolución de destinos de conexión. */
export class ErrorPoliticaDestino extends Error {
  /** Código estable sin valores recibidos del usuario ni detalles del resolver. */
  public readonly code: CodigoErrorPoliticaDestino;

  /** Construye un error público que no incluye el endpoint ni el error de red original. */
  public constructor(code: CodigoErrorPoliticaDestino) {
    super(code);
    this.name = 'ErrorPoliticaDestino';
    this.code = code;
  }
}

/** Resuelve un hostname usando el sistema DNS del host y verifica la señal de cancelación. */
export interface ResolverDireccionesDestino {
  /** Devuelve todas las direcciones A/AAAA conocidas para un hostname. */
  resolver(hostname: string, senal: AbortSignal): Promise<readonly string[]>;
}

/** Hostname TLS original y dirección numérica fijada para una única conexión. */
export interface DireccionConexionFijada {
  /** Hostname canónico usado para SNI y verificación de identidad TLS. */
  readonly hostname: string;
  /** Dirección IPv4 o IPv6 validada que recibirá el socket, sin nueva resolución DNS. */
  readonly address: string;
  /** Puerto TCP ya validado en el perfil. */
  readonly port: number;
}

/** Opciones acotadas de resolución; se inyectan para pruebas sintéticas. */
export interface OpcionesPoliticaDireccionesDestino {
  /** Resolver DNS que se consultará una sola vez por endpoint e intento. */
  readonly resolver?: ResolverDireccionesDestino;
  /** Tiempo máximo de espera por DNS, limitado por el propio servicio. */
  readonly timeoutMs?: number;
  /** Cantidad máxima de respuestas DNS aceptadas antes de validar sus direcciones. */
  readonly maxDirecciones?: number;
}

const TIEMPO_MAXIMO_DNS_MS = 5_000;
const MAXIMO_DIRECCIONES_DNS = 16;
const PATRON_FINGERPRINT_SHA256 = /^SHA256:[A-Za-z0-9+/]{43}$/u;

/** Valida destinos MySQL directos, gateways SSH y targets protegidos por un túnel. */
export class PoliticaDireccionesDestino {
  private readonly resolver: ResolverDireccionesDestino;
  private readonly timeoutMs: number;
  private readonly maxDirecciones: number;

  /** Crea una política con DNS del sistema y límites seguros o un resolver de prueba. */
  public constructor(opciones: OpcionesPoliticaDireccionesDestino = {}) {
    this.resolver = opciones.resolver ?? new ResolverDireccionesNodo();
    this.timeoutMs = limitarEntero(
      opciones.timeoutMs,
      TIEMPO_MAXIMO_DNS_MS,
      1,
      TIEMPO_MAXIMO_DNS_MS,
    );
    this.maxDirecciones = limitarEntero(
      opciones.maxDirecciones,
      MAXIMO_DIRECCIONES_DNS,
      1,
      MAXIMO_DIRECCIONES_DNS,
    );
  }

  /** Resuelve y fija un destino MySQL directo solo si todas sus IP son públicas. */
  public fijarMySqlDirecto(
    endpoint: EndpointConexionAdmin,
    senal: AbortSignal,
  ): Promise<DireccionConexionFijada> {
    return this.fijarEndpoint(endpoint, senal, 'PUBLIC');
  }

  /** Valida el pin SSH y fija un gateway que resuelva exclusivamente a IP pública. */
  public fijarGatewaySsh(
    endpoint: EndpointConexionAdmin,
    huella: string,
    senal: AbortSignal,
  ): Promise<DireccionConexionFijada> {
    if (!PATRON_FINGERPRINT_SHA256.test(huella)) {
      return Promise.reject(new ErrorPoliticaDestino('DESTINATION_INVALID'));
    }
    return this.fijarEndpoint(endpoint, senal, 'PUBLIC');
  }

  /** Fija el target MySQL del perfil para el único forward SSH configurado. */
  public fijarMySqlEnTunel(
    endpoint: EndpointConexionAdmin,
    senal: AbortSignal,
  ): Promise<DireccionConexionFijada> {
    return this.fijarEndpoint(endpoint, senal, 'TUNNEL');
  }

  /** Normaliza un endpoint, valida DNS/IP y devuelve la primera dirección validada. */
  private async fijarEndpoint(
    endpoint: EndpointConexionAdmin,
    senal: AbortSignal,
    alcance: 'PUBLIC' | 'TUNNEL',
  ): Promise<DireccionConexionFijada> {
    const normalizado = normalizarEndpoint(endpoint);
    const version = isIP(normalizado.hostname);
    const respuestas =
      version === 0
        ? await this.resolverConLimite(normalizado.hostname, senal)
        : [normalizado.hostname];

    if (respuestas.length === 0 || respuestas.length > this.maxDirecciones) {
      throw new ErrorPoliticaDestino(
        respuestas.length === 0 ? 'DNS_RESOLUTION_FAILED' : 'DESTINATION_UNSAFE',
      );
    }

    const direcciones = respuestas.map(normalizarDireccionIp);
    const clasificadas = direcciones.map(clasificarDireccionIp);
    const permitidas = clasificadas.every((clasificacion) =>
      alcance === 'PUBLIC'
        ? clasificacion === 'PUBLIC'
        : clasificacion === 'PUBLIC' || clasificacion === 'PRIVATE' || clasificacion === 'LOOPBACK',
    );
    if (!permitidas) {
      throw new ErrorPoliticaDestino('DESTINATION_UNSAFE');
    }

    return Object.freeze({
      hostname: normalizado.hostname,
      address: direcciones[0]!,
      port: normalizado.port,
    });
  }

  /** Resuelve con límite de tiempo y una señal local cancelable sin revelar errores DNS. */
  private async resolverConLimite(
    hostname: string,
    senal: AbortSignal,
  ): Promise<readonly string[]> {
    if (senal.aborted) {
      throw new ErrorPoliticaDestino('DNS_RESOLUTION_FAILED');
    }

    const controlador = new AbortController();
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    let quitarAbort: (() => void) | undefined;
    const abortada = new Promise<never>((_resolver, rechazar) => {
      const cancelar = (): void => {
        controlador.abort();
        rechazar(new ErrorPoliticaDestino('DNS_RESOLUTION_FAILED'));
      };
      senal.addEventListener('abort', cancelar, { once: true });
      quitarAbort = () => senal.removeEventListener('abort', cancelar);
      temporizador = setTimeout(cancelar, this.timeoutMs);
    });

    try {
      return await Promise.race([this.resolver.resolver(hostname, controlador.signal), abortada]);
    } catch {
      throw new ErrorPoliticaDestino('DNS_RESOLUTION_FAILED');
    } finally {
      if (temporizador !== undefined) {
        clearTimeout(temporizador);
      }
      quitarAbort?.();
    }
  }
}

/** Implementa la interfaz con el resolver del sistema y consulta A/AAAA en una llamada. */
class ResolverDireccionesNodo implements ResolverDireccionesDestino {
  /** Obtiene todas las direcciones del sistema y comprueba cancelación antes y después de lookup. */
  public async resolver(hostname: string, senal: AbortSignal): Promise<readonly string[]> {
    if (senal.aborted) {
      throw new Error('DNS_CANCELLED');
    }
    const resultados = await lookup(hostname, { all: true, verbatim: true });
    if (senal.aborted) {
      throw new Error('DNS_CANCELLED');
    }
    return resultados.map((resultado) => resultado.address);
  }
}

/** Normaliza DNS ASCII o literales IP y valida un puerto TCP dentro de rango. */
function normalizarEndpoint(endpoint: EndpointConexionAdmin): {
  readonly hostname: string;
  readonly port: number;
} {
  if (
    typeof endpoint !== 'object' ||
    endpoint === null ||
    typeof endpoint.hostname !== 'string' ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65_535
  ) {
    throw new ErrorPoliticaDestino('DESTINATION_INVALID');
  }

  const hostnameEntrada = endpoint.hostname.trim();
  if (
    hostnameEntrada.length === 0 ||
    hostnameEntrada.length > 254 ||
    /[\s\u0000-\u001f\u007f%\[\]\/\\@?#]/u.test(hostnameEntrada)
  ) {
    throw new ErrorPoliticaDestino('DESTINATION_INVALID');
  }

  if (isIP(hostnameEntrada) !== 0) {
    return { hostname: hostnameEntrada.toLowerCase(), port: endpoint.port };
  }

  const hostnameSinPuntoRaiz = hostnameEntrada.endsWith('.')
    ? hostnameEntrada.slice(0, -1)
    : hostnameEntrada;
  const hostnameAscii = domainToASCII(hostnameSinPuntoRaiz).toLowerCase();
  if (
    hostnameAscii.length === 0 ||
    hostnameAscii.length > 253 ||
    /^[0-9.]+$/u.test(hostnameAscii) ||
    hostnameAscii
      .split('.')
      .some(
        (etiqueta) =>
          etiqueta.length === 0 ||
          etiqueta.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(etiqueta),
      )
  ) {
    throw new ErrorPoliticaDestino('DESTINATION_INVALID');
  }
  return { hostname: hostnameAscii, port: endpoint.port };
}

/** Acepta solo direcciones IPv4/IPv6 numéricas sin zona y canonicaliza texto básico. */
function normalizarDireccionIp(direccion: string): string {
  if (typeof direccion !== 'string' || isIP(direccion) === 0 || direccion.includes('%')) {
    throw new ErrorPoliticaDestino('DESTINATION_UNSAFE');
  }
  return direccion.toLowerCase();
}

type ClasificacionDireccion = 'PUBLIC' | 'PRIVATE' | 'LOOPBACK' | 'SPECIAL';

/** Clasifica IPs públicas, privadas, loopback y rangos no enroutables o especiales. */
function clasificarDireccionIp(direccion: string): ClasificacionDireccion {
  const version = isIP(direccion);
  if (version === 4) {
    const numero = ipv4AEntero(direccion);
    if (contieneIpv4(numero, '127.0.0.0', 8)) {
      return 'LOOPBACK';
    }
    if (
      contieneIpv4(numero, '10.0.0.0', 8) ||
      contieneIpv4(numero, '172.16.0.0', 12) ||
      contieneIpv4(numero, '192.168.0.0', 16)
    ) {
      return 'PRIVATE';
    }
    const rangosEspeciales: readonly (readonly [string, number])[] = [
      ['0.0.0.0', 8],
      ['100.64.0.0', 10],
      ['169.254.0.0', 16],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.31.196.0', 24],
      ['192.52.193.0', 24],
      ['192.88.99.0', 24],
      ['192.175.48.0', 24],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ];
    return rangosEspeciales.some(([red, prefijo]) => contieneIpv4(numero, red, prefijo))
      ? 'SPECIAL'
      : 'PUBLIC';
  }

  if (version === 6) {
    const numero = ipv6AEntero(direccion);
    if (numero === undefined) {
      return 'SPECIAL';
    }
    if (numero === 1n) {
      return 'LOOPBACK';
    }
    if (contieneIpv6(numero, 'fc00::', 7)) {
      return 'PRIVATE';
    }
    const esGlobal = contieneIpv6(numero, '2000::', 3);
    const rangosEspeciales: readonly (readonly [string, number])[] = [
      ['2620:4f:8000::', 48],
      ['2001::', 23],
      ['2001:db8::', 32],
      ['2002::', 16],
      ['3fff::', 20],
    ];
    if (
      !esGlobal ||
      rangosEspeciales.some(([red, prefijo]) => contieneIpv6(numero, red, prefijo))
    ) {
      return 'SPECIAL';
    }
    return 'PUBLIC';
  }

  return 'SPECIAL';
}

/** Convierte una IPv4 canónica a entero sin signo para comparar prefijos CIDR. */
function ipv4AEntero(direccion: string): bigint {
  return direccion.split('.').reduce((resultado, octeto) => (resultado << 8n) | BigInt(octeto), 0n);
}

/** Comprueba pertenencia IPv4 a un bloque CIDR expresado como red y prefijo. */
function contieneIpv4(direccion: bigint, red: string, prefijo: number): boolean {
  const bits = 32n - BigInt(prefijo);
  return direccion >> bits === ipv4AEntero(red) >> bits;
}

/** Convierte IPv6 validada a entero, incluyendo formas comprimidas y literales IPv4 embebidas. */
function ipv6AEntero(direccion: string): bigint | undefined {
  if (direccion.includes('%')) {
    return undefined;
  }
  const partes = direccion.toLowerCase().split('::');
  if (partes.length > 2) {
    return undefined;
  }
  const izquierda = partes[0] === '' ? [] : partes[0]!.split(':');
  const derecha = partes.length === 1 || partes[1] === '' ? [] : partes[1]!.split(':');
  const grupos = [...izquierda, ...derecha];
  const ultimo = grupos.at(-1);
  if (ultimo?.includes('.')) {
    if (isIP(ultimo) !== 4) {
      return undefined;
    }
    const ipv4 = ipv4AEntero(ultimo);
    grupos.splice(-1, 1, Number(ipv4 >> 16n).toString(16), Number(ipv4 & 0xffffn).toString(16));
  }
  const faltantes = 8 - grupos.length;
  if ((partes.length === 1 && faltantes !== 0) || (partes.length === 2 && faltantes < 1)) {
    return undefined;
  }
  const completos =
    partes.length === 1
      ? grupos
      : [...izquierda, ...Array<string>(faltantes).fill('0'), ...derecha];
  if (completos.length !== 8 || completos.some((grupo) => !/^[0-9a-f]{1,4}$/u.test(grupo))) {
    return undefined;
  }
  return completos.reduce((resultado, grupo) => (resultado << 16n) | BigInt(`0x${grupo}`), 0n);
}

/** Comprueba pertenencia IPv6 a un bloque CIDR expresado como red y prefijo. */
function contieneIpv6(direccion: bigint, red: string, prefijo: number): boolean {
  const bits = 128n - BigInt(prefijo);
  return direccion >> bits === ipv6AEntero(red)! >> bits;
}

/** Limita valores enteros opcionales al rango permitido por seguridad. */
function limitarEntero(
  valor: number | undefined,
  porDefecto: number,
  minimo: number,
  maximo: number,
): number {
  if (valor === undefined) {
    return porDefecto;
  }
  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) {
    throw new RangeError('DESTINATION_POLICY_CONFIGURATION_INVALID');
  }
  return valor;
}
