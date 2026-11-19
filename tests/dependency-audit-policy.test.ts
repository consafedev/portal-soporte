import { expect, test } from 'vitest';
import { evaluateAuditReport } from '../scripts/check-dependency-audit.mjs';

/** Informe mínimo que reproduce la salida observada de pnpm audit 12.21.0. */
type InformeDeAuditoria = {
  advisories: Record<string, AdvisoryDeAuditoria>;
  metadata: {
    vulnerabilities: Record<'info' | 'low' | 'moderate' | 'high' | 'critical', number>;
    dependencies: number;
    devDependencies: number;
    optionalDependencies: number;
    totalDependencies: number;
  };
};

/** Advisory individual del formato JSON que produce el audit fijado. */
type AdvisoryDeAuditoria = {
  findings: HallazgoDeAuditoria[];
  id: number;
  title: string;
  module_name: string;
  vulnerable_versions: string;
  patched_versions: string | null;
  patched_versions_unpublished: boolean;
  severity: string;
  cwe: string;
  github_advisory_id: string;
  url: string;
};

/** Instancia y rutas de una versión afectada dentro del árbol auditado. */
type HallazgoDeAuditoria = {
  version: string;
  paths: string[];
  dev: boolean;
  optional: boolean;
  bundled: boolean;
};

/**
 * Obtiene un advisory del informe de prueba y falla con contexto si no existe.
 *
 * @param informe - Informe sintético que se está modificando para la prueba.
 * @param id - Identificador numérico del advisory dentro del objeto.
 * @returns El advisory solicitado.
 * @throws Error si el identificador no existe en el informe.
 */
function obtenerAdvisory(informe: InformeDeAuditoria, id: string): AdvisoryDeAuditoria {
  const advisory = informe.advisories[id];

  if (!advisory) {
    throw new Error(`No existe el advisory de prueba ${id}`);
  }

  return advisory;
}

/**
 * Obtiene una instancia concreta del advisory para ajustar el escenario probado.
 *
 * @param informe - Informe sintético que se está modificando para la prueba.
 * @param id - Identificador numérico del advisory dentro del objeto.
 * @param indice - Posición de la versión afectada que se desea revisar.
 * @returns La instancia solicitada.
 * @throws Error si el advisory o la instancia no existen.
 */
function obtenerHallazgo(
  informe: InformeDeAuditoria,
  id: string,
  indice: number,
): HallazgoDeAuditoria {
  const hallazgo = obtenerAdvisory(informe, id).findings[indice];

  if (!hallazgo) {
    throw new Error(`No existe el hallazgo ${indice} del advisory ${id}`);
  }

  return hallazgo;
}

const fechaDentroDeVigencia = new Date('2026-11-17T12:00:00.000Z');

const politicaAprobada = {
  schemaVersion: 1,
  advisory: 'GHSA-fc5q-39xc-vjpf',
  cve: 'CVE-2026-112366',
  packageName: 'picomatch',
  versions: ['2.3.2', '4.0.7'],
  scope: 'development',
  approvedBy: 'Propietario del proyecto',
  approvedAt: '2026-11-17',
  expiresAt: '2026-12-17',
  reason: 'Riesgo aceptado temporalmente para herramientas de desarrollo y CI.',
};

const informeVulnerable: InformeDeAuditoria = {
  advisories: {
    '1247710': {
      findings: [
        {
          version: '2.3.2',
          paths: ['.>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>picomatch'],
          dev: true,
          optional: false,
          bundled: false,
        },
        {
          version: '4.0.7',
          paths: ['.>secretlint>@secretlint/core>picomatch'],
          dev: true,
          optional: false,
          bundled: false,
        },
      ],
      id: 1247710,
      title: 'picomatch vulnerable to ReDoS through single-branch repeated extglobs',
      module_name: 'picomatch',
      vulnerable_versions: '<=4.0.7',
      patched_versions: null,
      patched_versions_unpublished: true,
      severity: 'high',
      cwe: 'CWE-1333',
      github_advisory_id: 'GHSA-fc5q-39xc-vjpf',
      url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
    },
  },
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 1, high: 1, critical: 0 },
    dependencies: 104,
    devDependencies: 377,
    optionalDependencies: 106,
    totalDependencies: 533,
  },
};

