import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type {
  ProveedorClavesMaestras,
  VersionClaveMaestra,
} from '../../core/src/clients/secret-custody-ports.js';

/** Metadata de archivo y directorio para validar el llavero sin acceder a contenido en logs. */
export interface MetadatosLlaveroSeguro {
  /** Bytes efímeros del archivo que el proveedor borra después de analizarlos. */
  readonly contenido: Buffer;
  /** Metadata POSIX del llavero leído sin seguir enlaces simbólicos. */
  readonly archivo: {
    readonly esRegular: boolean;
    readonly esEnlace: boolean;
    readonly propietarioUid: number;
    readonly grupoId: number;
    readonly modo: number;
    readonly enlacesDuros: number;
  };
  /** Metadata POSIX del directorio padre del llavero. */
  readonly directorio: {
    readonly esDirectorio: boolean;
    readonly esEnlace: boolean;
    readonly propietarioUid: number;
    readonly grupoId: number;
    readonly modo: number;
  };
}

/** Errores seguros de lectura/validación del llavero con códigos estables. */
export class ErrorProveedorLlavero extends Error {
  /** Construye un error sin ruta, material criptográfico ni causa de sistema. */
  public constructor(
    public readonly code:
      | 'KEYRING_PATH_INVALID'
      | 'KEYRING_UNAVAILABLE'
      | 'KEYRING_UNSAFE'
      | 'KEYRING_INVALID'
      | 'KEY_VERSION_UNAVAILABLE',
  ) {
    super(code);
    this.name = 'ErrorProveedorLlavero';
  }
}

/** Lee la llave maestra activa e histórica desde un archivo fuera de la base de datos. */
export class ProveedorClavesMaestrasArchivo implements ProveedorClavesMaestras {
  private readonly ruta: string;
  private readonly grupoServicio: number;
  private readonly leer: (ruta: string) => Promise<MetadatosLlaveroSeguro>;

  /** Construye el proveedor con una ruta absoluta, grupo de servicio y lector seguro inyectable. */
  public constructor(
    ruta: string,
    grupoServicio: number,
    leer: (ruta: string) => Promise<MetadatosLlaveroSeguro> = leerLlaveroPosixSeguro,
  ) {
    if (!isAbsolute(ruta) || !Number.isSafeInteger(grupoServicio) || grupoServicio < 0) {
      throw new ErrorProveedorLlavero('KEYRING_PATH_INVALID');
    }
    this.ruta = resolve(ruta);
    this.grupoServicio = grupoServicio;
    this.leer = leer;
  }

  /** Devuelve una copia de la llave activa y borra las demás llaves analizadas. */
  public async obtenerActiva(): Promise<VersionClaveMaestra> {
    const llavero = await this.cargar();
    try {
      const material = llavero.llaves.get(llavero.activaId);
      if (material === undefined) {
        throw new ErrorProveedorLlavero('KEYRING_INVALID');
      }
      return { id: llavero.activaId, material: Buffer.from(material) };
    } finally {
      borrarLlaves(llavero.llaves);
    }
  }

  /** Devuelve una copia de la llave identificada o un error de versión ausente. */
  public async obtener(id: string): Promise<VersionClaveMaestra> {
    const llavero = await this.cargar();
    try {
      const material = llavero.llaves.get(id);
      if (material === undefined) {
        throw new ErrorProveedorLlavero('KEY_VERSION_UNAVAILABLE');
      }
      return { id, material: Buffer.from(material) };
    } finally {
      borrarLlaves(llavero.llaves);
    }
  }

  /** Lee y valida permisos, estructura y versiones; siempre borra los bytes originales. */
  private async cargar(): Promise<ContenidoLlaveroAnalizado> {
    let metadatos: MetadatosLlaveroSeguro;
    try {
      metadatos = await this.leer(this.ruta);
    } catch (error) {
      if (error instanceof ErrorProveedorLlavero) {
        throw error;
      }
      throw new ErrorProveedorLlavero('KEYRING_UNAVAILABLE');
    }

    try {
      validarPermisosLlavero(metadatos, this.grupoServicio);
      return analizarLlavero(metadatos.contenido);
    } finally {
      metadatos.contenido.fill(0);
    }
  }
}

interface ContenidoLlaveroAnalizado {
  /** Identificador activo para cifrar y reenvolver paquetes. */
  readonly activaId: string;
  /** Claves mutables que el proveedor borra después de copiar el valor solicitado. */
  readonly llaves: Map<string, Buffer>;
}

/** Comprueba el formato del archivo y evita accesos con enlaces o permisos excesivos. */
function validarPermisosLlavero(metadatos: MetadatosLlaveroSeguro, grupoServicio: number): void {
  if (
    !metadatos.archivo.esRegular ||
    metadatos.archivo.esEnlace ||
    metadatos.archivo.propietarioUid !== 0 ||
    metadatos.archivo.grupoId !== grupoServicio ||
    metadatos.archivo.modo !== 0o640 ||
    metadatos.archivo.enlacesDuros !== 1 ||
    !metadatos.directorio.esDirectorio ||
    metadatos.directorio.esEnlace ||
    metadatos.directorio.propietarioUid !== 0 ||
    metadatos.directorio.grupoId !== grupoServicio ||
    metadatos.directorio.modo !== 0o750 ||
    metadatos.contenido.byteLength > TAMANO_MAXIMO_ARCHIVO
  ) {
    throw new ErrorProveedorLlavero('KEYRING_UNSAFE');
  }
}

