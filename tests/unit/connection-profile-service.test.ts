import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SolicitudCrearPerfilConexionAdmin } from '../../packages/contracts/src/clients.js';
import type {
  PerfilConexionCliente,
  PerfilConexionPersistido,
  RepositorioPerfilesConexion,
} from '../../packages/core/src/clients/connection-profile-ports.js';
import type {
  ContextoSobreSecreto,
  PerfilConexionPrueba,
  ResultadoPruebaConexion,
} from '../../packages/core/src/clients/secret-custody-ports.js';
import { PoliticaDestinosConexion } from '../../packages/connectors/src/mysql-connection-broker.js';
import { ServicioCifradoSecretos } from '../../packages/connectors/src/secret-envelope.js';
import {
  ErrorPerfilesConexion,
  ServicioPerfilesConexion,
} from '../../apps/api/src/clients/connection-profile-service.js';

const clientId = '00000000-0000-4000-8000-000000000001';
const profileId = '00000000-0000-4000-8000-000000000002';
const actor = { actorUserId: '00000000-0000-4000-8000-000000000003', requestId: 'req-sintetico' };
const now = new Date('2026-11-20T12:00:00.000Z');
const contexto: ContextoSobreSecreto = { clientId, profileId, purpose: 'MYSQL_CREDENTIALS' };
const destino = {
  id: 'mysql-sintetico',
  hostname: 'mysql.test.invalid',
  address: '192.0.2.10',
  port: 3306,
};

/** Provee claves aleatorias solo para las pruebas unitarias de custodia. */
function crearCifrador(): ServicioCifradoSecretos {
  const material = randomBytes(32);
  return new ServicioCifradoSecretos({
    async obtenerActiva() {
      return { id: 'llave-prueba-v1', material: Buffer.from(material) };
    },
    async obtener() {
      return { id: 'llave-prueba-v1', material: Buffer.from(material) };
    },
  });
}

/** Crea el DTO de perfil sin incluir datos de acceso. */
function crearPerfil(): PerfilConexionCliente {
  return {
    id: profileId,
    clientId,
    nombre: 'Base sintética',
    tipo: 'MYSQL_TCP',
    entorno: 'TEST',
    destinoMySqlId: destino.id,
    gatewaySshId: null,
    baseDatos: 'portal_test_fixture',
    estado: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
}

/** Construye un repositorio en memoria que registra auditoría sin persistencia externa. */
function crearRepositorio(perfil: PerfilConexionPersistido): RepositorioPerfilesConexion & {
  readonly auditorias: ResultadoPruebaConexion[];
  readonly registrarPrueba: ReturnType<typeof vi.fn>;
} {
  const auditorias: ResultadoPruebaConexion[] = [];
  const registrarPrueba = vi.fn(
    async (_client: string, _profile: string, resultado: ResultadoPruebaConexion) => {
      auditorias.push(resultado);
    },
  );
  return {
    auditorias,
    registrarPrueba,
    async listar() {
      return [perfil];
    },
    async crear() {
      return { kind: 'CREATED', perfil };
    },
    async actualizar() {
      return perfil;
    },
    async reemplazarSobre() {
      return perfil;
    },
    async obtenerParaPrueba() {
      return perfil;
    },
  };
}

describe('ServicioPerfilesConexion', () => {
  it('redacta fallos externos, borra el buffer descifrado y audita una sola vez', async () => {
    const cifrador = crearCifrador();
    const material = Buffer.from(
      '{"mysqlUsername":"usuario-sintetico","mysqlPassword":"secreto-sintetico"}',
    );
    const sobre = await cifrador.cifrar(material, contexto);
    material.fill(0);
    const perfil: PerfilConexionPersistido = { ...crearPerfil(), sobre };
    const repositorio = crearRepositorio(perfil);
    let bufferRecibido: Uint8Array | undefined;
    const broker = {
      async probar(_perfil: PerfilConexionPrueba, secretos: Uint8Array) {
        bufferRecibido = secretos;
        throw new Error('mysqlPassword=secreto-sintetico; driver detail');
      },
    };
    const servicio = new ServicioPerfilesConexion(
      repositorio,
      cifrador,
      broker,
      new PoliticaDestinosConexion([destino], []),
      { ahora: () => now },
    );

    const resultado = await servicio.probar(clientId, profileId, actor);

    expect(resultado).toEqual({ code: 'MYSQL_CONNECTION_FAILED', completedAt: now });
    expect(JSON.stringify(resultado)).not.toContain('secreto-sintetico');
    expect(repositorio.registrarPrueba).toHaveBeenCalledTimes(1);
    expect(repositorio.auditorias).toEqual([resultado]);
    expect(bufferRecibido).toBeDefined();
    expect(Buffer.from(bufferRecibido ?? []).every((byte) => byte === 0)).toBe(true);
  });

  it('propaga fallos de auditoría sin volver a etiquetarlos como fallos MySQL', async () => {
    const cifrador = crearCifrador();
    const material = Buffer.from(
      '{"mysqlUsername":"usuario-sintetico","mysqlPassword":"secreto-sintetico"}',
    );
    const sobre = await cifrador.cifrar(material, contexto);
    material.fill(0);
    const perfil: PerfilConexionPersistido = { ...crearPerfil(), sobre };
    const repositorio = crearRepositorio(perfil);
    repositorio.registrarPrueba.mockRejectedValueOnce(new Error('audit storage unavailable'));
    const servicio = new ServicioPerfilesConexion(
      repositorio,
      cifrador,
      {
        async probar() {
          return { code: 'CONNECTED', completedAt: now };
        },
      },
      new PoliticaDestinosConexion([destino], []),
      { ahora: () => now },
    );

    await expect(servicio.probar(clientId, profileId, actor)).rejects.toThrow(
      'audit storage unavailable',
    );
    expect(repositorio.registrarPrueba).toHaveBeenCalledTimes(1);
  });

  it('rechaza crear un perfil cuando la custodia no está disponible', async () => {
    const perfil = crearPerfil();
    const repositorio = crearRepositorio({
      ...perfil,
      sobre: await crearCifrador().cifrar(Buffer.from('x'), contexto),
    });
    const credenciales: SolicitudCrearPerfilConexionAdmin = {
      nombre: 'Nuevo',
      tipo: 'MYSQL_TCP',
      entorno: 'TEST',
      destinoMySqlId: destino.id,
      baseDatos: 'portal_test_fixture',
      credenciales: { mysqlUsername: 'usuario-sintetico', mysqlPassword: 'secreto-sintetico' },
    };
    const servicio = new ServicioPerfilesConexion(
      repositorio,
      null,
      {
        async probar() {
          return { code: 'CONNECTED', completedAt: now };
        },
      },
      new PoliticaDestinosConexion([destino], []),
      { ahora: () => now },
      () => profileId,
    );

    await expect(servicio.crear(clientId, credenciales, actor)).rejects.toMatchObject<
      Partial<ErrorPerfilesConexion>
    >({
      code: 'SECRET_CUSTODY_DISABLED',
      statusCode: 503,
    });
  });
});
