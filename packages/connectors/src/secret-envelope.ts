import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type {
  ContextoSobreSecreto,
  ProveedorClavesMaestras,
  SobreSecretoCifrado,
  VersionClaveMaestra,
} from '../../core/src/clients/secret-custody-ports.js';

/** Rechazo de cifrado con código público estable y mensaje libre de secretos. */
export class ErrorCustodiaSecretos extends Error {
  /** Construye un error seguro que no incorpora valores recibidos ni causas criptográficas. */
  public constructor(
    public readonly code:
      | 'INVALID_SECRET_CONTEXT'
      | 'INVALID_SECRET_ENVELOPE'
      | 'MASTER_KEY_INVALID'
      | 'MASTER_KEY_UNAVAILABLE'
      | 'KEY_VERSION_UNAVAILABLE'
      | 'ENVELOPE_DECRYPTION_FAILED'
      | 'SECRET_PACKAGE_TOO_LARGE',
  ) {
    super(code);
    this.name = 'ErrorCustodiaSecretos';
  }
}

/** Cifra paquetes de credenciales usando DEK por paquete, AAD y llaves maestras versionadas. */
export class ServicioCifradoSecretos {
  /** Crea el servicio con el proveedor recuperable de versiones maestras. */
  public constructor(private readonly proveedor: ProveedorClavesMaestras) {}

  /** Cifra un paquete de bytes y devuelve solo campos base64 autenticados. */
  public async cifrar(
    secreto: Uint8Array,
    contexto: ContextoSobreSecreto,
  ): Promise<SobreSecretoCifrado> {
    if (secreto.byteLength > TAMANO_MAXIMO_PAQUETE) {
      throw new ErrorCustodiaSecretos('SECRET_PACKAGE_TOO_LARGE');
    }
    const aad = crearContextoAutenticado(contexto);
    let claveMaestra: VersionClaveMaestra | null = null;
    let claveDatos: Buffer | null = null;
    let materialMaestro: Buffer | null = null;
    let datosPlano: Buffer | null = null;

    try {
      claveMaestra = await this.proveedor.obtenerActiva();
    } catch {
      throw new ErrorCustodiaSecretos('MASTER_KEY_UNAVAILABLE');
    }

    try {
      validarClaveMaestra(claveMaestra);
      materialMaestro = Buffer.from(claveMaestra.material);
      datosPlano = Buffer.from(secreto);
      claveDatos = randomBytes(TAMANO_CLAVE);
      const cifradoDato = cifrarGcm(datosPlano, claveDatos, aad, TAMANO_NONCE);
      const cifradoClave = cifrarGcm(
        claveDatos,
        materialMaestro,
        crearContextoClave(contexto, claveMaestra.id),
        TAMANO_NONCE,
      );

      return {
        version: 1,
        algoritmo: 'AES-256-GCM',
        idClave: claveMaestra.id,
        nonceClave: cifradoClave.nonce.toString('base64'),
        claveDatosEnvuelta: cifradoClave.ciphertext.toString('base64'),
        tagClave: cifradoClave.tag.toString('base64'),
        nonceDato: cifradoDato.nonce.toString('base64'),
        datoCifrado: cifradoDato.ciphertext.toString('base64'),
        tagDato: cifradoDato.tag.toString('base64'),
      };
    } catch (error) {
      if (error instanceof ErrorCustodiaSecretos) {
        throw error;
      }
      throw new ErrorCustodiaSecretos('MASTER_KEY_INVALID');
    } finally {
      claveMaestra.material.fill(0);
      materialMaestro?.fill(0);
      claveDatos?.fill(0);
      datosPlano?.fill(0);
      aad.fill(0);
    }
  }

