import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TAMANO_SEMILLA_BYTES = 20;
const TAMANO_CLAVE_AES_BYTES = 32;
const TAMANO_NONCE_AES_BYTES = 12;
const TAMANO_TAG_AES_BYTES = 16;
const PASO_TOTP_SEGUNDOS = 30;
const VENTANA_TOTP_MAXIMA = 5;
const CONTADOR_TOTP_MAXIMO = 0xffff_ffff_ffff_ffffn;

/** Datos cifrados versionados de una semilla TOTP; nunca incluyen la clave. */
export interface SemillaTotpCifrada {
  /** Versión del formato para poder migrar el cifrado de forma explícita. */
  readonly version: 1;
  /** Nonce GCM aleatorio en Base64URL sin padding. */
  readonly nonce: string;
  /** Semilla cifrada en Base64URL sin padding. */
  readonly cifrado: string;
  /** Etiqueta de autenticación GCM en Base64URL sin padding. */
  readonly etiqueta: string;
}

/** Genera una semilla TOTP aleatoria de 160 bits en Base32 canónico sin padding. */
export function generarSemillaTotpBase32(): string {
  return codificarBase32(randomBytes(TAMANO_SEMILLA_BYTES));
}

/** Calcula el código HOTP para un contador y seis u ocho dígitos según RFC 4226. */
export function calcularCodigoTotp(
  semillaBase32: string,
  contador: bigint,
  digitos: 6 | 8 = 6,
): string {
  const clave = decodificarBase32(semillaBase32);
  validarContadorTotp(contador);
  validarDigitosTotp(digitos);

  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(contador);
  const resumen = createHmac('sha1', clave).update(mensaje).digest();
  const desplazamiento = resumen[resumen.length - 1]! & 0x0f;
  const entero = resumen.readUInt32BE(desplazamiento) & 0x7fff_ffff;
  const codigo = entero % 10 ** digitos;

  return codigo.toString().padStart(digitos, '0');
}

/** Verifica una ventana acotada y devuelve el contador coincidente para el anti-replay transaccional. */
export function verificarCodigoTotp(
  semillaBase32: string,
  codigo: string,
  instanteUnixMs: number,
  ventana: number,
): bigint | null {
  decodificarBase32(semillaBase32);
  validarVentanaTotp(ventana);
  if (!Number.isSafeInteger(instanteUnixMs) || instanteUnixMs < 0) {
    throw new Error('MFA_TOTP_INSTANT_INVALID');
  }
  if (!/^\d{6}$/u.test(codigo)) return null;

  const contadorActual = BigInt(Math.floor(instanteUnixMs / (PASO_TOTP_SEGUNDOS * 1_000)));
  let contadorCoincidente: bigint | null = null;
  for (let distancia = 0; distancia <= ventana; distancia += 1) {
    const candidatos =
      distancia === 0
        ? [contadorActual]
        : [contadorActual - BigInt(distancia), contadorActual + BigInt(distancia)];
    for (const candidato of candidatos) {
      if (candidato < 0n || candidato > CONTADOR_TOTP_MAXIMO) continue;
      const esperado = calcularCodigoTotp(semillaBase32, candidato);
      if (compararTextoConstante(codigo, esperado) && contadorCoincidente === null) {
        contadorCoincidente = candidato;
      }
    }
  }

  return contadorCoincidente;
}

/** Cifra una semilla TOTP con AES-256-GCM y vincula el texto autenticado al usuario. */
export function cifrarSemillaTotp(
  semillaBase32: string,
  clave: Uint8Array,
  idUsuario: string,
): SemillaTotpCifrada {
  const semilla = decodificarBase32(semillaBase32);
  const claveValidada = validarClaveCifrado(clave);
  const aad = codificarAad(idUsuario);
  const nonce = randomBytes(TAMANO_NONCE_AES_BYTES);
  const cifrador = createCipheriv('aes-256-gcm', claveValidada, nonce);
  cifrador.setAAD(aad);
  const cifrado = Buffer.concat([cifrador.update(semilla), cifrador.final()]);

  return {
    version: 1,
    nonce: nonce.toString('base64url'),
    cifrado: cifrado.toString('base64url'),
    etiqueta: cifrador.getAuthTag().toString('base64url'),
  };
}

/** Descifra y autentica una semilla TOTP; cualquier fallo criptográfico usa un error estable. */
export function descifrarSemillaTotp(
  datos: SemillaTotpCifrada,
  clave: Uint8Array,
  idUsuario: string,
): string {
  try {
    if (datos.version !== 1) throw new Error('MFA_CIPHERTEXT_VERSION_INVALID');
    const claveValidada = validarClaveCifrado(clave);
    const nonce = decodificarBase64Url(datos.nonce, TAMANO_NONCE_AES_BYTES);
    const cifrado = decodificarBase64Url(datos.cifrado);
    const etiqueta = decodificarBase64Url(datos.etiqueta, TAMANO_TAG_AES_BYTES);
    if (cifrado.length === 0 || cifrado.length > 80) {
      throw new Error('MFA_CIPHERTEXT_INVALID');
    }

    const descifrador = createDecipheriv('aes-256-gcm', claveValidada, nonce);
    descifrador.setAAD(codificarAad(idUsuario));
    descifrador.setAuthTag(etiqueta);
    const bytesSemilla = Buffer.concat([descifrador.update(cifrado), descifrador.final()]);
    const semilla = codificarBase32(bytesSemilla);
    decodificarBase32(semilla);

    return semilla;
  } catch {
    throw new Error('MFA_SEED_DECRYPTION_FAILED');
  }
}

/** Genera un código de recuperación aleatorio con 160 bits de entropía. */
export function generarCodigoRecuperacion(): string {
  return randomBytes(20).toString('base64url');
}

