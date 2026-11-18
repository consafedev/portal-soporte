/** Resultado de evaluar una salida completa de pnpm audit contra la autorización temporal. */
export interface AuditPolicyEvaluation {
  /** Indica si CI puede continuar bajo el resultado comprobado. */
  permitted: boolean;
  /** Indica si se usó la excepción de desarrollo aprobada. */
  exceptionApplied: boolean;
  /** Explica el resultado y conserva explícito el estado del audit original. */
  message: string;
}

/**
 * Valida el esquema del audit y aplica únicamente la excepción temporal autorizada.
 *
 * @param report - JSON ya analizado que devolvió pnpm audit.
 * @param auditExitCode - Código original del proceso pnpm audit.
 * @param allowlist - Registro de aprobación versionado en el repositorio.
 * @param currentDate - Fecha actual inyectable para verificar el vencimiento.
 * @returns Decisión de continuar y mensaje de trazabilidad.
 */
export function evaluateAuditReport(
  report: unknown,
  auditExitCode: number,
  allowlist: unknown,
  currentDate: Date,
): AuditPolicyEvaluation;
