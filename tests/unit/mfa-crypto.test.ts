import { describe, expect, it } from 'vitest';
import {
  calcularCodigoTotp,
  calcularDigestCodigoRecuperacion,
  cifrarSemillaTotp,
  descifrarSemillaTotp,
  generarCodigoRecuperacion,
  generarSemillaTotpBase32,
  validarCodigoRecuperacion,
  verificarCodigoTotp,
} from '../../apps/api/src/auth/mfa-crypto.js';

const semillaRfcBase32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const idUsuarioSintetico = '00000000-0000-4000-8000-000000000003';
const claveCifradoSintetica = Buffer.alloc(32, 7);

describe('primitivas criptográficas de MFA', () => {
  it('calcula los vectores SHA-1 de RFC 6238 con ocho dígitos', () => {
    const vectores = [
      { instante: 59_000, esperado: '94287082' },
      { instante: 1_111_111_109_000, esperado: '07081804' },
      { instante: 1_111_111_111_000, esperado: '14050471' },
      { instante: 1_234_567_890_000, esperado: '89005924' },
      { instante: 2_000_000_000_000, esperado: '69279037' },
    ];

    for (const vector of vectores) {
      const contador = BigInt(Math.floor(vector.instante / 30_000));
      expect(calcularCodigoTotp(semillaRfcBase32, contador, 8)).toBe(vector.esperado);
    }
  });

  it('devuelve el contador coincidente para que persistencia aplique anti-replay', () => {
    const contadorPrecedente = 42n;
    const codigo = calcularCodigoTotp(semillaRfcBase32, contadorPrecedente);
    const contadorCoincidente = verificarCodigoTotp(
      semillaRfcBase32,
      codigo,
      Number((contadorPrecedente + 1n) * 30_000n),
      1,
    );

    expect(contadorCoincidente).toBe(contadorPrecedente);
  });

  it('rechaza una ventana de verificación mayor al límite configurado', () => {
    expect(() => verificarCodigoTotp(semillaRfcBase32, '123456', 90_000, 6)).toThrow(
      'MFA_TOTP_WINDOW_INVALID',
    );
  });

  it('genera una semilla Base32 de 160 bits sin padding', () => {
    const semilla = generarSemillaTotpBase32();

    expect(semilla).toMatch(/^[A-Z2-7]{32}$/u);
  });

  it('cifra y descifra la semilla vinculándola al identificador de usuario', () => {
    const semilla = generarSemillaTotpBase32();
    const cifrada = cifrarSemillaTotp(semilla, claveCifradoSintetica, idUsuarioSintetico);

    expect(descifrarSemillaTotp(cifrada, claveCifradoSintetica, idUsuarioSintetico)).toBe(semilla);
    expect(() => descifrarSemillaTotp(cifrada, claveCifradoSintetica, 'otro-usuario')).toThrow(
      'MFA_SEED_DECRYPTION_FAILED',
    );
  });

  it('rechaza una semilla cifrada cuyo tag de autenticación fue alterado', () => {
    const cifrada = cifrarSemillaTotp(semillaRfcBase32, claveCifradoSintetica, idUsuarioSintetico);
    const alterada = {
      ...cifrada,
      etiqueta: `${cifrada.etiqueta[0] === 'A' ? 'B' : 'A'}${cifrada.etiqueta.slice(1)}`,
    };

    expect(() => descifrarSemillaTotp(alterada, claveCifradoSintetica, idUsuarioSintetico)).toThrow(
      'MFA_SEED_DECRYPTION_FAILED',
    );
  });

  it('genera códigos de recuperación de alta entropía y valida su digest', () => {
    const codigo = generarCodigoRecuperacion();
    const digest = calcularDigestCodigoRecuperacion(codigo);
    const codigoAlterno = `${codigo[0] === 'A' ? 'B' : 'A'}${codigo.slice(1)}`;

    expect(codigo).toMatch(/^[A-Za-z0-9_-]{27}$/u);
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(validarCodigoRecuperacion(codigo, digest)).toBe(true);
    expect(validarCodigoRecuperacion(codigoAlterno, digest)).toBe(false);
    expect(validarCodigoRecuperacion(`${codigo}x`, digest)).toBe(false);
    expect(validarCodigoRecuperacion(codigo, 'digest-malformado')).toBe(false);
  });
});
