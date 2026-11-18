import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type { HasheadorContrasena } from '../../../../packages/core/src/auth/ports.js';

const OPCIONES_ARGON2ID: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
};

/** Adapta Argon2id con el perfil aprobado para hashes de contraseñas del portal. */
export class Argon2PasswordHasher implements HasheadorContrasena {
  /** Produce una cadena PHC con sal aleatoria y el costo Argon2id requerido. */
  public async hash(contrasena: string): Promise<string> {
    return argon2.hash(contrasena, OPCIONES_ARGON2ID);
  }

  /** Verifica en tiempo criptográfico un PHC Argon2id y rechaza cualquier formato inválido. */
  public async verificar(hash: string, contrasena: string): Promise<boolean> {
    if (!hash.startsWith('$argon2id$')) {
      return false;
    }

    try {
      return await argon2.verify(hash, contrasena);
    } catch {
      return false;
    }
  }

  /** Genera una credencial aleatoria de costo equivalente para usuarios inexistentes. */
  public async crearHashDummy(): Promise<string> {
    return argon2.hash(randomBytes(32), OPCIONES_ARGON2ID);
  }
}