  /** Descifra un sobre únicamente cuando su versión y contexto autenticado son válidos. */
  public async descifrar(
    sobre: SobreSecretoCifrado,
    contexto: ContextoSobreSecreto,
  ): Promise<Buffer> {
    const campos = analizarSobre(sobre);
    const aad = crearContextoAutenticado(contexto);
    let claveMaestra: VersionClaveMaestra;
    let claveDatos: Buffer | null = null;

    try {
      claveMaestra = await this.proveedor.obtener(campos.idClave);
    } catch {
      aad.fill(0);
      throw new ErrorCustodiaSecretos('KEY_VERSION_UNAVAILABLE');
    }

    try {
      validarClaveMaestra(claveMaestra);
      claveDatos = desenvolverClaveDatos(campos, claveMaestra, contexto);
      return descifrarPaquete(campos, claveDatos, aad);
    } catch (error) {
      if (error instanceof ErrorCustodiaSecretos) {
        throw error;
      }
      throw new ErrorCustodiaSecretos('ENVELOPE_DECRYPTION_FAILED');
    } finally {
      claveMaestra.material.fill(0);
      claveDatos?.fill(0);
      aad.fill(0);
    }
  }

  /** Reenvuelve la DEK con la versión activa sin descifrar el paquete de credenciales. */
  public async reenvolver(
    sobre: SobreSecretoCifrado,
    contexto: ContextoSobreSecreto,
  ): Promise<SobreSecretoCifrado> {
    const campos = analizarSobre(sobre);
    const aad = crearContextoAutenticado(contexto);
    let claveAnterior: VersionClaveMaestra;
    let claveActiva: VersionClaveMaestra;
    let claveDatos: Buffer | null = null;

    try {
      claveAnterior = await this.proveedor.obtener(campos.idClave);
    } catch {
      aad.fill(0);
      throw new ErrorCustodiaSecretos('KEY_VERSION_UNAVAILABLE');
    }

    try {
      claveActiva = await this.proveedor.obtenerActiva();
    } catch {
      claveAnterior.material.fill(0);
      aad.fill(0);
      throw new ErrorCustodiaSecretos('MASTER_KEY_UNAVAILABLE');
    }

    try {
      validarClaveMaestra(claveAnterior);
      validarClaveMaestra(claveActiva);
      claveDatos = desenvolverClaveDatos(campos, claveAnterior, contexto);
      if (claveActiva.id === campos.idClave) {
        return sobre;
      }

      const cifradoClave = cifrarGcm(
        claveDatos,
        claveActiva.material,
        crearContextoClave(contexto, claveActiva.id),
        TAMANO_NONCE,
      );

      return {
        ...sobre,
        idClave: claveActiva.id,
        nonceClave: cifradoClave.nonce.toString('base64'),
        claveDatosEnvuelta: cifradoClave.ciphertext.toString('base64'),
        tagClave: cifradoClave.tag.toString('base64'),
      };
    } catch (error) {
      if (error instanceof ErrorCustodiaSecretos) {
        throw error;
      }
      throw new ErrorCustodiaSecretos('ENVELOPE_DECRYPTION_FAILED');
    } finally {
      claveAnterior.material.fill(0);
      claveActiva.material.fill(0);
      claveDatos?.fill(0);
      aad.fill(0);
    }
  }
}

interface CamposSobreAnalizados {
  /** Identificador público de la llave maestra. */
  readonly idClave: string;
  /** Nonce de envoltura validado. */
  readonly nonceClave: Buffer;
  /** Clave de datos envuelta validada. */
  readonly claveDatosEnvuelta: Buffer;
  /** Tag GCM de envoltura validado. */
  readonly tagClave: Buffer;
  /** Nonce de datos validado. */
  readonly nonceDato: Buffer;
  /** Paquete cifrado validado. */
  readonly datoCifrado: Buffer;
  /** Tag GCM del paquete validado. */
  readonly tagDato: Buffer;
}

interface ResultadoCifradoGcm {
  /** Nonce aleatorio generado por el módulo criptográfico de Node. */
  readonly nonce: Buffer;
  /** Texto cifrado autenticado. */
  readonly ciphertext: Buffer;
  /** Tag de autenticación de 128 bits. */
  readonly tag: Buffer;
}

