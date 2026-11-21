import {
  ClientConnectionBrokerMySql,
  FabricaConexionMysql2,
  FabricaTunelSsh2,
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
  /** Broker limitado a una conexión y una consulta constante de solo lectura. */
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
  return {
    custodia,
    politica,
    broker: new ClientConnectionBrokerMySql(
      politica,
      new FabricaConexionMysql2(),
      new FabricaTunelSsh2(),
      5_000,
    ),
  };
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
