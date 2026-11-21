import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ErrorProveedorLlavero,
  ProveedorClavesMaestrasArchivo,
  type MetadatosLlaveroSeguro,
} from '../../packages/connectors/src/master-keyring-provider.js';

const grupoServicio = 2000;

/** Crea metadatos POSIX sintéticos compatibles con el contrato de Debian. */
function metadatosLlavero(contenido: Buffer): MetadatosLlaveroSeguro {
  return {
    contenido,
    archivo: {
      esRegular: true,
      esEnlace: false,
      propietarioUid: 0,
      grupoId: grupoServicio,
      modo: 0o640,
      enlacesDuros: 1,
    },
    directorio: {
      esDirectorio: true,
      esEnlace: false,
      propietarioUid: 0,
      grupoId: grupoServicio,
      modo: 0o750,
    },
  };
}

/** Serializa un llavero efímero sin imprimir sus llaves sintéticas. */
function documentoLlavero(
  activo: string,
  llaves: readonly { readonly id: string; readonly material: Buffer }[],
): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      activeKeyId: activo,
      keys: llaves.map(({ id, material }) => ({ id, key: material.toString('base64') })),
    }),
    'utf8',
  );
}

describe('ProveedorClavesMaestrasArchivo', () => {
  it('devuelve copias independientes de las versiones activa e histórica', async () => {
    const claveAnterior = randomBytes(32);
    const claveActiva = randomBytes(32);
    const contenido = documentoLlavero('v2', [
      { id: 'v1', material: claveAnterior },
      { id: 'v2', material: claveActiva },
    ]);
    const proveedor = new ProveedorClavesMaestrasArchivo(
      '/etc/portal-soporte/client-keyring.json',
      grupoServicio,
      async () => metadatosLlavero(Buffer.from(contenido)),
    );

    const activa = await proveedor.obtenerActiva();
    const anterior = await proveedor.obtener('v1');
    activa.material.fill(0);
    const activaNueva = await proveedor.obtenerActiva();

    expect(activa.id).toBe('v2');
    expect(Buffer.from(anterior.material).equals(claveAnterior)).toBe(true);
    expect(Buffer.from(activaNueva.material).equals(claveActiva)).toBe(true);
    claveAnterior.fill(0);
    claveActiva.fill(0);
    anterior.material.fill(0);
    activaNueva.material.fill(0);
    contenido.fill(0);
  });

  it('rechaza archivos con permisos más amplios que 0640', async () => {
    const contenido = documentoLlavero('v1', [{ id: 'v1', material: randomBytes(32) }]);
    const proveedor = new ProveedorClavesMaestrasArchivo(
      '/etc/portal-soporte/client-keyring.json',
      grupoServicio,
      async () => ({
        ...metadatosLlavero(Buffer.from(contenido)),
        archivo: { ...metadatosLlavero(Buffer.alloc(0)).archivo, modo: 0o644 },
      }),
    );

    await expect(proveedor.obtenerActiva()).rejects.toMatchObject({ code: 'KEYRING_UNSAFE' });
    contenido.fill(0);
  });

  it('rechaza archivos simbólicos aunque la metadata aparente ser restrictiva', async () => {
    const contenido = documentoLlavero('v1', [{ id: 'v1', material: randomBytes(32) }]);
    const proveedor = new ProveedorClavesMaestrasArchivo(
      '/etc/portal-soporte/client-keyring.json',
      grupoServicio,
      async () => ({
        ...metadatosLlavero(Buffer.from(contenido)),
        archivo: { ...metadatosLlavero(Buffer.alloc(0)).archivo, esEnlace: true },
      }),
    );

    await expect(proveedor.obtenerActiva()).rejects.toMatchObject({ code: 'KEYRING_UNSAFE' });
    contenido.fill(0);
  });

  it('rechaza un llavero cuyo identificador activo no tiene llave correspondiente', async () => {
    const contenido = documentoLlavero('missing', [{ id: 'v1', material: randomBytes(32) }]);
    const proveedor = new ProveedorClavesMaestrasArchivo(
      '/etc/portal-soporte/client-keyring.json',
      grupoServicio,
      async () => metadatosLlavero(Buffer.from(contenido)),
    );

    await expect(proveedor.obtenerActiva()).rejects.toMatchObject({ code: 'KEYRING_INVALID' });
    contenido.fill(0);
  });

  it('usa un error estable que no incluye material del llavero al buscar una versión ausente', async () => {
    const contenido = documentoLlavero('v1', [{ id: 'v1', material: randomBytes(32) }]);
    const proveedor = new ProveedorClavesMaestrasArchivo(
      '/etc/portal-soporte/client-keyring.json',
      grupoServicio,
      async () => metadatosLlavero(Buffer.from(contenido)),
    );

    let fallo: unknown;
    try {
      await proveedor.obtener('v0');
    } catch (error) {
      fallo = error;
    }

    expect(fallo).toBeInstanceOf(ErrorProveedorLlavero);
    expect(fallo).toMatchObject({ code: 'KEY_VERSION_UNAVAILABLE' });
    contenido.fill(0);
  });
});
