import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const hostAprobado = '10.18.170.44';
const usuarioAprobado = 'daniel';
const huellaAprobada = 'SHA256:kJFGr6h9jFCslHQC2Ej7Mc4/NTf2AEKTCFgLkaaJ7a0';
const mensajeIdentidadInvalida =
  'La clave SSH local no coincide con la identidad fijada del servidor de pruebas.';

/**
 * Resuelve una ruta de almacén efectiva de OpenSSH en Windows.
 * @param ruta Ruta local o ruta con el macro de ProgramData de OpenSSH.
 * @returns Ruta absoluta normalizada para lectura local.
 */
function resolverRutaAlmacen(ruta: string): string {
  const datosPrograma = process.env['ProgramData'] ?? process.env['PROGRAMDATA'] ?? '';
  const rutaExpandida = ruta.replace(/^__PROGRAMDATA__(?=[\\/])/iu, datosPrograma);
  return resolve(rutaExpandida)
    .replace(/[\\/]+/gu, '\\')
    .toLocaleLowerCase('en-US');
}

/**
 * Valida destino, política de host key y almacenes efectivos de OpenSSH.
 * @param salida Configuración efectiva de OpenSSH obtenida sin conexión.
 * @returns No devuelve valor cuando todos los valores están aprobados.
 * @throws Error si host, usuario, puerto, proxy o trust stores no coinciden.
 */
export function validarConfiguracionEfectivaSsh(salida: string): void {
  /**
   * Busca una propiedad en la salida de configuración efectiva.
   * @param nombre Nombre del parámetro SSH.
   * @returns Valor normalizado o undefined cuando no se informa.
   */
  const obtener = (nombre: string): string | undefined => {
    const coincidencia = salida.match(new RegExp(`^${nombre}\\s+(.+)$`, 'imu'));
    return coincidencia?.[1]?.trim();
  };
  const host = obtener('hostname');
  const usuario = obtener('user');
  const puerto = obtener('port');
  const politicaHostKey = obtener('stricthostkeychecking')?.toLowerCase();
  const almacenes = obtenerAlmacenesKnownHosts(salida);
  const almacenesGlobales = obtenerAlmacenesKnownHosts(salida, 'globalknownhostsfile');
  const configuracionGlobal = obtener('globalknownhostsfile')?.toLowerCase();
  const comandoAlmacenes = obtener('knownhostscommand')?.toLowerCase();
  const proxyCommand = obtener('proxycommand')?.toLowerCase();
  const proxyJump = obtener('proxyjump')?.toLowerCase();
  const aliasHostKey = obtener('hostkeyalias');
  const canonizacion = obtener('canonicalizehostname')?.toLowerCase();
  const almacenesPermitidos = new Set([
    resolverRutaAlmacen(join(homedir(), '.ssh', 'known_hosts')),
    resolverRutaAlmacen(join(homedir(), '.ssh', 'known_hosts2')),
  ]);
  const datosPrograma = process.env['ProgramData'] ?? process.env['PROGRAMDATA'];
  const almacenesGlobalesPermitidos = new Set(
    datosPrograma === undefined
      ? []
      : [
          resolverRutaAlmacen(join(datosPrograma, 'ssh', 'ssh_known_hosts')),
          resolverRutaAlmacen(join(datosPrograma, 'ssh', 'ssh_known_hosts2')),
        ],
  );
  /**
   * Comprueba si un almacén de usuario es una ruta OpenSSH estándar.
   * @param almacen Ruta efectiva que se desea validar.
   * @returns true cuando la ruta está permitida.
   */
  const esAlmacenPermitido = (almacen: string): boolean =>
    almacenesPermitidos.has(resolverRutaAlmacen(almacen));
  /**
   * Comprueba si un almacén global corresponde a la ubicación de sistema estándar.
   * @param almacen Ruta global efectiva que se desea validar.
   * @returns true cuando la ruta está permitida.
   */
  const esAlmacenGlobalPermitido = (almacen: string): boolean =>
    almacenesGlobalesPermitidos.has(resolverRutaAlmacen(almacen));
  const politicaSegura = ['yes', 'ask', 'accept-new'].includes(politicaHostKey ?? '');
  const almacenesSeguros =
    almacenes.length > 0 &&
    new Set(almacenes.map(resolverRutaAlmacen)).size === almacenes.length &&
    almacenes.every(esAlmacenPermitido);
  const almacenesGlobalesSeguros =
    configuracionGlobal === 'none'
      ? almacenesGlobales.length === 0
      : almacenesGlobales.length > 0 &&
        new Set(almacenesGlobales.map(resolverRutaAlmacen)).size === almacenesGlobales.length &&
        almacenesGlobales.every(esAlmacenGlobalPermitido);

  if (
    host !== hostAprobado ||
    usuario !== usuarioAprobado ||
    puerto !== '22' ||
    !politicaSegura ||
    !almacenesSeguros ||
    !almacenesGlobalesSeguros ||
    (comandoAlmacenes !== undefined && comandoAlmacenes !== 'none') ||
    (proxyCommand !== undefined && proxyCommand !== 'none') ||
    (proxyJump !== undefined && proxyJump !== 'none') ||
    (aliasHostKey !== undefined && aliasHostKey !== hostAprobado) ||
    (canonizacion !== undefined && !['no', 'false'].includes(canonizacion))
  ) {
    throw new Error(mensajeIdentidadInvalida);
  }
}

