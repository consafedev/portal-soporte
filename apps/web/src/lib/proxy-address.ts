import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

const MAX_CANTIDAD_SALTOS_PROXY = 16;

/**
 * Valida los rangos de proxy de borde que la web puede consultar como peer.
 * @param variables Entorno desde el que se ejecuta el servidor web.
 * @returns Rangos inmutables de proxies autorizados para transmitir `X-Forwarded-For`.
 * @throws Error si el ambiente o uno de los rangos no tiene política segura.
 */
export function cargarProxiesBordeConfiables(variables: NodeJS.ProcessEnv): readonly string[] {
  const entorno = variables['NODE_ENV'];
  if (entorno !== 'development' && entorno !== 'test' && entorno !== 'production') {
    throw new Error('NODE_ENV debe ser development, test o production.');
  }

  const valor = variables['TRUSTED_EDGE_PROXY_CIDRS'];
  if (valor === undefined || valor.trim().length === 0) {
    return [];
  }

  const cidr = valor.split(',').map((entrada) => entrada.trim());
  if (cidr.some((entrada) => entrada.length === 0)) {
    throw new Error('TRUSTED_EDGE_PROXY_CIDRS contiene una entrada vacía.');
  }

  return Object.freeze(cidr.map((entrada) => validarCidrBorde(entrada, entorno)));
}

/**
 * Copia cabeceras de entrada y reemplaza todas las declaraciones de proxy con datos saneados.
 * @param cabeceras - Cabeceras HTTP recibidas del navegador o del proxy de borde.
 * @param peerRemoto - Dirección observada por el socket TCP del servidor Node.
 * @param cidrConfiables - Rangos autorizados a aportar una cadena `X-Forwarded-For`.
 * @returns Cabeceras nuevas con una única IP validada y sin aliases reenviados del cliente.
 */
export function sanearCabecerasProxyBorde(
  cabeceras: Readonly<Record<string, string | string[] | undefined>>,
  peerRemoto: string,
  cidrConfiables: readonly string[],
): Record<string, string | string[] | undefined> {
  const reenviado = cabeceras['x-forwarded-for'];
  const ipCliente = resolverIpClienteConfiable(
    peerRemoto,
    typeof reenviado === 'string' ? reenviado : undefined,
    cidrConfiables,
  );
  const resultado: Record<string, string | string[] | undefined> = {};

  for (const [nombre, valor] of Object.entries(cabeceras)) {
    const normalizado = nombre.toLowerCase();
    if (
      normalizado === 'forwarded' ||
      normalizado === 'x-real-ip' ||
      normalizado === 'cf-connecting-ip' ||
      normalizado === 'true-client-ip' ||
      normalizado.startsWith('x-forwarded-')
    ) {
      continue;
    }
    resultado[normalizado] = valor;
  }

  resultado['x-forwarded-for'] = ipCliente;

  return resultado;
}

/**
 * Resuelve el cliente desde un peer comprobado e ignora cabeceras no emitidas por proxies confiables.
 *
 * @param peerRemoto - Dirección TCP observada por el socket Node, no por una cabecera HTTP.
 * @param xForwardedFor - Cadena recibida que solo se considera si el peer pertenece a la allowlist.
 * @param cidrConfiables - Rangos explícitos de proxies de borde configurados fuera del código.
 * @returns Dirección IP del primer salto no confiable al recorrer desde el servidor hacia el cliente.
 * @throws Error si la dirección peer no es una dirección IPv4/IPv6 válida.
 */
export function resolverIpClienteConfiable(
  peerRemoto: string,
  xForwardedFor: string | undefined,
  cidrConfiables: readonly string[],
): string {
  const peer = normalizarDireccion(peerRemoto);
  if (!esIpConfiable(peer, cidrConfiables) || xForwardedFor === undefined) {
    return peer.toString();
  }

  const saltosDeclarados = xForwardedFor.split(',').map((salto) => salto.trim());
  if (
    saltosDeclarados.length === 0 ||
    saltosDeclarados.length > MAX_CANTIDAD_SALTOS_PROXY ||
    saltosDeclarados.some((salto) => salto.length === 0 || isIP(salto) === 0)
  ) {
    return peer.toString();
  }

  let saltos: Array<ipaddr.IPv4 | ipaddr.IPv6>;
  try {
    saltos = saltosDeclarados.map(normalizarDireccion);
  } catch {
    return peer.toString();
  }

  saltos.push(peer);
  for (let indice = saltos.length - 1; indice >= 0; indice -= 1) {
    const salto = saltos[indice];
    if (salto === undefined) {
      return peer.toString();
    }
    if (!esIpConfiable(salto, cidrConfiables)) {
      return salto.toString();
    }
  }

  return peer.toString();
}

/** Valida IPv4/CIDR y restringe el ambiente local al rango loopback completo. */
function validarCidrBorde(valor: string, entorno: string): string {
  if (!ipaddr.isValidCIDR(valor)) {
    throw new Error('TRUSTED_EDGE_PROXY_CIDRS solo admite direcciones IP o CIDR válidos.');
  }

  const [direccion, prefijo] = ipaddr.parseCIDR(valor);
  const maximo = direccion.kind() === 'ipv4' ? 32 : 128;
  const prefijoValido = prefijo > 0 && prefijo <= maximo;
  const textoDireccion = direccion.toString();
  const esIndeterminada = textoDireccion === '0.0.0.0' || textoDireccion === '::';
  const esLoopbackCompleto =
    (direccion.kind() === 'ipv4' && direccion.range() === 'loopback' && prefijo >= 8) ||
    (direccion.kind() === 'ipv6' && textoDireccion === '::1' && prefijo === 128);

  if (!prefijoValido || esIndeterminada) {
    throw new Error('TRUSTED_EDGE_PROXY_CIDRS no admite rangos universales o no especificados.');
  }
  if (entorno !== 'production' && !esLoopbackCompleto) {
    throw new Error('TRUSTED_EDGE_PROXY_CIDRS solo puede confiar en loopback fuera de producción.');
  }

  return valor;
}

/** Convierte direcciones IPv4 mapeadas a IPv4 para comparar ambas formas sin ambigüedad. */
function normalizarDireccion(valor: string): ipaddr.IPv4 | ipaddr.IPv6 {
  if (isIP(valor) === 0) {
    throw new Error('La cabecera reenviada no contiene una dirección IP válida.');
  }

  return ipaddr.process(valor);
}

/** Comprueba si una dirección pertenece a alguno de los rangos configurados explícitamente. */
function esIpConfiable(direccion: ipaddr.IPv4 | ipaddr.IPv6, cidr: readonly string[]): boolean {
  return cidr.some((rango) => {
    const [red, prefijo] = ipaddr.parseCIDR(rango);
    return direccion.kind() === red.kind() && direccion.match(red, prefijo);
  });
}
