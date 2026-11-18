import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  adminCreateUserSchema,
  adminUserResponseSchema,
  loginRequestSchema,
  publicUserResponseSchema,
} from '../packages/contracts/src/auth.js';

/** Agrupa las pruebas de validación runtime de contratos de autenticación. */
function definirPruebasDeContratos(): void {
  it('rechaza propiedades desconocidas en el login', pruebaLoginRechazaPropiedadExtra);
  it('rechaza un username que no cumple el formato acordado', pruebaLoginRechazaUsuarioInvalido);
  it('acepta exclusivamente los roles definidos', pruebaAltaAdminAceptaRolValido);
  it('no permite secretos en la respuesta pública', pruebaRespuestaPublicaNoIncluyeSecretos);
  it('no permite hashes ni tokens en el DTO administrativo', pruebaRespuestaAdminNoIncluyeSecretos);
}

/** Comprueba que el login no ignore ni acepte propiedades adicionales. */
function pruebaLoginRechazaPropiedadExtra(): void {
  expect(
    Value.Check(loginRequestSchema, {
      username: 'soporte_1',
      password: 'muestra-sintetica-de-prueba',
      role: 'ADMIN',
    }),
  ).toBe(false);
}

/** Comprueba que el login solo acepte el username ASCII del contrato. */
function pruebaLoginRechazaUsuarioInvalido(): void {
  expect(
    Value.Check(loginRequestSchema, {
      username: 'agente@correo.test',
      password: 'muestra-sintetica-de-prueba',
    }),
  ).toBe(false);
}

/** Comprueba que el alta administrativa acepte un rol soportado. */
function pruebaAltaAdminAceptaRolValido(): void {
  expect(
    Value.Check(adminCreateUserSchema, {
      username: 'soporte_1',
      email: 'soporte@example.test',
      displayName: 'Cuenta Sintética',
      role: 'SUPPORT',
    }),
  ).toBe(true);
}

/** Comprueba que el contrato de identidad pública cierre el DTO ante secretos. */
function pruebaRespuestaPublicaNoIncluyeSecretos(): void {
  expect(
    Value.Check(publicUserResponseSchema, {
      id: '16a0c35a-f49f-4b01-9bd7-18ac6a7c9ae3',
      username: 'soporte_1',
      displayName: 'Cuenta Sintética',
      role: 'SUPPORT',
      passwordHash: 'hash-sintetico-que-debe-rechazarse',
    }),
  ).toBe(false);
}

/** Comprueba que el DTO administrativo tampoco admita hashes ni tokens. */
function pruebaRespuestaAdminNoIncluyeSecretos(): void {
  expect(
    Value.Check(adminUserResponseSchema, {
      id: '16a0c35a-f49f-4b01-9bd7-18ac6a7c9ae3',
      username: 'soporte_1',
      displayName: 'Cuenta Sintética',
      role: 'SUPPORT',
      email: 'soporte@example.test',
      emailVerifiedAt: null,
      status: 'ACTIVE',
      createdAt: '2026-11-17T12:00:00.000Z',
      recoveryToken: 'token-sintetico-que-debe-rechazarse',
    }),
  ).toBe(false);
}

describe('contratos de autenticación', definirPruebasDeContratos);