/**
 * Extrae las rutas de trust stores que OpenSSH consultará para el host.
 * @param salida Configuración efectiva de OpenSSH.
 * @param parametro Nombre del parámetro de almacén del que se leen las rutas.
 * @returns Rutas configuradas; devuelve una lista vacía cuando OpenSSH informa none.
 * @throws Error si falta el parámetro o su valor está vacío.
 */
function obtenerAlmacenesKnownHosts(salida: string, parametro = 'userknownhostsfile'): string[] {
  const linea = salida.match(new RegExp('^' + parametro + '\\s+(.+)$', 'imu'))?.[1]?.trim();
  if (linea === undefined || linea.length === 0) {
    throw new Error(mensajeIdentidadInvalida);
  }

  if (linea.toLowerCase() === 'none') {
    return [];
  }

  return linea.split(/\s+/u);
}

/**
 * Exige el pin ED25519 aprobado y rechaza cualquier otro ED25519 para el host.
 * @param salida Salida de ssh-keygen con algoritmo y huella de cada clave.
 * @returns No devuelve valor si el pin ED25519 aprobado es único entre claves de ese algoritmo.
 * @throws Error si falta el pin o existe otra clave o algoritmo confiable.
 */
export function validarSalidaHuellasHostSsh(salida: string): void {
  const clavesUnicas = new Map<string, { huella: string; algoritmo: string }>();
  for (const linea of salida.split(/\r?\n/u)) {
    const lineaLimpia = linea.trim();
    if (lineaLimpia.length === 0) {
      continue;
    }
    const coincidencia = lineaLimpia.match(/^\d+\s+(SHA256:[A-Za-z0-9+/]+)\s+.+\(([^)]+)\)$/u);
    if (coincidencia === null) {
      throw new Error(mensajeIdentidadInvalida);
    }
    const clave = { huella: coincidencia[1]!, algoritmo: coincidencia[2]! };
    clavesUnicas.set(clave.algoritmo + ':' + clave.huella, clave);
  }
  const clavesEd25519 = [...clavesUnicas.values()].filter((clave) => clave.algoritmo === 'ED25519');

  if (clavesEd25519.length !== 1 || clavesEd25519[0]?.huella !== huellaAprobada) {
    throw new Error(mensajeIdentidadInvalida);
  }
}

/**
 * Comprueba el trust set fijado y el forward SSH loopback existente en solo lectura.
 * @returns No devuelve valor si host, trust set y forward coinciden con el destino aprobado.
 * @throws Error si la plataforma, configuración o listener no corresponden; ejecuta únicamente
 * consultas locales y no crea, detiene ni modifica el túnel.
 */
