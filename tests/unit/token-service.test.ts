import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { crearTokenOpaco } from '../../apps/api/src/auth/token-service.js';

/** Agrupa pruebas de formato y entropía para los tokens de un solo uso. */
function definirPruebasDeTokenOpaco(): void {
  it('genera un valor base64url con 32 bytes aleatorios', pruebaLongitudDeToken);
  it('devuelve el digest SHA-256 y nunca lo confunde con el token', pruebaDigestDeToken);
  it('genera valores distintos en invocaciones independientes', pruebaAleatoriedadDeToken);
}

/** Comprueba que el token contenga exactamente 256 bits antes de codificarse. */
function pruebaLongitudDeToken(): void {
  const token = crearTokenOpaco();

  expect(Buffer.from(token.valor, 'base64url')).toHaveLength(32);
  expect(token.valor).toMatch(/^[A-Za-z0-9_-]{43}$/u);
}

/** Comprueba el digest hexadecimal de 64 caracteres usado por la persistencia. */
function pruebaDigestDeToken(): void {
  const token = crearTokenOpaco();
  const digestEsperado = createHash('sha256').update(token.valor).digest('hex');

  expect(token.digest).toBe(digestEsperado);
  expect(token.digest).not.toBe(token.valor);
  expect(token.digest).toMatch(/^[a-f0-9]{64}$/u);
}

/** Comprueba que tokens consecutivos no reutilicen el mismo secreto. */
function pruebaAleatoriedadDeToken(): void {
  expect(crearTokenOpaco().valor).not.toBe(crearTokenOpaco().valor);
}

describe('tokens opacos', definirPruebasDeTokenOpaco);
