import { X509Certificate } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  ClientConnectionBrokerMySql,
  FabricaConexionMysql2,
  FabricaTunelSsh2,
  PoliticaDireccionesDestino,
  PoliticaDestinosConexion,
  ProveedorClavesMaestrasArchivo,
  ServicioCifradoSecretos,
  type GatewaySshPermitido,
  type DestinoMySqlPermitido,
} from '@portal-soporte/connectors';

/** Componentes server-side disponibles para custodia y pruebas de conexión. */
export interface RuntimePerfilesConexion {
  /** Cifrador versionado o null cuando no se provisionó llavero. */
  readonly custodia: ServicioCifradoSecretos | null;
  /** Destinos de red fijados desde configuración operacional protegida. */
  readonly politica: PoliticaDestinosConexion;
  /** Broker limitado a una conexión y consultas RF-1 preparadas de solo lectura. */
  readonly broker: ClientConnectionBrokerMySql;
}

/** Carga custodia y allowlist desde configuración del proceso sin guardar credenciales. */
export function cargarRuntimePerfilesConexion(
  variables: NodeJS.ProcessEnv = process.env,
): RuntimePerfilesConexion {
  const destinos = cargarDestinos(variables['PORTAL_CONNECTOR_POLICY_JSON']);
  const politica = new PoliticaDestinosConexion(destinos.mysqlDestinos, destinos.sshGateways);
  const custodia = cargarCustodia(
    variables['PORTAL_MASTER_KEYRING_PATH'],
    variables['PORTAL_MASTER_KEYRING_GID'],
  );
  const caAdicionalMySql = cargarBundleCaMySql(variables['PORTAL_MYSQL_CA_BUNDLE_PATH']);
  return {
    custodia,
    politica,
    broker: new ClientConnectionBrokerMySql(
      politica,
      new FabricaConexionMysql2(caAdicionalMySql),
      new FabricaTunelSsh2(),
      5_000,
      new PoliticaDireccionesDestino(),
    ),
  };
}

/**
 * Carga un bundle PEM adicional y verifica que sea un archivo absoluto con CA válidas.
 *
 * @param ruta Ruta operacional opcional al bundle CA PEM de MySQL.
 * @returns PEM validado para inyectarlo solo en la fábrica de conexiones MySQL.
 * @throws Error con código estable si la ruta o el contenido no cumplen la política.
 */
export function cargarBundleCaMySql(ruta: string | undefined): string | undefined {
  if (ruta === undefined) {
    return undefined;
  }
  if (!isAbsolute(ruta)) {
    throw new Error('MYSQL_CA_BUNDLE_CONFIG_INVALID');
  }

  try {
    const estado = lstatSync(ruta);
    if (!estado.isFile() || estado.isSymbolicLink() || estado.size === 0 || estado.size > 262_144) {
      throw new Error('MYSQL_CA_BUNDLE_CONFIG_INVALID');
    }

    const pem = readFileSync(ruta, 'utf8');
    const certificados = [
      ...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu),
    ];
    const resto = pem
      .replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu, '')
      .trim();
    if (certificados.length === 0 || certificados.length > 200 || resto.length > 0) {
      throw new Error('MYSQL_CA_BUNDLE_CONFIG_INVALID');
    }
    for (const certificado of certificados) {
      if (certificado[0] === undefined || !new X509Certificate(certificado[0]).ca) {
        throw new Error('MYSQL_CA_BUNDLE_CONFIG_INVALID');
      }
    }
    return pem;
  } catch {
    throw new Error('MYSQL_CA_BUNDLE_CONFIG_INVALID');
  }
}

/** Analiza una lista operacional estricta de destinos y rechaza toda propiedad adicional. */
function cargarDestinos(valor: string | undefined): {
  readonly mysqlDestinos: readonly DestinoMySqlPermitido[];
  readonly sshGateways: readonly GatewaySshPermitido[];
} {
  if (valor === undefined || valor.length === 0) {
    return { mysqlDestinos: [], sshGateways: [] };
  }
  if (valor.length > 32_768) {
    throw new Error('CONNECTOR_POLICY_INVALID');
  }

  try {
    const documento: unknown = JSON.parse(valor);
    if (
      !esObjeto(documento) ||
      !tieneCamposExactos(documento, ['mysqlDestinations', 'sshGateways']) ||
      !Array.isArray(documento['mysqlDestinations']) ||
      !Array.isArray(documento['sshGateways']) ||
      documento['mysqlDestinations'].length > 100 ||
      documento['sshGateways'].length > 100
    ) {
      throw new Error('CONNECTOR_POLICY_INVALID');
    }

    return {
      mysqlDestinos: documento['mysqlDestinations'].map(analizarDestinoMySql),
      sshGateways: documento['sshGateways'].map(analizarGatewaySsh),
    };
  } catch {
    throw new Error('CONNECTOR_POLICY_INVALID');
  }
}

/** Valida una entrada MySQL sin aceptar campos secretos o redirecciones variables. */
function analizarDestinoMySql(valor: unknown): DestinoMySqlPermitido {
  if (
    !esObjeto(valor) ||
    !tieneCamposExactos(valor, ['id', 'hostname', 'address', 'port']) ||
    typeof valor['id'] !== 'string' ||
    typeof valor['hostname'] !== 'string' ||
    typeof valor['address'] !== 'string' ||
    typeof valor['port'] !== 'number'
  ) {
    throw new Error('CONNECTOR_POLICY_INVALID');
  }
  return {
    id: valor['id'],
    hostname: valor['hostname'],
    address: valor['address'],
    port: valor['port'],
  };
}

/** Valida gateway SSH con fingerprint explícito; nunca admite agent, shell ni comandos. */
function analizarGatewaySsh(valor: unknown): GatewaySshPermitido {
  if (
    !esObjeto(valor) ||
    !tieneCamposExactos(valor, ['id', 'hostname', 'address', 'port', 'fingerprint']) ||
    typeof valor['id'] !== 'string' ||
    typeof valor['hostname'] !== 'string' ||
    typeof valor['address'] !== 'string' ||
    typeof valor['port'] !== 'number' ||
    typeof valor['fingerprint'] !== 'string'
  ) {
    throw new Error('CONNECTOR_POLICY_INVALID');
  }
  return {
    id: valor['id'],
    hostname: valor['hostname'],
    address: valor['address'],
    port: valor['port'],
    fingerprint: valor['fingerprint'],
  };
}

/** Crea un proveedor de llaves solo con ruta absoluta y GID explícitos. */
function cargarCustodia(
  ruta: string | undefined,
  grupoId: string | undefined,
): ServicioCifradoSecretos | null {
  if (ruta === undefined && grupoId === undefined) {
    return null;
  }
  if (
    ruta === undefined ||
    grupoId === undefined ||
    !/^\d{1,10}$/u.test(grupoId) ||
    !Number.isSafeInteger(Number(grupoId))
  ) {
    throw new Error('MASTER_KEYRING_CONFIG_INVALID');
  }
  return new ServicioCifradoSecretos(new ProveedorClavesMaestrasArchivo(ruta, Number(grupoId)));
}

/** Comprueba que la configuración JSON sea un objeto y no una lista o valor primitivo. */
function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Rechaza campos no declarados en la política de destinos. */
function tieneCamposExactos(valor: Record<string, unknown>, campos: readonly string[]): boolean {
  return (
    Object.keys(valor).length === campos.length &&
    campos.every((campo) => Object.hasOwn(valor, campo))
  );
}
