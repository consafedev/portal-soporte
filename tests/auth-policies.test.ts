import { describe, expect, it } from 'vitest';
import {
  contarPuntosCodigo,
  esNombreUsuarioValido,
  normalizarCorreo,
  normalizarUsuario,
  validarNuevaContrasena,
} from '../packages/core/src/auth/policies.js';

/** Agrupa las pruebas de las reglas puras de identidad del portal. */
function definirPruebasDePoliticas(): void {
  it('normaliza el nombre de usuario sin alterar su contenido permitido', pruebaNormalizaUsuario);
  it('rechaza nombres de usuario fuera del contrato ASCII', pruebaRechazaUsuarioInvalido);
  it('normaliza el correo sin alterar el alias', pruebaNormalizaCorreo);
  it('cuenta emojis como un punto de código Unicode', pruebaCuentaPuntosDeCodigo);
  it('acepta quince puntos de código Unicode', pruebaAceptaLongitudMinima);
  it('rechaza menos de quince puntos de código', pruebaRechazaLongitudCorta);
  it('rechaza más de ciento veintiocho puntos de código', pruebaRechazaLongitudLarga);
  it('conserva espacios al validar una contraseña', pruebaConservaEspaciosDeContrasena);
  it('rechaza una frase común que cumple la longitud mínima', pruebaRechazaFraseComun);
  it('rechaza secuencias repetidas fáciles de adivinar', pruebaRechazaSecuenciaRepetida);
}

/** Comprueba la normalización definida para el único identificador de login. */
function pruebaNormalizaUsuario(): void {
  expect(normalizarUsuario('  Soporte.Ejemplo_1  ')).toBe('soporte.ejemplo_1');
}

/** Comprueba que el nombre de usuario no admita espacios, arroba o longitudes inválidas. */
function pruebaRechazaUsuarioInvalido(): void {
  expect(esNombreUsuarioValido('ab')).toBe(false);
  expect(esNombreUsuarioValido('agente soporte')).toBe(false);
  expect(esNombreUsuarioValido('agente@soporte')).toBe(false);
  expect(esNombreUsuarioValido('\u212Axy')).toBe(false);
  expect(esNombreUsuarioValido('a'.repeat(65))).toBe(false);
  expect(esNombreUsuarioValido('Agente_1')).toBe(true);
}

/** Comprueba que la canonicalización del correo conserve el alias y dominio. */
function pruebaNormalizaCorreo(): void {
  expect(normalizarCorreo('  Soporte+QA@Example.COM  ')).toBe('soporte+qa@example.com');
}

/** Comprueba que un emoji cuente como un punto y no como dos unidades UTF-16. */
function pruebaCuentaPuntosDeCodigo(): void {
  expect(contarPuntosCodigo('á😺b')).toBe(3);
}

/** Comprueba el mínimo aprobado usando quince puntos, incluido uno suplementario. */
function pruebaAceptaLongitudMinima(): void {
  expect(validarNuevaContrasena(`${'é'.repeat(14)}😺`).valida).toBe(true);
}

/** Comprueba que catorce puntos de código no cumplan la longitud mínima. */
function pruebaRechazaLongitudCorta(): void {
  expect(validarNuevaContrasena('ñ'.repeat(14))).toMatchObject({
    valida: false,
    codigo: 'PASSWORD_TOO_SHORT',
  });
}

/** Comprueba el máximo aprobado sin medir unidades UTF-16. */
function pruebaRechazaLongitudLarga(): void {
  expect(validarNuevaContrasena('x'.repeat(129))).toMatchObject({
    valida: false,
    codigo: 'PASSWORD_TOO_LONG',
  });
}

/** Comprueba que la política acepta espacios y no devuelve una versión recortada. */
function pruebaConservaEspaciosDeContrasena(): void {
  const entrada = `  ${'ñ'.repeat(15)} `;
  const resultado = validarNuevaContrasena(entrada);

  expect(resultado.valida).toBe(true);
  expect(entrada).toBe(`  ${'ñ'.repeat(15)} `);
}

/** Comprueba que superar el mínimo no habilite una frase común conocida. */
function pruebaRechazaFraseComun(): void {
  expect(validarNuevaContrasena('passwordpassword')).toMatchObject({
    valida: false,
    codigo: 'COMMON_PASSWORD',
  });
}

/** Comprueba que una cadena repetida no se acepte por superar el mínimo de longitud. */
function pruebaRechazaSecuenciaRepetida(): void {
  expect(validarNuevaContrasena('x'.repeat(15))).toMatchObject({
    valida: false,
    codigo: 'COMMON_PASSWORD',
  });
}

describe('políticas de identidad', definirPruebasDePoliticas);
