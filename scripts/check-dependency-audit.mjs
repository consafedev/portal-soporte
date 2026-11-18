import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GHSA_APROBADO = 'GHSA-fc5q-39xc-vjpf';
const CVE_APROBADO = 'CVE-2026-112366';
const PAQUETE_APROBADO = 'picomatch';
const VERSIONES_APROBADAS = ['2.3.2', '4.0.7'];
const FECHA_APROBACION = '2026-11-17';
const FECHA_VENCIMIENTO = '2026-12-17';
const URL_ADVISORY = `https://github.com/advisories/${GHSA_APROBADO}`;
const CLAVES_INFORME = ['advisories', 'metadata'];
const CLAVES_METADATOS = [
  'vulnerabilities',
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'totalDependencies',
];
const CLAVES_SEVERIDAD = ['info', 'low', 'moderate', 'high', 'critical'];
const CLAVES_ADVISORY = [
  'findings',
  'id',
  'title',
  'module_name',
  'vulnerable_versions',
  'patched_versions',
  'patched_versions_unpublished',
  'severity',
  'cwe',
  'github_advisory_id',
  'url',
];
const CLAVES_HALLAZGO = ['version', 'paths', 'dev', 'optional', 'bundled'];
const CLAVES_POLITICA = [
  'schemaVersion',
  'advisory',
  'cve',
  'packageName',
  'versions',
  'scope',
  'approvedBy',
  'approvedAt',
  'expiresAt',
  'reason',
];

/**
 * Comprueba que un valor JSON sea un objeto plano no nulo.
 *
 * @param value - Valor recibido desde JSON o desde una llamada de prueba.
 * @returns `true` cuando el valor es un objeto y no un arreglo.
 */
