import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  adminCreateUserSchema,
  adminCreateUserResponseSchema,
  adminPasswordResetSchema,
  adminUserResponseSchema,
  loginRequestSchema,
  publicUserResponseSchema,
} from '../packages/contracts/src/auth.js';

/** Agrupa las pruebas de validación runtime de contratos de autenticación. */
function definirPruebasDeContratos(): void {
  it('rechaza propiedades desconocidas en el login', pruebaLoginRechazaPropiedadExtra);
  it('rechaza un username que no cumple el formato acordado', pruebaLoginRechazaUsuarioInvalido);
  it('acepta exclusivamente los roles definidos', pruebaAltaAdminAceptaRolValido);
  it(
    'valida la credencial que ADMIN asigna en un restablecimiento directo',
    pruebaResetDirectoAdmin,
  );
  it('permite que ADMIN asigne una credencial inicial en el alta directa', pruebaAltaDirectaAdmin);
  it('no permite secretos en la respuesta pública', pruebaRespuestaPublicaNoIncluyeSecretos);
  it('no permite hashes ni tokens en el DTO administrativo', pruebaRespuestaAdminNoIncluyeSecretos);
  it(
    'expone solo el indicador derivado de credencial para cuentas admin',
    pruebaIndicadorCredencialAdmin,
  );
  it('limita la respuesta de alta a estados explícitos de invitación', pruebaEstadosRespuestaAlta);
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

/** Comprueba que la solicitud directa admita contraseña sin ampliar campos no documentados. */
function pruebaAltaDirectaAdmin(): void {
  expect(
    Value.Check(adminCreateUserSchema, {
      username: 'soporte_1',
      email: 'soporte@example.test',
      displayName: 'Cuenta Sintética',
      role: 'SUPPORT',
      initialPassword: 'Clave inicial sintética 123',
    }),
  ).toBe(true);
}

/** Comprueba la política estricta de contraseña para el reset administrativo directo. */
function pruebaResetDirectoAdmin(): void {
  expect(Value.Check(adminPasswordResetSchema, { newPassword: 'Clave nueva sintética 2032' })).toBe(
    true,
  );
  expect(Value.Check(adminPasswordResetSchema, { newPassword: 'corta' })).toBe(false);
  expect(
    Value.Check(adminPasswordResetSchema, {
      newPassword: 'Clave nueva sintética 2032',
      currentPassword: 'campo-no-permitido',
    }),
  ).toBe(false);
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
      hasPassword: true,
      createdAt: '2026-11-17T12:00:00.000Z',
      recoveryToken: 'token-sintetico-que-debe-rechazarse',
    }),
  ).toBe(false);
}

/** Comprueba que el DTO admin distingue cuentas invitadas sin exponer el hash almacenado. */
function pruebaIndicadorCredencialAdmin(): void {
  const usuario = {
    id: '16a0c35a-f49f-4b01-9bd7-18ac6a7c9ae3',
    username: 'soporte_1',
    displayName: 'Cuenta Sintética',
    role: 'SUPPORT',
    email: 'soporte@example.test',
    emailVerifiedAt: null,
    status: 'DISABLED',
    createdAt: '2026-11-17T12:00:00.000Z',
  } as const;

  expect(Value.Check(adminUserResponseSchema, { ...usuario, hasPassword: true })).toBe(true);
  expect(Value.Check(adminUserResponseSchema, { ...usuario, hasPassword: false })).toBe(true);
  expect(
    Value.Check(adminUserResponseSchema, {
      ...usuario,
      hasPassword: true,
      passwordHash: 'hash-sintetico-que-no-debe-exponerse',
    }),
  ).toBe(false);
}

/** Comprueba que la alta exponga únicamente el DTO y los tres resultados seguros del enlace. */
function pruebaEstadosRespuestaAlta(): void {
  const usuario = {
    id: '16a0c35a-f49f-4b01-9bd7-18ac6a7c9ae3',
    username: 'soporte_1',
    displayName: 'Cuenta Sintética',
    role: 'SUPPORT',
    email: 'soporte@example.test',
    emailVerifiedAt: null,
    status: 'PENDING_ACTIVATION',
    hasPassword: false,
    createdAt: '2026-11-17T12:00:00.000Z',
  } as const;
  const estados = ['ACCEPTED', 'RATE_LIMITED', 'DELIVERY_FAILED'] as const;

  for (const invitationStatus of estados) {
    expect(Value.Check(adminCreateUserResponseSchema, { user: usuario, invitationStatus })).toBe(
      true,
    );
  }
  expect(
    Value.Check(adminCreateUserResponseSchema, {
      user: { ...usuario, passwordHash: 'hash-sintetico-no-publico' },
      invitationStatus: 'ACCEPTED',
    }),
  ).toBe(false);
  expect(
    Value.Check(adminCreateUserResponseSchema, { user: usuario, invitationStatus: 'UNKNOWN' }),
  ).toBe(false);

  const usuarioDirecto = { ...usuario, status: 'ACTIVE', hasPassword: true } as const;
  expect(
    Value.Check(adminCreateUserResponseSchema, {
      user: usuarioDirecto,
      credentialStatus: 'SET_BY_ADMIN',
    }),
  ).toBe(true);
  expect(
    Value.Check(adminCreateUserResponseSchema, {
      user: usuarioDirecto,
      credentialStatus: 'SET_BY_ADMIN',
      initialPassword: 'no-debe-ser-respuesta',
    }),
  ).toBe(false);
}

describe('contratos de autenticación', definirPruebasDeContratos);