/** Construye un AAD inequívoco que impide mover un envelope a otro perfil. */
function crearContextoAutenticado(contexto: ContextoSobreSecreto): Buffer {
  if (
    typeof contexto !== 'object' ||
    contexto === null ||
    !UUID_VALIDO.test(contexto.clientId) ||
    !UUID_VALIDO.test(contexto.profileId) ||
    !['MYSQL_CREDENTIALS', 'SSH_CREDENTIALS', 'TLS_CREDENTIALS'].includes(contexto.purpose)
  ) {
    throw new ErrorCustodiaSecretos('INVALID_SECRET_CONTEXT');
  }

  return Buffer.from(
    JSON.stringify([
      'portal-secret-envelope-v1',
      contexto.clientId.toLowerCase(),
      contexto.profileId.toLowerCase(),
      contexto.purpose,
    ]),
    'utf8',
  );
}

/** Construye AAD separado para que una DEK no pueda reutilizarse entre llaves o contextos. */
function crearContextoClave(contexto: ContextoSobreSecreto, idClave: string): Buffer {
  return Buffer.concat([
    Buffer.from('portal-secret-dek-v1:', 'utf8'),
    crearContextoAutenticado(contexto),
    Buffer.from(`:${idClave}`, 'utf8'),
  ]);
}

/** Valida tamaño e identificador antes de permitir el uso criptográfico de una KEK. */
function validarClaveMaestra(clave: VersionClaveMaestra): void {
  if (!ID_CLAVE_VALIDO.test(clave.id) || clave.material.byteLength !== TAMANO_CLAVE) {
    throw new ErrorCustodiaSecretos('MASTER_KEY_INVALID');
  }
}

/** Analiza y valida estrictamente el formato base64 y sus longitudes criptográficas. */
function analizarSobre(sobre: SobreSecretoCifrado): CamposSobreAnalizados {
  if (
    typeof sobre !== 'object' ||
    sobre === null ||
    Object.keys(sobre).length !== CAMPOS_ENVELOPE.length ||
    !CAMPOS_ENVELOPE.every((campo) => Object.hasOwn(sobre, campo)) ||
    sobre.version !== 1 ||
    sobre.algoritmo !== 'AES-256-GCM' ||
    typeof sobre.idClave !== 'string' ||
    !ID_CLAVE_VALIDO.test(sobre.idClave)
  ) {
    throw new ErrorCustodiaSecretos('INVALID_SECRET_ENVELOPE');
  }

  const nonceClave = decodificarBase64Canonical(sobre.nonceClave);
  const claveDatosEnvuelta = decodificarBase64Canonical(sobre.claveDatosEnvuelta);
  const tagClave = decodificarBase64Canonical(sobre.tagClave);
  const nonceDato = decodificarBase64Canonical(sobre.nonceDato);
  const datoCifrado = decodificarBase64Canonical(sobre.datoCifrado);
  const tagDato = decodificarBase64Canonical(sobre.tagDato);

  if (
    nonceClave.byteLength !== TAMANO_NONCE ||
    claveDatosEnvuelta.byteLength !== TAMANO_CLAVE ||
    tagClave.byteLength !== TAMANO_ETIQUETA ||
    nonceDato.byteLength !== TAMANO_NONCE ||
    datoCifrado.byteLength > TAMANO_MAXIMO_PAQUETE ||
    tagDato.byteLength !== TAMANO_ETIQUETA
  ) {
    throw new ErrorCustodiaSecretos('INVALID_SECRET_ENVELOPE');
  }

  return {
    idClave: sobre.idClave,
    nonceClave,
    claveDatosEnvuelta,
    tagClave,
    nonceDato,
    datoCifrado,
    tagDato,
  };
}