function esRegistro(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Compara las claves de un objeto con el esquema exacto esperado.
 *
 * @param value - Objeto cuya forma debe validarse.
 * @param expectedKeys - Claves que admite el esquema fijado para pnpm 12.21.0.
 * @returns `true` cuando no faltan ni sobran claves.
 */
function tieneClavesExactas(value, expectedKeys) {
  if (!esRegistro(value)) {
    return false;
  }

  const clavesActuales = Object.keys(value).sort();
  const clavesEsperadas = [...expectedKeys].sort();

  if (clavesActuales.length !== clavesEsperadas.length) {
    return false;
  }

  for (let indice = 0; indice < clavesActuales.length; indice += 1) {
    if (clavesActuales[indice] !== clavesEsperadas[indice]) {
      return false;
    }
  }

  return true;
}

/**
 * Crea una decisión negativa que conserva el FAIL de la auditoría original.
 *
 * @param reason - Motivo concreto por el que el gate no puede continuar.
 * @returns Resultado denegado sin aplicar la excepción.
 */
function denegar(reason) {
  return {
    permitted: false,
    exceptionApplied: false,
    message: `pnpm audit --audit-level high: FAIL; política denegada: ${reason}`,
  };
}

/**
 * Valida la estructura completa del informe y cuenta advisories por severidad.
 *
 * @param report - Informe JSON devuelto por pnpm audit.
 * @returns Objeto con error descriptivo o conteos por severidad.
 */
function validarInforme(report) {
  if (!tieneClavesExactas(report, CLAVES_INFORME)) {
    return { error: 'esquema raíz de auditoría inválido o desconocido' };
  }

  if (!esRegistro(report.advisories) || !esRegistro(report.metadata)) {
    return { error: 'advisories o metadata no tienen el tipo esperado' };
  }

  if (!tieneClavesExactas(report.metadata, CLAVES_METADATOS)) {
    return { error: 'esquema de metadata inválido o desconocido' };
  }

  const vulnerabilidades = report.metadata.vulnerabilities;

  if (!tieneClavesExactas(vulnerabilidades, CLAVES_SEVERIDAD)) {
    return { error: 'esquema de severidades inválido o desconocido' };
  }

  for (const severidad of CLAVES_SEVERIDAD) {
    if (!Number.isSafeInteger(vulnerabilidades[severidad]) || vulnerabilidades[severidad] < 0) {
      return { error: `conteo inválido para severidad ${severidad}` };
    }
  }

  for (const claveConteo of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'totalDependencies',
  ]) {
    if (!Number.isSafeInteger(report.metadata[claveConteo]) || report.metadata[claveConteo] < 0) {
      return { error: `conteo de dependencias inválido: ${claveConteo}` };
    }
  }

  const conteos = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };

  for (const [claveId, advisory] of Object.entries(report.advisories)) {
    if (!/^\d+$/.test(claveId) || !tieneClavesExactas(advisory, CLAVES_ADVISORY)) {
      return { error: 'advisory con identificador o campos inválidos/desconocidos' };
    }

    if (
      !Number.isSafeInteger(advisory.id) ||
      advisory.id !== Number(claveId) ||
      typeof advisory.title !== 'string' ||
      typeof advisory.module_name !== 'string' ||
      typeof advisory.vulnerable_versions !== 'string' ||
      !(typeof advisory.patched_versions === 'string' || advisory.patched_versions === null) ||
      typeof advisory.patched_versions_unpublished !== 'boolean' ||
      !CLAVES_SEVERIDAD.includes(advisory.severity) ||
      !(typeof advisory.cwe === 'string' || Array.isArray(advisory.cwe)) ||
      !(typeof advisory.github_advisory_id === 'string' || advisory.github_advisory_id === null) ||
      typeof advisory.url !== 'string' ||
      !Array.isArray(advisory.findings) ||
      advisory.findings.length === 0
    ) {
      return { error: `campos inválidos en el advisory ${claveId}` };
    }

    for (const finding of advisory.findings) {
      if (
        !tieneClavesExactas(finding, CLAVES_HALLAZGO) ||
        typeof finding.version !== 'string' ||
        typeof finding.dev !== 'boolean' ||
        typeof finding.optional !== 'boolean' ||
        typeof finding.bundled !== 'boolean' ||
        !Array.isArray(finding.paths) ||
        finding.paths.length === 0
      ) {
        return { error: `finding inválido en el advisory ${claveId}` };
      }

      for (const path of finding.paths) {
        if (typeof path !== 'string' || path.length === 0) {
          return { error: `ruta de dependencia inválida en el advisory ${claveId}` };
        }

        if (path.split('>').at(-1) !== advisory.module_name) {
          return { error: `ruta de dependencia incompatible en el advisory ${claveId}` };
        }
      }
    }

    conteos[advisory.severity] += 1;
  }

  for (const severidad of CLAVES_SEVERIDAD) {
    if (conteos[severidad] !== vulnerabilidades[severidad]) {
      return { error: `el resumen no coincide con advisories para severidad ${severidad}` };
    }
  }

  return { conteos };
}

/**
 * Valida que la política versionada coincida con la única aprobación del propietario.
 *
 * @param allowlist - Registro versionado de la aprobación temporal.
 * @param currentDate - Fecha actual usada para evaluar el vencimiento.
 * @returns Motivo de rechazo, o `null` si la política está vigente y coincide.
 */
function validarPolitica(allowlist, currentDate) {
  if (!tieneClavesExactas(allowlist, CLAVES_POLITICA)) {
    return 'esquema de allowlist inválido o desconocido';
  }

  let versionesCoinciden =
    Array.isArray(allowlist.versions) && allowlist.versions.length === VERSIONES_APROBADAS.length;

  if (versionesCoinciden) {
    for (let indice = 0; indice < VERSIONES_APROBADAS.length; indice += 1) {
      if (allowlist.versions[indice] !== VERSIONES_APROBADAS[indice]) {
        versionesCoinciden = false;
        break;
      }
    }
  }
  const aprobacionCoincide =
    allowlist.schemaVersion === 1 &&
    allowlist.advisory === GHSA_APROBADO &&
    allowlist.cve === CVE_APROBADO &&
    allowlist.packageName === PAQUETE_APROBADO &&
    versionesCoinciden &&
    allowlist.scope === 'development' &&
    allowlist.approvedBy === 'Propietario del proyecto' &&
    allowlist.approvedAt === FECHA_APROBACION &&
    allowlist.expiresAt === FECHA_VENCIMIENTO &&
    typeof allowlist.reason === 'string' &&
    allowlist.reason.length > 0;

  if (!aprobacionCoincide) {
    return 'la allowlist no coincide con la aprobación autorizada';
  }

  if (!(currentDate instanceof Date) || Number.isNaN(currentDate.getTime())) {
    return 'fecha actual inválida';
  }

  if (currentDate.toISOString().slice(0, 10) > FECHA_VENCIMIENTO) {
    return `la excepción vencida el ${FECHA_VENCIMIENTO}`;
  }

  return null;
}

