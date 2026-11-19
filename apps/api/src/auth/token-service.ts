import { createHash, randomBytes } from 'node:crypto';

/** Par de token de un solo uso y digest seguro para persistencia. */
export interface TokenOpaco {
  /** Valor aleatorio que solo se comunica al navegador o al adaptador de correo. */
  readonly valor: string;
  /** Digest SHA-256 hexadecimal que se guarda en PostgreSQL. */
  readonly digest: string;
}

/** Genera 256 bits aleatorios codificados en base64url y su digest SHA-256. */
export function crearTokenOpaco(): TokenOpaco {
  const valor = randomBytes(32).toString('base64url');

  return { valor, digest: calcularDigestTokenOpaco(valor) };
}

/** Calcula el digest SHA-256 hexadecimal de un valor opaco sin registrar el original. */
export function calcularDigestTokenOpaco(valor: string): string {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

/** Valida forma canónica base64url de 32 bytes antes de consultar una sesión. */
export function esTokenOpacoValido(valor: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(valor)) {
    return false;
  }

  const bytes = Buffer.from(valor, 'base64url');

  return bytes.length === 32 && bytes.toString('base64url') === valor;
}