export function verificarTunelSshPrueba(): void {
  if (process.platform !== 'win32') {
    throw new Error('El modo remoto requiere verificar el túnel SSH desde Windows.');
  }

  const objetivo = `${usuarioAprobado}@${hostAprobado}`;
  const configuracionSsh = spawnSync('ssh.exe', ['-G', '-p', '22', objetivo], {
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 65_536,
  });
  if (configuracionSsh.error !== undefined || configuracionSsh.status !== 0) {
    throw new Error(mensajeIdentidadInvalida);
  }
  validarConfiguracionEfectivaSsh(configuracionSsh.stdout);

  const almacenes = [
    ...obtenerAlmacenesKnownHosts(configuracionSsh.stdout),
    ...obtenerAlmacenesKnownHosts(configuracionSsh.stdout, 'globalknownhostsfile'),
  ].map(resolverRutaAlmacen);
  const lineasConocidas: string[] = [];
  for (const archivo of almacenes) {
    if (!existsSync(archivo)) {
      continue;
    }

    const clavesConocidas = spawnSync('ssh-keygen.exe', ['-F', hostAprobado, '-f', archivo], {
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 16_384,
    });
    if (clavesConocidas.error !== undefined || ![0, 1].includes(clavesConocidas.status ?? -1)) {
      throw new Error(mensajeIdentidadInvalida);
    }
    if (clavesConocidas.status === 0) {
      lineasConocidas.push(clavesConocidas.stdout);
    }
  }
  if (lineasConocidas.length === 0) {
    throw new Error(mensajeIdentidadInvalida);
  }

  const huellas = spawnSync('ssh-keygen.exe', ['-lf', '-'], {
    input: lineasConocidas.join('\n'),
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 16_384,
  });
  if (huellas.error !== undefined || huellas.status !== 0) {
    throw new Error(mensajeIdentidadInvalida);
  }
  validarSalidaHuellasHostSsh(huellas.stdout);

  const validacionTunel = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      construirVerificacionTunelPowerShell(),
    ],
    { encoding: 'utf8', timeout: 5_000, maxBuffer: 16_384 },
  );
  if (
    validacionTunel.error !== undefined ||
    validacionTunel.status !== 0 ||
    validacionTunel.stdout.trim() !== 'PORTAL_TEST_TUNNEL_VERIFIED'
  ) {
    throw new Error('El forward SSH no coincide con el túnel de pruebas aprobado.');
  }
}

/**
 * Construye la consulta PowerShell local que valida el listener sin devolver argumentos.
 * @returns Texto de un script PowerShell read-only; no ejecuta el script.
 */
function construirVerificacionTunelPowerShell(): string {
  return `
$ErrorActionPreference = 'Stop'
$listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 15432 -State Listen)
if ($listeners.Count -ne 1) { exit 20 }
$ownerId = [int]$listeners[0].OwningProcess
$owner = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ownerId"
if ($null -eq $owner -or $owner.Name -ne 'ssh.exe') { exit 21 }
$line = [string]$owner.CommandLine
$forward = '-L 127.0.0.1:15432:127.0.0.1:5432'
$target = '${usuarioAprobado}@${hostAprobado}'
$publico = $line -match '(?:^|\\s)-g(?:\\s|$)' -or $line -match '(?:^|\\s)-R(?:\\s|$)'
$puertoAlterno = $line -match '(?:^|\\s)-p(?:\\s+|=)' -and $line -notmatch '(?:^|\\s)-p(?:\\s+|=)22(?:\\s|$)'
$noInteractivo = $line -match '(?:^|\\s)-N(?:\\s|$)'
$falloForward = $line -match '(?:^|\\s)-o\\s+ExitOnForwardFailure=yes(?:\\s|$)'
$configAlternativa = $line -match '(?:^|\\s)-F(?:\\s|$)'
$hostKeyDebilitada = $line -match '(?i)StrictHostKeyChecking(?:\\s+|=)(?:no|off)' -or $line -match '(?i)UserKnownHostsFile(?:\\s+|=)(?:NUL|/dev/null)'
$sustitucionIdentidad = $line -match '(?i)(?:UserKnownHostsFile|HostKeyAlias|ProxyCommand|ProxyJump|HostName|HostKeyAlgorithms)'
if (-not $line.Contains($forward) -or -not $line.Contains($target) -or $publico -or $puertoAlterno -or -not $noInteractivo -or -not $falloForward -or $configAlternativa -or $hostKeyDebilitada -or $sustitucionIdentidad) { exit 22 }
[Console]::Out.Write('PORTAL_TEST_TUNNEL_VERIFIED')
`;
}