/**
 * Determina si el informe permite continuar bajo la excepción de desarrollo aprobada.
 *
 * @param report - JSON ya analizado que devolvió pnpm audit.
 * @param auditExitCode - Código original del proceso pnpm audit.
 * @param allowlist - Registro de aprobación versionado en el repositorio.
 * @param currentDate - Fecha actual inyectable para verificar el vencimiento.
 * @returns Decisión de continuar y mensaje de trazabilidad.
 */
export function evaluateAuditReport(report, auditExitCode, allowlist, currentDate) {
  const validacion = validarInforme(report);

  if (validacion.error) {
    return denegar(validacion.error);
  }

  if (auditExitCode !== 0 && auditExitCode !== 1) {
    return denegar(`código de salida inesperado (${auditExitCode})`);
  }

  const severidadesBloqueantes = [];

  for (const advisory of Object.values(report.advisories)) {
    if (advisory.severity === 'high' || advisory.severity === 'critical') {
      severidadesBloqueantes.push(advisory);
    }
  }

  if (severidadesBloqueantes.length === 0) {
    if (auditExitCode !== 0) {
      return denegar('código de salida distinto de cero sin hallazgos high/critical explicables');
    }

    return {
      permitted: true,
      exceptionApplied: false,
      message:
        'pnpm audit --audit-level high: PASS; informe consistente sin hallazgos high/critical.',
    };
  }

  if (auditExitCode !== 1) {
    return denegar('código de salida inconsistente con hallazgos high/critical');
  }

  if (severidadesBloqueantes.length !== 1) {
    return denegar('existe una alerta high/critical no autorizada');
  }

  const [advisory] = severidadesBloqueantes;

  if (advisory.severity !== 'high') {
    return denegar('la severidad del advisory no coincide con la aprobación high');
  }

  if (
    advisory.github_advisory_id !== GHSA_APROBADO ||
    advisory.url !== URL_ADVISORY ||
    advisory.module_name !== PAQUETE_APROBADO ||
    advisory.vulnerable_versions !== '<=4.0.7'
  ) {
    return denegar('el advisory, paquete o rango vulnerable no coincide con la aprobación');
  }

  if (advisory.patched_versions !== null || !advisory.patched_versions_unpublished) {
    return denegar('pnpm informa un parche publicado; actualice el lockfile y revise la política');
  }

  const errorPolitica = validarPolitica(allowlist, currentDate);

  if (errorPolitica) {
    return denegar(errorPolitica);
  }

  const versionesEncontradas = [];

  for (const finding of advisory.findings) {
    versionesEncontradas.push(finding.version);
  }

  versionesEncontradas.sort();
  const versionesAprobadas = [...VERSIONES_APROBADAS].sort();

  let versionesAutorizadas = versionesEncontradas.length === versionesAprobadas.length;

  for (let indice = 0; versionesAutorizadas && indice < versionesAprobadas.length; indice += 1) {
    versionesAutorizadas = versionesEncontradas[indice] === versionesAprobadas[indice];
  }

  if (!versionesAutorizadas) {
    return denegar('picomatch contiene una versión no incluida en la autorización');
  }

  for (const finding of advisory.findings) {
    if (!finding.dev) {
      return denegar('picomatch aparece en una dependencia de producción');
    }

    if (finding.optional || finding.bundled) {
      return denegar('las instancias no coinciden con el alcance revisado');
    }
  }

  if (advisory.findings.length !== 2) {
    return denegar('las instancias no coinciden con el alcance revisado');
  }

  if (validacion.conteos.high !== 1 || validacion.conteos.critical !== 0) {
    return denegar('los conteos high/critical no coinciden con la única excepción aprobada');
  }

  return {
    permitted: true,
    exceptionApplied: true,
    message:
      `pnpm audit --audit-level high: FAIL (código ${auditExitCode}). ` +
      `Excepción temporal aprobada solo para desarrollo: ${GHSA_APROBADO} en ${PAQUETE_APROBADO}. ` +
      'El advisory continúa abierto; la auditoría completa sigue FAIL y no es PASS.',
  };
}