/** Calcula el digest SHA-256 de un código de recuperación aleatorio de formato válido. */
export function calcularDigestCodigoRecuperacion(codigo: string): string {
  if (!/^[A-Za-z0-9_-]{27}$/u.test(codigo)) {
    throw new Error('MFA_RECOVERY_CODE_INVALID');
  }

  return createHash('sha256').update(codigo, 'utf8').digest('hex');
}

/** Compara en tiempo constante el código de recuperación con su digest hexadecimal persistido. */
export function validarCodigoRecuperacion(codigo: string, digestEsperado: string): boolean {
  if (!/^[A-Za-z0-9_-]{27}$/u.test(codigo) || !/^[a-f0-9]{64}$/u.test(digestEsperado)) {
    return false;
  }

  const digestCalculado = Buffer.from(calcularDigestCodigoRecuperacion(codigo), 'hex');
  const digestPersistido = Buffer.from(digestEsperado, 'hex');

  return timingSafeEqual(digestCalculado, digestPersistido);
}

/** Codifica bytes como Base32 RFC 4648 sin padding. */
function codificarBase32(bytes: Uint8Array): string {
  let acumulador = 0;
  let bitsDisponibles = 0;
  let salida = '';
  for (const byte of bytes) {
    acumulador = (acumulador << 8) | byte;
    bitsDisponibles += 8;
    while (bitsDisponibles >= 5) {
      bitsDisponibles -= 5;
      salida += ALFABETO_BASE32[(acumulador >>> bitsDisponibles) & 0x1f]!;
      acumulador &= (1 << bitsDisponibles) - 1;
    }
  }
  if (bitsDisponibles > 0) {
    salida += ALFABETO_BASE32[(acumulador << (5 - bitsDisponibles)) & 0x1f]!;
  }

  return salida;
}

/** Decodifica Base32 canónico y rechaza padding, alfabetos alternos y bits residuales no nulos. */
function decodificarBase32(valor: string): Buffer {
  if (valor.length !== 32 || !/^[A-Z2-7]+$/u.test(valor)) {
    throw new Error('MFA_TOTP_SEED_INVALID');
  }

  let acumulador = 0;
  let bitsDisponibles = 0;
  const bytes: number[] = [];
  for (const caracter of valor) {
    const indice = ALFABETO_BASE32.indexOf(caracter);
    if (indice < 0) throw new Error('MFA_TOTP_SEED_INVALID');
    acumulador = (acumulador << 5) | indice;
    bitsDisponibles += 5;
    if (bitsDisponibles >= 8) {
      bitsDisponibles -= 8;
      bytes.push((acumulador >>> bitsDisponibles) & 0xff);
      acumulador &= (1 << bitsDisponibles) - 1;
    }
  }

  const bitsResidualesValidos = [0, 1, 2, 3, 4].includes(bitsDisponibles);
  if (!bitsResidualesValidos || acumulador !== 0 || codificarBase32(Buffer.from(bytes)) !== valor) {
    throw new Error('MFA_TOTP_SEED_INVALID');
  }

  return Buffer.from(bytes);
}

/** Decodifica Base64URL únicamente cuando la forma textual y su codificación son canónicas. */
function decodificarBase64Url(valor: string, longitudExacta?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(valor)) throw new Error('MFA_CIPHERTEXT_INVALID');
  const bytes = Buffer.from(valor, 'base64url');
  if (
    bytes.toString('base64url') !== valor ||
    (longitudExacta !== undefined && bytes.length !== longitudExacta)
  ) {
    throw new Error('MFA_CIPHERTEXT_INVALID');
  }

  return bytes;
}

/** Valida clave AES-256 y crea una copia local para evitar mutación durante el cifrado. */
function validarClaveCifrado(clave: Uint8Array): Buffer {
  if (clave.length !== TAMANO_CLAVE_AES_BYTES) throw new Error('MFA_SEED_KEY_INVALID');

  return Buffer.from(clave);
}

/** Convierte el identificador de usuario en AAD acotado para evitar reasignación de ciphertext. */
function codificarAad(idUsuario: string): Buffer {
  if (idUsuario.length === 0 || idUsuario.length > 128) throw new Error('MFA_USER_ID_INVALID');

  return Buffer.from(idUsuario, 'utf8');
}

/** Valida que el contador HOTP quepa en los ocho bytes definidos por RFC 4226. */
function validarContadorTotp(contador: bigint): void {
  if (contador < 0n || contador > CONTADOR_TOTP_MAXIMO) {
    throw new Error('MFA_TOTP_COUNTER_INVALID');
  }
}

/** Rechaza ventanas no enteras o mayores al máximo local de cinco pasos. */
function validarVentanaTotp(ventana: number): void {
  if (!Number.isInteger(ventana) || ventana < 0 || ventana > VENTANA_TOTP_MAXIMA) {
    throw new Error('MFA_TOTP_WINDOW_INVALID');
  }
}

/** Restringe la salida HOTP a los tamaños de seis u ocho dígitos definidos en RFC 4226. */
function validarDigitosTotp(digitos: number): void {
  if (digitos !== 6 && digitos !== 8) throw new Error('MFA_TOTP_DIGITS_INVALID');
}

/** Compara dos cadenas ASCII de igual longitud sin terminar tras una coincidencia parcial. */
function compararTextoConstante(izquierda: string, derecha: string): boolean {
  const bytesIzquierda = Buffer.from(izquierda, 'ascii');
  const bytesDerecha = Buffer.from(derecha, 'ascii');
  if (bytesIzquierda.length !== bytesDerecha.length) return false;

  return timingSafeEqual(bytesIzquierda, bytesDerecha);
}
