import type { ResultadoValidacionContrasena } from './models.js';

/** Expresión ASCII que define los caracteres permitidos en un username. */
const EXPRESION_NOMBRE_USUARIO = /^[A-Za-z0-9._-]{3,64}$/u;

/** Lista local pequeña de claves ampliamente conocidas que deben bloquearse. */
const CONTRASENAS_COMUNES = new Set([
  'password',
  'password123',
  'passwordpassword',
  'letmein',
  'welcome',
  'changeme',
  'qwerty',
  '1234567890',
]);

/**
 * Recorta y convierte a minúsculas un username que ya pasó la validación ASCII.
 * La validación debe aplicarse al valor original para impedir que Unicode se
 * convierta silenciosamente en otro identificador al normalizar.
 *
 * @param valor - Username recibido desde el límite de entrada.
 * @returns Username canónico listo para persistencia o búsqueda.
 */
export function normalizarUsuario(valor: string): string {
  return valor.trim().toLowerCase();
}

/**
 * Comprueba el contrato ASCII del username antes de guardarlo o buscarlo.
 * Se permite recortar espacios externos, pero no espacios internos ni alias
 * de correo.
 *
 * @param valor - Username original recibido desde la solicitud.
 * @returns `true` cuando contiene entre 3 y 64 caracteres permitidos.
 */
export function esNombreUsuarioValido(valor: string): boolean {
  return EXPRESION_NOMBRE_USUARIO.test(valor.trim());
}

/**
 * Canonicaliza el correo para las comparaciones y restricciones de unicidad.
 * No valida sintaxis ni envía correo; esa validación ocurre en el contrato API.
 *
 * @param valor - Correo normalizado para almacenamiento/búsqueda.
 * @returns Correo sin espacios externos y en minúsculas.
 */
export function normalizarCorreo(valor: string): string {
  return valor.trim().toLowerCase();
}

/**
 * Cuenta puntos de código Unicode en vez de unidades UTF-16 de JavaScript.
 *
 * @param texto - Cadena cuya longitud se valida según la política del portal.
 * @returns Cantidad de puntos de código Unicode.
 */
export function contarPuntosCodigo(texto: string): number {
  return Array.from(texto).length;
}

/**
 * Valida longitud y patrones comunes sin transformar la contraseña recibida.
 * Los espacios y Unicode se conservan exactamente para el hash y verificación.
 *
 * @param valor - Contraseña original, sin recortar ni truncar.
 * @returns Resultado sin incluir la contraseña ni datos que permitan inferirla.
 */
export function validarNuevaContrasena(valor: string): ResultadoValidacionContrasena {
  if (valor.length > 256) {
    return crearErrorContrasena('PASSWORD_TOO_LONG');
  }

  const puntos = Array.from(valor);

  if (puntos.length < 15) {
    return crearErrorContrasena('PASSWORD_TOO_SHORT');
  }

  if (puntos.length > 128) {
    return crearErrorContrasena('PASSWORD_TOO_LONG');
  }

  const formaMinimizada = valor.trim().toLowerCase();
  const esRepetida = new Set(puntos).size === 1;

  if (CONTRASENAS_COMUNES.has(formaMinimizada) || esRepetida) {
    return crearErrorContrasena('COMMON_PASSWORD');
  }

  return { valida: true };
}

/**
 * Construye un error estable en español para la política de contraseña.
 *
 * @param codigo - Categoría estable de rechazo para contrato y auditoría.
 * @returns Resultado inválido sin eco del valor recibido.
 */
function crearErrorContrasena(
  codigo: Exclude<ResultadoValidacionContrasena, { readonly valida: true }>['codigo'],
): ResultadoValidacionContrasena {
  /** Mensajes públicos fijos; nunca interpolan ni devuelven la entrada. */
  const mensajes: Record<typeof codigo, string> = {
    PASSWORD_TOO_SHORT: 'La contraseña debe tener al menos 15 puntos de código.',
    PASSWORD_TOO_LONG: 'La contraseña no puede superar 128 puntos de código.',
    COMMON_PASSWORD: 'La contraseña es demasiado común o predecible.',
  };

  return { valida: false, codigo, mensaje: mensajes[codigo] };
}