/**
 * Acepta exclusivamente el advisory aprobado cuando el audit original indica fallo.
 *
 * @returns Una promesa de prueba que verifica el permiso temporal y su mensaje explícito.
 */
async function aceptaSoloLaAlertaAprobada(): Promise<void> {
  const resultado = evaluateAuditReport(
    informeVulnerable,
    1,
    politicaAprobada,
    fechaDentroDeVigencia,
  );

  expect(resultado.permitted).toBe(true);
  expect(resultado.exceptionApplied).toBe(true);
  expect(resultado.message).toContain('FAIL');
  expect(resultado.message).toContain('no es PASS');
}

test('permite la alerta aprobada únicamente como excepción visible', aceptaSoloLaAlertaAprobada);

/**
 * Rechaza la excepción si al menos una instancia aparece en el árbol de producción.
 *
 * @returns Una promesa de prueba que verifica el rechazo de una instancia no dev.
 */
async function rechazaUnaInstanciaDeProduccion(): Promise<void> {
  const informe = structuredClone(informeVulnerable);
  obtenerHallazgo(informe, '1247710', 1).dev = false;

  const resultado = evaluateAuditReport(informe, 1, politicaAprobada, fechaDentroDeVigencia);

  expect(resultado.permitted).toBe(false);
  expect(resultado.message).toContain('producción');
}

test(
  'rechaza la alerta aprobada si una instancia no es de desarrollo',
  rechazaUnaInstanciaDeProduccion,
);

/**
 * Rechaza cualquier advisory alto o crítico adicional al que recibió aprobación.
 *
 * @returns Una promesa de prueba que verifica el cierre ante otra alerta alta.
 */
async function rechazaOtraAlertaAlta(): Promise<void> {
  const informe = structuredClone(informeVulnerable);
  const advisoryBase = obtenerAdvisory(informe, '1247710');
  informe.advisories['999'] = {
    ...advisoryBase,
    id: 999,
    title: 'Otra alerta',
    module_name: 'otro-paquete',
    vulnerable_versions: '<1.0.0',
    patched_versions: '1.0.0',
    patched_versions_unpublished: false,
    github_advisory_id: 'GHSA-otro',
    url: 'https://github.com/advisories/GHSA-otro',
    findings: [
      {
        version: '0.9.0',
        paths: ['.>otro-paquete'],
        dev: true,
        optional: false,
        bundled: false,
      },
    ],
  };
  informe.metadata.vulnerabilities.high = 2;

  const resultado = evaluateAuditReport(informe, 1, politicaAprobada, fechaDentroDeVigencia);

  expect(resultado.permitted).toBe(false);
  expect(resultado.message).toContain('no autorizada');
}

test('rechaza cualquier otra alerta alta o crítica', rechazaOtraAlertaAlta);

/** Rechaza un resumen distinto del asociado con la excepción aprobada. */
async function rechazaResumenInconsistente(): Promise<void> {
  const informe = structuredClone(informeVulnerable);
  informe.metadata.vulnerabilities.moderate = 0;

  const resultado = evaluateAuditReport(informe, 1, politicaAprobada, fechaDentroDeVigencia);

  expect(resultado.permitted).toBe(false);
  expect(resultado.message).toContain('resumen por severidad');
}

test('rechaza un resumen incongruente con las instancias', rechazaResumenInconsistente);