/** Valida el documento de llavero y convierte el material base64 a buffers mutables. */
function analizarLlavero(contenido: Buffer): ContenidoLlaveroAnalizado {
  const llaves = new Map<string, Buffer>();
  try {
    const documento: unknown = JSON.parse(contenido.toString('utf8'));
    if (
      !esObjeto(documento) ||
      !tieneCamposExactos(documento, ['version', 'activeKeyId', 'keys'])
    ) {
      throw new ErrorProveedorLlavero('KEYRING_INVALID');
    }
    if (
      documento['version'] !== 1 ||
      typeof documento['activeKeyId'] !== 'string' ||
      !ID_VERSION_VALIDO.test(documento['activeKeyId']) ||
      !Array.isArray(documento['keys']) ||
      documento['keys'].length < 1 ||
      documento['keys'].length > 8
    ) {
      throw new ErrorProveedorLlavero('KEYRING_INVALID');
    }

    for (const entrada of documento['keys']) {
      if (!esObjeto(entrada) || !tieneCamposExactos(entrada, ['id', 'key'])) {
        throw new ErrorProveedorLlavero('KEYRING_INVALID');
      }
      const id = entrada['id'];
      const codificada = entrada['key'];
      if (
        typeof id !== 'string' ||
        !ID_VERSION_VALIDO.test(id) ||
        typeof codificada !== 'string' ||
        llaves.has(id)
      ) {
        throw new ErrorProveedorLlavero('KEYRING_INVALID');
      }
      const material = Buffer.from(codificada, 'base64');
      if (material.toString('base64') !== codificada || material.byteLength !== 32) {
        material.fill(0);
        throw new ErrorProveedorLlavero('KEYRING_INVALID');
      }
      llaves.set(id, material);
    }

    if (!llaves.has(documento['activeKeyId'])) {
      throw new ErrorProveedorLlavero('KEYRING_INVALID');
    }
    return { activaId: documento['activeKeyId'], llaves };
  } catch (error) {
    borrarLlaves(llaves);
    if (error instanceof ErrorProveedorLlavero) {
      throw error;
    }
    throw new ErrorProveedorLlavero('KEYRING_INVALID');
  }
}

/** Comprueba que un objeto JSON tenga exactamente las propiedades permitidas. */
function tieneCamposExactos(objeto: Record<string, unknown>, campos: readonly string[]): boolean {
  return (
    Object.keys(objeto).length === campos.length &&
    campos.every((campo) => Object.hasOwn(objeto, campo))
  );
}

/** Distingue objetos JSON de arrays, nulos y valores primitivos. */
function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Sobrescribe buffers de llaves luego de su uso o ante un error de análisis. */
function borrarLlaves(llaves: ReadonlyMap<string, Buffer>): void {
  for (const material of llaves.values()) {
    material.fill(0);
  }
}

/** Lee el archivo en Linux verificando el directorio, el archivo y permisos POSIX. */
async function leerLlaveroPosixSeguro(ruta: string): Promise<MetadatosLlaveroSeguro> {
  if (process.platform !== 'linux') {
    throw new ErrorProveedorLlavero('KEYRING_UNSAFE');
  }

  const rutaDirectorio = dirname(ruta);
  try {
    const rutaRealDirectorio = await realpath(rutaDirectorio);
    const directorio = await lstat(rutaDirectorio);
    if (rutaRealDirectorio !== rutaDirectorio || directorio.isSymbolicLink()) {
      throw new ErrorProveedorLlavero('KEYRING_UNSAFE');
    }

    const descriptorDirectorio = await lstat(rutaDirectorio);
    const descriptorArchivo = await open(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const archivo = await descriptorArchivo.stat();
      if (archivo.size > TAMANO_MAXIMO_ARCHIVO) {
        throw new ErrorProveedorLlavero('KEYRING_UNSAFE');
      }
      const contenido = await descriptorArchivo.readFile();
      return {
        contenido,
        archivo: {
          esRegular: archivo.isFile(),
          esEnlace: false,
          propietarioUid: archivo.uid,
          grupoId: archivo.gid,
          modo: archivo.mode & 0o777,
          enlacesDuros: archivo.nlink,
        },
        directorio: {
          esDirectorio: descriptorDirectorio.isDirectory(),
          esEnlace: descriptorDirectorio.isSymbolicLink(),
          propietarioUid: descriptorDirectorio.uid,
          grupoId: descriptorDirectorio.gid,
          modo: descriptorDirectorio.mode & 0o777,
        },
      };
    } finally {
      await descriptorArchivo.close();
    }
  } catch (error) {
    if (error instanceof ErrorProveedorLlavero) {
      throw error;
    }
    throw new ErrorProveedorLlavero('KEYRING_UNAVAILABLE');
  }
}

const ID_VERSION_VALIDO = /^[A-Za-z0-9_-]{1,64}$/u;
const TAMANO_MAXIMO_ARCHIVO = 16_384;
