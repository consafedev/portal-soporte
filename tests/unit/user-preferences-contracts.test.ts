import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  userPreferencesResponseSchema,
  updateUserPreferencesSchema,
} from '../../packages/contracts/src/user-preferences.js';

/** Agrupa las validaciones runtime del contrato de preferencias personales. */
function definirPruebasContratoPreferencias(): void {
  it('acepta los tres temas definidos por el contrato', pruebaTemasPermitidos);
  it('rechaza un tema desconocido y propiedades adicionales', pruebaEntradaEstricta);
  it('limita la respuesta a la preferencia sin datos de identidad', pruebaRespuestaAcotada);
}

/** Comprueba que el esquema de actualización y el DTO acepten claro, oscuro y sistema. */
function pruebaTemasPermitidos(): void {
  for (const theme of ['system', 'light', 'dark'] as const) {
    expect(Value.Check(updateUserPreferencesSchema, { theme })).toBe(true);
    expect(Value.Check(userPreferencesResponseSchema, { theme })).toBe(true);
  }
}

/** Comprueba que no se acepten valores ni campos ajenos a las preferencias acordadas. */
function pruebaEntradaEstricta(): void {
  expect(Value.Check(updateUserPreferencesSchema, { theme: 'auto' })).toBe(false);
  expect(Value.Check(updateUserPreferencesSchema, { theme: 'dark', userId: 'otro' })).toBe(false);
}

/** Comprueba que respuestas de preferencias no puedan incorporar identidad o secretos. */
function pruebaRespuestaAcotada(): void {
  expect(
    Value.Check(userPreferencesResponseSchema, {
      theme: 'system',
      username: 'cuenta-sintetica',
      passwordHash: 'hash-sintetico',
    }),
  ).toBe(false);
}

describe('contrato de preferencias personales', definirPruebasContratoPreferencias);