/**
 * Imprime el informe completo de pnpm sin reemplazar su código de salida por un PASS.
 *
 * @param stdout - Salida JSON capturada del audit original.
 * @param stderr - Diagnósticos emitidos por el proceso audit.
 * @returns No devuelve valor; escribe la evidencia original en las salidas del job.
 */
function imprimirInformeOriginal(stdout, stderr) {
  process.stdout.write('Salida original de `pnpm audit --audit-level high --json`:\n');
  process.stdout.write(stdout || '(sin salida estándar)\n');

  if (stdout && !stdout.endsWith('\n')) {
    process.stdout.write('\n');
  }

  if (stderr) {
    process.stderr.write(stderr);
  }
}

/**
 * Ejecuta el audit completo con la versión fijada y evalúa la política temporal.
 *
 * @returns No devuelve valor; asigna código distinto de cero cuando el gate debe fallar.
 */
function main() {
  const rutaAllowlist = fileURLToPath(
    new URL('../.github/dependency-audit-allowlist.json', import.meta.url),
  );
  const allowlist = JSON.parse(readFileSync(rutaAllowlist, 'utf8'));
  // En Windows, el shim de Corepack requiere cmd.exe; la línea ejecutada es constante.
  const comandoAuditoria =
    process.platform === 'win32'
      ? {
          command: 'cmd.exe',
          arguments: ['/d', '/s', '/c', 'corepack pnpm@12.21.0 audit --audit-level high --json'],
        }
      : {
          command: 'corepack',
          arguments: ['pnpm@12.21.0', 'audit', '--audit-level', 'high', '--json'],
        };
  const auditoria = spawnSync(comandoAuditoria.command, comandoAuditoria.arguments, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  imprimirInformeOriginal(auditoria.stdout ?? '', auditoria.stderr ?? '');

  if (auditoria.error || auditoria.status === null || auditoria.signal) {
    const motivo = auditoria.error?.message ?? `señal ${auditoria.signal ?? 'desconocida'}`;
    console.error(`La ejecución de pnpm audit no es verificable: ${motivo}`);
    process.exitCode = 1;
    return;
  }

  let informe;

  try {
    informe = JSON.parse(auditoria.stdout);
  } catch (error) {
    const motivo = error instanceof Error ? error.message : 'error JSON desconocido';
    console.error(`No se pudo analizar el JSON original del audit: ${motivo}`);
    process.exitCode = 1;
    return;
  }

  const resultado = evaluateAuditReport(informe, auditoria.status, allowlist, new Date());
  console.log(resultado.message);
  process.exitCode = resultado.permitted ? 0 : 1;
}

/**
 * Registra de forma segura un error inesperado del validador sin permitir que CI continúe.
 *
 * @param error - Excepción que ocurrió fuera de los casos controlados.
 * @returns No devuelve valor; deja el proceso con código de salida fallido.
 */
function registrarFalloInesperado(error) {
  const motivo = error instanceof Error ? error.message : 'error no identificado';
  console.error(`Evaluación de excepción abortada; auditoría no aprobada: ${motivo}`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    registrarFalloInesperado(error);
  }
}
