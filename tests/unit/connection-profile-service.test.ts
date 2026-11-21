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
  SesionLecturaRf1,
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
      async abrirLecturaRf1(): Promise<never> {
        throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
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
        async abrirLecturaRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
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
        async abrirLecturaRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
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

  it('abre lectura RF-1 solo tras perfil activo y borra el buffer descifrado', async () => {
    const cifrador = crearCifrador();
    const material = Buffer.from(
      '{"mysqlUsername":"usuario-sintetico","mysqlPassword":"secreto-sintetico"}',
    );
    const sobre = await cifrador.cifrar(material, contexto);
    material.fill(0);
    const perfil: PerfilConexionPersistido = { ...crearPerfil(), sobre };
    const repositorio = crearRepositorio(perfil);
    const sesion: SesionLecturaRf1 = {
      async buscarSociedadesPorRfc() {
        return [];
      },
      async buscarProveedoresPorContexto() {
        return [];
      },
      async existeUuid() {
        return false;
      },
      async cerrar() {},
    };
    let secretosRecibidos: Uint8Array | undefined;
    const abrirLecturaRf1 = vi.fn(async (_perfil: PerfilConexionPrueba, secretos: Uint8Array) => {
      secretosRecibidos = secretos;
      return sesion;
    });
    const servicio = new ServicioPerfilesConexion(
      repositorio,
      cifrador,
      {
        async probar() {
          return { code: 'CONNECTED', completedAt: now };
        },
        abrirLecturaRf1,
      },
      new PoliticaDestinosConexion([destino], []),
      { ahora: () => now },
    );

    await expect(
      servicio.abrirLecturaRf1(clientId, profileId, new AbortController().signal),
    ).resolves.toBe(sesion);

    expect(abrirLecturaRf1).toHaveBeenCalledWith(
      expect.objectContaining({ id: profileId, clientId, baseDatos: 'portal_test_fixture' }),
      expect.any(Uint8Array),
      expect.any(AbortSignal),
    );
    expect(Buffer.from(secretosRecibidos ?? []).every((byte) => byte === 0)).toBe(true);
  });

  it('redacta fallos del broker RF-1 antes de exponerlos a la API', async () => {
    const cifrador = crearCifrador();
    const material = Buffer.from(
      '{"mysqlUsername":"usuario-sintetico","mysqlPassword":"secreto-sintetico"}',
    );
    const sobre = await cifrador.cifrar(material, contexto);
    material.fill(0);
    const perfil: PerfilConexionPersistido = { ...crearPerfil(), sobre };
    const servicio = new ServicioPerfilesConexion(
      crearRepositorio(perfil),
      cifrador,
      {
        async probar() {
          return { code: 'CONNECTED', completedAt: now };
        },
        async abrirLecturaRf1() {
          throw new Error('password=secreto-sintetico; driver detail');
        },
      },
      new PoliticaDestinosConexion([destino], []),
      { ahora: () => now },
    );

    await expect(
      servicio.abrirLecturaRf1(clientId, profileId, new AbortController().signal),
    ).rejects.toMatchObject<Partial<ErrorPerfilesConexion>>({
      code: 'CONNECTION_FAILED',
      statusCode: 502,
      message: 'CONNECTION_FAILED',
    });
  });
});