/** Rechaza cambios de distribución aun cuando el total de instancias coincida. */
async function rechazaDistribucionDeSeveridadInesperada(): Promise<void> {
  const informe = structuredClone(informeVulnerable);
  informe.metadata.vulnerabilities.moderate = 0;
  informe.metadata.vulnerabilities.high = 2;

  const resultado = evaluateAuditReport(informe, 1, politicaAprobada, fechaDentroDeVigencia);

  expect(resultado.permitted).toBe(false);
  expect(resultado.message).toContain('resumen de alertas high');
}

test(
  'rechaza cambios de severidad en el resumen de la excepción',
  rechazaDistribucionDeSeveridadInesperada,
);

/** Rechaza cualquier advisory moderado adicional bajo la excepción temporal. */
async function rechazaAlertaModeradaAdicional(): Promise<void> {
  const informe = structuredClone(informeVulnerable);
  const advisoryBase = obtenerAdvisory(informe, '1247710');
  informe.advisories['998'] = {
    ...advisoryBase,
    id: 998,
    title: 'Alerta moderada ajena a la excepción',
    module_name: 'otro-paquete',
    severity: 'moderate',
    vulnerable_versions: '<1.0.0',
    patched_versions: '1.0.0',
    patched_versions_unpublished: false,
    github_advisory_id: 'GHSA-moderada',
    url: 'https://github.com/advisories/GHSA-moderada',
    findings: [
      {
        version: '0.9.0',
        paths: ['.>otro-paquete'],
        dev: true,
        optional: false,
        bundled: false,
      },
    ],
  };
  informe.metadata.vulnerabilities.moderate = 2;

  const resultado = evaluateAuditReport(informe, 1, politicaAprobada, fechaDentroDeVigencia);

  expect(resultado.permitted).toBe(false);
  expect(resultado.message).toContain('umbral high');
}

test(
  'rechaza alertas moderadas adicionales aunque no sean bloqueantes',
  rechazaAlertaModeradaAdicional,
);

/**
 * Rechaza versiones de picomatch que no estén incluidas en la aprobación temporal.
 *
 * @returns Una promesa de prueba que verifica el rechazo de una versión nueva.
 */
async function rechazaVersionNoAprobada(): Promise<void> {
  const informe = structuredClone(informeVulnerable);
  obtenerHallazgo(informe, '1247710', 1).version = '4.0.8';

  const resultado = evaluateAuditReport(informe, 1, politicaAprobada, fechaDentroDeVigencia);

  expect(resultado.permitted).toBe(false);
  expect(resultado.message).toContain('versión');
}

test('rechaza una versión no incluida en la allowlist', rechazaVersionNoAprobada);

/**
 * Rechaza informes con campos ajenos al esquema de auditoría observado.
 *
 * @returns Una promesa de prueba que verifica el rechazo ante un esquema desconocido.
 */
async function rechazaEsquemaDesconocido(): Promise<void> {
  const informe = { ...structuredClone(informeVulnerable), unexpected: true };

  const resultado = evaluateAuditReport(informe, 1, politicaAprobada, fechaDentroDeVigencia);

  expect(resultado.permitted).toBe(false);
  expect(resultado.message).toContain('esquema');
}

test('rechaza un esquema de auditoría con campos desconocidos', rechazaEsquemaDesconocido);

/**
 * Rechaza la excepción una vez superado el día de vencimiento aprobado.
 *
 * @returns Una promesa de prueba que verifica que la allowlist temporal vence.
 */
async function rechazaUnaExcepcionVencida(): Promise<void> {
  const resultado = evaluateAuditReport(
    informeVulnerable,
    1,
    politicaAprobada,
    new Date('2026-12-18T00:00:00.000Z'),
  );

  expect(resultado.permitted).toBe(false);
  expect(resultado.message).toContain('vencida');
}

test('rechaza la excepción después del vencimiento', rechazaUnaExcepcionVencida);

/**
 * Rechaza un audit que reporte hallazgos altos aunque su código de salida sea cero.
 *
 * @returns Una promesa de prueba que verifica que el wrapper no oculte el FAIL original.
 */