/** Cifra datos con AES-GCM y nonce aleatorio nuevo para cada operación. */
function cifrarGcm(
  datos: Uint8Array,
  clave: Uint8Array,
  aad: Uint8Array,
  tamanoNonce: number,
): ResultadoCifradoGcm {
  const nonce = randomBytes(tamanoNonce);
  const cifrador = createCipheriv('aes-256-gcm', clave, nonce, {
    authTagLength: TAMANO_ETIQUETA,
  });
  cifrador.setAAD(aad);
  const ciphertext = Buffer.concat([cifrador.update(datos), cifrador.final()]);
  return { nonce, ciphertext, tag: cifrador.getAuthTag() };
}

/** Recupera la DEK validando el tag GCM de la llave envuelta y su AAD. */
function desenvolverClaveDatos(
  sobre: CamposSobreAnalizados,
  claveMaestra: VersionClaveMaestra,
  contexto: ContextoSobreSecreto,
): Buffer {
  let aad: Buffer | null = null;
  let fragmento: Buffer | null = null;
  let final: Buffer | null = null;
  try {
    const descifrador = createDecipheriv('aes-256-gcm', claveMaestra.material, sobre.nonceClave, {
      authTagLength: TAMANO_ETIQUETA,
    });
    aad = crearContextoClave(contexto, sobre.idClave);
    descifrador.setAAD(aad);
    descifrador.setAuthTag(sobre.tagClave);
    fragmento = descifrador.update(sobre.claveDatosEnvuelta);
    final = descifrador.final();
    const claveDatos = Buffer.concat([fragmento, final]);
    fragmento.fill(0);
    final.fill(0);
    if (claveDatos.byteLength !== TAMANO_CLAVE) {
      claveDatos.fill(0);
      throw new ErrorCustodiaSecretos('ENVELOPE_DECRYPTION_FAILED');
    }

    return claveDatos;
  } catch (error) {
    fragmento?.fill(0);
    final?.fill(0);
    if (error instanceof ErrorCustodiaSecretos) {
      throw error;
    }
    throw new ErrorCustodiaSecretos('ENVELOPE_DECRYPTION_FAILED');
  } finally {
    aad?.fill(0);
  }
}

/** Descifra el paquete validando su tag GCM y el AAD de cliente/perfil/propósito. */
function descifrarPaquete(
  sobre: CamposSobreAnalizados,
  claveDatos: Uint8Array,
  aad: Uint8Array,
): Buffer {
  let fragmento: Buffer | null = null;
  try {
    const descifrador = createDecipheriv('aes-256-gcm', claveDatos, sobre.nonceDato, {
      authTagLength: TAMANO_ETIQUETA,
    });
    descifrador.setAAD(aad);
    descifrador.setAuthTag(sobre.tagDato);
    fragmento = descifrador.update(sobre.datoCifrado);
    const final = descifrador.final();
    const secreto = Buffer.concat([fragmento, final]);
    fragmento.fill(0);
    final.fill(0);
    return secreto;
  } catch {
    fragmento?.fill(0);
    throw new ErrorCustodiaSecretos('ENVELOPE_DECRYPTION_FAILED');
  }
}

/** Decodifica base64 canónico para rechazar representaciones ambiguas o truncadas. */
function decodificarBase64Canonical(valor: string): Buffer {
  if (typeof valor !== 'string' || valor.length > 90_000) {
    throw new ErrorCustodiaSecretos('INVALID_SECRET_ENVELOPE');
  }
  const bytes = Buffer.from(valor, 'base64');
  if (bytes.toString('base64') !== valor) {
    throw new ErrorCustodiaSecretos('INVALID_SECRET_ENVELOPE');
  }

  return bytes;
}

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ID_CLAVE_VALIDO = /^[A-Za-z0-9_-]{1,64}$/u;
const TAMANO_MAXIMO_PAQUETE = 65_536;
const TAMANO_CLAVE = 32;
const TAMANO_NONCE = 12;
const TAMANO_ETIQUETA = 16;
const CAMPOS_ENVELOPE = [
  'version',
  'algoritmo',
  'idClave',
  'nonceClave',
  'claveDatosEnvuelta',
  'tagClave',
  'nonceDato',
  'datoCifrado',
  'tagDato',
] as const;
