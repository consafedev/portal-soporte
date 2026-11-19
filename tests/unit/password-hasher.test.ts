import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from '../../apps/api/src/auth/argon2-password-hasher.js';

const hasheador = new Argon2PasswordHasher();
const contrasenaSintetica = ' frase de prueba larga con unicode ñ 🔐 ';

/** Agrupa pruebas de la implementación Argon2id y del formato PHC resultante. */
function definirPruebasDeArgon2id(): void {
  it('genera un PHC Argon2id con los parámetros aprobados', pruebaParametrosArgon2id);
  it('usa una sal aleatoria diferente para cada hash', pruebaSalAleatoriaPorHash);
  it('verifica únicamente la contraseña original sin recortarla', pruebaVerificacionExacta);
  it('rechaza hashes malformados sin propagar detalles criptográficos', pruebaHashMalformado);
}

/** Comprueba algoritmo, versión y costo de memoria/trabajo del PHC. */
async function pruebaParametrosArgon2id(): Promise<void> {
  const hash = await hasheador.hash(contrasenaSintetica);

  expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/u);
  expect(hash).not.toContain(contrasenaSintetica);
}

/** Comprueba que dos operaciones no compartan la sal Argon2id. */
async function pruebaSalAleatoriaPorHash(): Promise<void> {
  const hashUno = await hasheador.hash(contrasenaSintetica);
  const hashDos = await hasheador.hash(contrasenaSintetica);

  expect(hashUno).not.toBe(hashDos);
}

/** Comprueba que Unicode y espacios externos formen parte exacta del secreto. */
async function pruebaVerificacionExacta(): Promise<void> {
  const hash = await hasheador.hash(contrasenaSintetica);

  await expect(hasheador.verificar(hash, contrasenaSintetica)).resolves.toBe(true);
  await expect(hasheador.verificar(hash, contrasenaSintetica.trim())).resolves.toBe(false);
  await expect(hasheador.verificar(hash, `${contrasenaSintetica}x`)).resolves.toBe(false);
}

/** Comprueba que una cadena no PHC se rechace como credencial inválida. */
async function pruebaHashMalformado(): Promise<void> {
  await expect(hasheador.verificar('hash-sintetico-malformado', contrasenaSintetica)).resolves.toBe(
    false,
  );
}

describe('hash Argon2id de contraseñas', definirPruebasDeArgon2id);