async function rechazaCodigoDeSalidaInconsistente(): Promise<void> {
  const resultado = evaluateAuditReport(
    informeVulnerable,
    0,
    politicaAprobada,
    fechaDentroDeVigencia,
  );

  expect(resultado.permitted).toBe(false);
  expect(resultado.message).toContain('código de salida');
}

test(
  'rechaza hallazgos altos cuando el audit original no devolvió el código esperado',
  rechazaCodigoDeSalidaInconsistente,
);

/**
 * Acepta un informe limpio sin aplicar la excepción aprobada.
 *
 * @returns Una promesa de prueba que verifica el estado limpio del audit.
 */
async function aceptaUnAuditLimpio(): Promise<void> {
  const informe = structuredClone(informeVulnerable);
  informe.advisories = {};
  informe.metadata.vulnerabilities.info = 0;
  informe.metadata.vulnerabilities.low = 0;
  informe.metadata.vulnerabilities.moderate = 0;
  informe.metadata.vulnerabilities.high = 0;
  informe.metadata.vulnerabilities.critical = 0;

  const resultado = evaluateAuditReport(informe, 0, politicaAprobada, fechaDentroDeVigencia);

  expect(resultado.permitted).toBe(true);
  expect(resultado.exceptionApplied).toBe(false);
}

test('acepta una auditoría limpia sin aplicar la excepción', aceptaUnAuditLimpio);

/**
 * Acepta el resumen de pnpm cuando el umbral high omite advisories moderados.
 *
 * @returns Una promesa de prueba que verifica la semántica de filtro por umbral.
 */
async function aceptaModeradosFueraDelUmbral(): Promise<void> {
  const informe = structuredClone(informeVulnerable);
  informe.advisories = {};
  informe.metadata.vulnerabilities.info = 0;
  informe.metadata.vulnerabilities.low = 0;
  informe.metadata.vulnerabilities.moderate = 1;
  informe.metadata.vulnerabilities.high = 0;
  informe.metadata.vulnerabilities.critical = 0;

  const resultado = evaluateAuditReport(informe, 0, politicaAprobada, fechaDentroDeVigencia);

  expect(resultado.permitted).toBe(true);
  expect(resultado.exceptionApplied).toBe(false);
  expect(resultado.message).toContain('sin hallazgos high/critical');
}

test(
  'acepta el reporte filtrado por high si solo quedan advisories moderados',
  aceptaModeradosFueraDelUmbral,
);

/**
 * Rechaza una severidad crítica aunque el GHSA sea el advisory conocido.
 *
 * @returns Una promesa de prueba que verifica que la excepción no absorba un crítico.
 */
async function rechazaSeveridadCritica(): Promise<void> {
  const informe = structuredClone(informeVulnerable);
  obtenerAdvisory(informe, '1247710').severity = 'critical';
  informe.metadata.vulnerabilities.high = 0;
  informe.metadata.vulnerabilities.critical = 1;

  const resultado = evaluateAuditReport(informe, 1, politicaAprobada, fechaDentroDeVigencia);

  expect(resultado.permitted).toBe(false);
  expect(resultado.message).toContain('severidad');
}

test('rechaza que el advisory conocido cambie a severidad crítica', rechazaSeveridadCritica);

/**
 * Rechaza la excepción si el registro comienza a declarar una versión corregida.
 *
 * @returns Una promesa de prueba que verifica que un parche publicado obliga a actualizar.
 */
async function rechazaUnParchePublicado(): Promise<void> {
  const informe = structuredClone(informeVulnerable);
  const advisory = obtenerAdvisory(informe, '1247710');
  advisory.patched_versions = '>4.0.7';
  advisory.patched_versions_unpublished = false;

  const resultado = evaluateAuditReport(informe, 1, politicaAprobada, fechaDentroDeVigencia);

  expect(resultado.permitted).toBe(false);
  expect(resultado.message).toContain('parche');
}

test('rechaza la excepción cuando pnpm informa una versión corregida', rechazaUnParchePublicado);
