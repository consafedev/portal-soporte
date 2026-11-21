import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ServicioCifradoSecretos } from '../../packages/connectors/src/secret-envelope.js';
import type {
  ContextoSobreSecreto,
  ProveedorClavesMaestras,
  VersionClaveMaestra,
} from '../../packages/core/src/clients/secret-custody-ports.js';

const contexto = {
  clientId: '00000000-0000-4000-8000-000000000001',
  profileId: '00000000-0000-4000-8000-000000000002',
  purpose: 'MYSQL_CREDENTIALS' as const,
};

/** Proveedor en memoria con llaves efímeras para pruebas criptográficas aisladas. */
class ProveedorClavesSintetico implements ProveedorClavesMaestras {
  private activaId = 'version-1';
  private readonly claves = new Map<string, Buffer>([['version-1', randomBytes(32)]]);

  /** Devuelve una copia de la versión activa para que el servicio la borre al terminar. */
  public async obtenerActiva(): Promise<VersionClaveMaestra> {
    return this.obtener(this.activaId);
  }

  /** Busca una versión sin compartir el búfer interno con el consumidor. */
  public async obtener(id: string): Promise<VersionClaveMaestra> {
    const clave = this.claves.get(id);
    if (clave === undefined) {
      throw new Error('KEY_VERSION_UNAVAILABLE');
    }

    return { id, material: Buffer.from(clave) };
  }

  /** Agrega una nueva versión activa para comprobar la rotación. */
  public agregarVersion(id: string): void {
    this.claves.set(id, randomBytes(32));
    this.activaId = id;
  }

  /** Retira una llave antigua una vez que el sobre fue reenvuelto. */
  public retirarVersion(id: string): void {
    this.claves.get(id)?.fill(0);
    this.claves.delete(id);
  }
}

describe('ServicioCifradoSecretos', () => {
  it('cifra y recupera el secreto sin incluir texto claro en el sobre', async () => {
    const proveedor = new ProveedorClavesSintetico();
    const servicio = new ServicioCifradoSecretos(proveedor);
    const secreto = Buffer.from('credencial de prueba sintética');

    const sobre = await servicio.cifrar(secreto, contexto);
    const recuperado = await servicio.descifrar(sobre, contexto);

    expect(JSON.stringify(sobre)).not.toContain(secreto.toString('utf8'));
    expect(recuperado.equals(secreto)).toBe(true);
    recuperado.fill(0);
    secreto.fill(0);
  });

  it('rechaza un sobre modificado sin exponer el texto cifrado en el error', async () => {
    const servicio = new ServicioCifradoSecretos(new ProveedorClavesSintetico());
    const sobre = await servicio.cifrar(Buffer.from('sintético'), contexto);
    const bytes = Buffer.from(sobre.datoCifrado, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 1;

    await expect(
      servicio.descifrar({ ...sobre, datoCifrado: bytes.toString('base64') }, contexto),
    ).rejects.toMatchObject({ code: 'ENVELOPE_DECRYPTION_FAILED' });
  });

  it('vincula el secreto al cliente, perfil y propósito autenticados', async () => {
    const servicio = new ServicioCifradoSecretos(new ProveedorClavesSintetico());
    const sobre = await servicio.cifrar(Buffer.from('sintético'), contexto);

    await expect(
      servicio.descifrar(sobre, { ...contexto, profileId: '00000000-0000-4000-8000-000000000003' }),
    ).rejects.toMatchObject({ code: 'ENVELOPE_DECRYPTION_FAILED' });
  });

  it('permite reenvolver la DEK y retirar la versión maestra anterior', async () => {
    const proveedor = new ProveedorClavesSintetico();
    const servicio = new ServicioCifradoSecretos(proveedor);
    const secreto = Buffer.from('credencial sintética para rotación');
    const sobreAnterior = await servicio.cifrar(secreto, contexto);
    const datoCifradoAnterior = sobreAnterior.datoCifrado;
    proveedor.agregarVersion('version-2');

    const sobreReenvuelto = await servicio.reenvolver(sobreAnterior, contexto);
    proveedor.retirarVersion('version-1');
    const recuperado = await servicio.descifrar(sobreReenvuelto, contexto);

    expect(sobreReenvuelto.idClave).toBe('version-2');
    expect(sobreReenvuelto.datoCifrado).toBe(datoCifradoAnterior);
    expect(recuperado.equals(secreto)).toBe(true);
    recuperado.fill(0);
    secreto.fill(0);
  });

  it('rechaza valores que exceden el límite del paquete antes de solicitar una llave', async () => {
    let solicitudes = 0;
    const proveedor: ProveedorClavesMaestras = {
      obtenerActiva: async () => {
        solicitudes += 1;
        return { id: 'version-1', material: randomBytes(32) };
      },
      obtener: async () => {
        solicitudes += 1;
        return { id: 'version-1', material: randomBytes(32) };
      },
    };
    const servicio = new ServicioCifradoSecretos(proveedor);

    await expect(servicio.cifrar(Buffer.alloc(65_537), contexto)).rejects.toMatchObject({
      code: 'SECRET_PACKAGE_TOO_LARGE',
    });
    expect(solicitudes).toBe(0);
  });

  it('rechaza un contexto nulo con un error estable y controlado', async () => {
    const servicio = new ServicioCifradoSecretos(new ProveedorClavesSintetico());

    await expect(
      servicio.cifrar(Buffer.from('sintético'), null as unknown as ContextoSobreSecreto),
    ).rejects.toMatchObject({ code: 'INVALID_SECRET_CONTEXT' });
  });
});
