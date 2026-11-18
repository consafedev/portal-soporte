/** Propósitos admitidos en los enlaces de un solo uso del portal. */
export type FlujoEnlace = 'activation' | 'recovery' | 'email-change' | 'verify-email';

/**
 * Obtiene el encabezado seguro del flujo sin interpolar información del enlace.
 *
 * @param flujo - Propósito validado del token o `null` si el enlace no se verificó.
 * @returns Encabezado localizado y adecuado para el estado visible.
 */
export function obtenerTituloFlujo(flujo: FlujoEnlace | null): string {
  if (flujo === null) {
    return 'No se pudo verificar el enlace';
  }
  if (flujo === 'activation') {
    return 'Activa tu cuenta';
  }
  if (flujo === 'email-change' || flujo === 'verify-email') {
    return 'Verifica tu correo';
  }

  return 'Define una contraseña nueva';
}

/**
 * Describe el siguiente paso permitido sin afirmar que un enlace inválido puede usarse.
 *
 * @param flujo - Propósito validado del token o `null` si el enlace no se verificó.
 * @returns Instrucción localizada correspondiente al propósito o al estado inválido.
 */
export function obtenerDescripcionFlujo(flujo: FlujoEnlace | null): string {
  if (flujo === null) {
    return 'Solicita un enlace nuevo desde la pantalla de recuperación.';
  }
  if (flujo === 'activation' || flujo === 'recovery') {
    return 'Elige una contraseña que solo tú conozcas.';
  }

  return 'Confirma el correo desde el que abriste este enlace.';
}
