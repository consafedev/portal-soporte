import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SolicitudCrearPerfilConexionAdmin } from '../../packages/contracts/src/clients.js';
import type {
  AltaPerfilConexionPersistido,
  PerfilConexionCliente,
  PerfilConexionPersistido,
  RepositorioPerfilesConexion,
  CambiosPerfilConexionPersistidos,
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

/** Construye un perfil persistido legacy sin endpoints ni datos reales de conexión. */
function crearPerfilPersistido(sobre: PerfilConexionPersistido['sobre']): PerfilConexionPersistido {
  return {
    ...crearPerfil(),
    sobre,
    destinoMySql: null,
    gatewaySsh: null,
  };
}

/** Construye un repositorio en memoria que registra auditoría sin persistencia externa. */
function crearRepositorio(perfil: PerfilConexionPersistido): RepositorioPerfilesConexion & {
  readonly auditorias: ResultadoPruebaConexion[];
  readonly altas: AltaPerfilConexionPersistido[];
  readonly actualizaciones: CambiosPerfilConexionPersistidos[];
  readonly registrarPrueba: ReturnType<typeof vi.fn>;
} {
  const auditorias: ResultadoPruebaConexion[] = [];
  const altas: AltaPerfilConexionPersistido[] = [];
  const actualizaciones: CambiosPerfilConexionPersistidos[] = [];
  const registrarPrueba = vi.fn(
    async (_client: string, _profile: string, resultado: ResultadoPruebaConexion) => {
      auditorias.push(resultado);
    },
  );
  return {
    auditorias,
    altas,
    actualizaciones,
    registrarPrueba,
    async listar() {
      return [perfil];
    },
    async crear(entrada) {
      altas.push(entrada);
      return { kind: 'CREATED', perfil: { ...perfil, ...entrada } };
    },
    async actualizar(_clientId, _profileId, cambios) {
      actualizaciones.push(cambios);
      return { ...perfil, ...cambios };
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
  it('persiste endpoint propio fuera de la allowlist y no expone IDs internos en el DTO', async () => {
    const repositorio = crearRepositorio({
      ...crearPerfilPersistido(await crearCifrador().cifrar(Buffer.from('fixture'), contexto)),
    });
    const servicio = new ServicioPerfilesConexion(
      repositorio,
      crearCifrador(),
      {
        async probar() {
          return { code: 'CONNECTED', completedAt: now };
        },
        async abrirLecturaRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
        async abrirInsercionRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
      },
      new PoliticaDestinosConexion([], []),
      { ahora: () => now },
      () => profileId,
    );

    const perfilCreado = await servicio.crear(
      clientId,
      {
        nombre: 'MySQL visual',
        tipo: 'MYSQL_TCP',
        entorno: 'TEST',
        destinoMySql: { hostname: 'MYSQL.AUTOSERVICIO.TEST', port: 3306 },
        baseDatos: 'portal_test_fixture',
        credenciales: { mysqlUsername: 'usuario-sintetico', mysqlPassword: 'secreto-sintetico' },
      },
      actor,
    );
    const respuesta = servicio.presentarPerfilAdmin(perfilCreado);

    expect(repositorio.altas[0]).toMatchObject({
      destinoMySqlId: `perfil-${profileId}`,
      gatewaySshId: null,
      destinoMySql: { hostname: 'mysql.autoservicio.test', port: 3306 },
      gatewaySsh: null,
    });
    expect(respuesta).toMatchObject({
      destinoMySql: { hostname: 'mysql.autoservicio.test', port: 3306 },
      gatewaySsh: null,
    });
    expect('destinoMySqlId' in respuesta).toBe(false);
    expect('gatewaySshId' in respuesta).toBe(false);
  });

  it('rechaza sintaxis de hostname inválida antes de cifrar o persistir credenciales', async () => {
    const repositorio = crearRepositorio({
      ...crearPerfilPersistido(await crearCifrador().cifrar(Buffer.from('fixture'), contexto)),
    });
    const servicio = new ServicioPerfilesConexion(
      repositorio,
      crearCifrador(),
      {
        async probar() {
          return { code: 'CONNECTED', completedAt: now };
        },
        async abrirLecturaRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
        async abrirInsercionRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
      },
      new PoliticaDestinosConexion([destino], []),
      { ahora: () => now },
      () => profileId,
    );

    await expect(
      servicio.crear(
        clientId,
        {
          nombre: 'Destino inválido',
          tipo: 'MYSQL_TCP',
          entorno: 'TEST',
          destinoMySql: { hostname: 'db..invalid', port: 3306 },
          baseDatos: 'portal_test_fixture',
          credenciales: {
            mysqlUsername: 'usuario-sintetico',
            mysqlPassword: 'secreto-sintetico',
          },
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'DESTINATION_INVALID', statusCode: 422 });
    expect(repositorio.altas).toEqual([]);
  });

  it('actualiza endpoints sin allowlist y no promueve perfiles legacy al editar solo metadatos', async () => {
    const repositorio = crearRepositorio({
      ...crearPerfilPersistido(await crearCifrador().cifrar(Buffer.from('fixture'), contexto)),
    });
    const servicio = new ServicioPerfilesConexion(
      repositorio,
      crearCifrador(),
      {
        async probar() {
          return { code: 'CONNECTED', completedAt: now };
        },
        async abrirLecturaRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
        async abrirInsercionRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
      },
      new PoliticaDestinosConexion([], []),
      { ahora: () => now },
    );

    await servicio.actualizar(clientId, profileId, { nombre: 'Alias legacy conservado' }, actor);
    expect(repositorio.actualizaciones[0]).not.toHaveProperty('destinoMySql');
    expect(repositorio.actualizaciones[0]).not.toHaveProperty('destinoMySqlId');

    await servicio.actualizar(
      clientId,
      profileId,
      { destinoMySql: { hostname: 'mysql.nuevo-destino.test', port: 3307 } },
      actor,
    );
    expect(repositorio.actualizaciones[1]).toMatchObject({
      destinoMySqlId: `perfil-${profileId}`,
      destinoMySql: { hostname: 'mysql.nuevo-destino.test', port: 3307 },
      gatewaySshId: null,
      gatewaySsh: null,
    });
  });

  it('exige una fingerprint SHA-256 válida antes de cifrar credenciales SSH', async () => {
    const cifrador = crearCifrador();
    const cifrar = vi.spyOn(cifrador, 'cifrar');
    const repositorio = crearRepositorio({
      ...crearPerfilPersistido(await crearCifrador().cifrar(Buffer.from('fixture'), contexto)),
    });
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
        async abrirInsercionRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
      },
      new PoliticaDestinosConexion([], []),
      { ahora: () => now },
      () => profileId,
    );

    const entradas = [
      { hostname: 'ssh.autoservicio.test', port: 22 },
      { hostname: 'ssh.autoservicio.test', port: 22, fingerprint: 'SHA256:invalida' },
    ];
    for (const gatewaySsh of entradas) {
      const entrada = {
        nombre: 'Túnel SSH sintético',
        tipo: 'MYSQL_SSH',
        entorno: 'TEST',
        destinoMySql: { hostname: 'mysql.autoservicio.test', port: 3306 },
        gatewaySsh,
        baseDatos: 'portal_test_fixture',
        credenciales: {
          mysqlUsername: 'usuario-sintetico',
          mysqlPassword: 'secreto-sintetico',
          ssh: {
            username: 'ssh-sintetico',
            authentication: 'PASSWORD',
            password: 'secreto-ssh-sintetico',
          },
        },
      } as unknown as SolicitudCrearPerfilConexionAdmin;

      await expect(servicio.crear(clientId, entrada, actor)).rejects.toMatchObject({
        code: 'DESTINATION_INVALID',
        statusCode: 422,
      });
    }
    expect(cifrar).not.toHaveBeenCalled();
    expect(repositorio.altas).toEqual([]);
  });

  it('persiste y devuelve a ADMIN el endpoint SSH y su fingerprint sin secretos', async () => {
    const repositorio = crearRepositorio({
      ...crearPerfilPersistido(await crearCifrador().cifrar(Buffer.from('fixture'), contexto)),
    });
    const servicio = new ServicioPerfilesConexion(
      repositorio,
      crearCifrador(),
      {
        async probar() {
          return { code: 'CONNECTED', completedAt: now };
        },
        async abrirLecturaRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
        async abrirInsercionRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
      },
      new PoliticaDestinosConexion([], []),
      { ahora: () => now },
      () => profileId,
    );
    const fingerprint = `SHA256:${'A'.repeat(43)}`;

    const creado = await servicio.crear(
      clientId,
      {
        nombre: 'MySQL por SSH sintético',
        tipo: 'MYSQL_SSH',
        entorno: 'TEST',
        destinoMySql: { hostname: 'MYSQL.AUTOSERVICIO.TEST', port: 3306 },
        gatewaySsh: {
          hostname: 'SSH.AUTOSERVICIO.TEST',
          port: 22,
          fingerprint,
        },
        baseDatos: 'portal_test_fixture',
        credenciales: {
          mysqlUsername: 'usuario-sintetico',
          mysqlPassword: 'secreto-sintetico',
          ssh: {
            username: 'ssh-sintetico',
            authentication: 'PASSWORD',
            password: 'secreto-ssh-sintetico',
          },
        },
      },
      actor,
    );

    expect(repositorio.altas[0]).toMatchObject({
      destinoMySql: { hostname: 'mysql.autoservicio.test', port: 3306 },
      gatewaySsh: { hostname: 'ssh.autoservicio.test', port: 22, fingerprint },
    });
    expect(servicio.presentarPerfilAdmin(creado).gatewaySsh).toEqual({
      hostname: 'ssh.autoservicio.test',
      port: 22,
      fingerprint,
    });
    expect(JSON.stringify(servicio.presentarPerfilAdmin(creado))).not.toContain('secreto');
  });

  it('rechaza credenciales SSH en perfiles MYSQL_TCP con error 422', async () => {
    const repositorio = crearRepositorio({
      ...crearPerfilPersistido(await crearCifrador().cifrar(Buffer.from('fixture'), contexto)),
    });
    const servicio = new ServicioPerfilesConexion(
      repositorio,
      crearCifrador(),
      {
        async probar() {
          return { code: 'CONNECTED', completedAt: now };
        },
        async abrirLecturaRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
        async abrirInsercionRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
      },
      new PoliticaDestinosConexion([], []),
      { ahora: () => now },
      () => profileId,
    );

    await expect(
      servicio.crear(
        clientId,
        {
          nombre: 'TCP con SSH inválido',
          tipo: 'MYSQL_TCP',
          entorno: 'TEST',
          destinoMySql: { hostname: 'mysql.autoservicio.test', port: 3306 },
          baseDatos: 'portal_test_fixture',
          credenciales: {
            mysqlUsername: 'usuario-sintetico',
            mysqlPassword: 'secreto-sintetico',
            ssh: {
              username: 'ssh-sintetico',
              authentication: 'PASSWORD',
              password: 'secreto-ssh-sintetico',
            },
          },
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'PROFILE_CONFIGURATION_INVALID', statusCode: 422 });
    expect(repositorio.altas).toEqual([]);
  });

  it('redacta fallos externos, borra el buffer descifrado y audita una sola vez', async () => {
    const cifrador = crearCifrador();
    const material = Buffer.from(
      '{"mysqlUsername":"usuario-sintetico","mysqlPassword":"secreto-sintetico"}',
    );
    const sobre = await cifrador.cifrar(material, contexto);
    material.fill(0);
    const perfil = crearPerfilPersistido(sobre);
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
      async abrirInsercionRf1(): Promise<never> {
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

  it('envía al broker el destino guardado por perfil sin consultar la allowlist', async () => {
    const cifrador = crearCifrador();
    const contenido = Buffer.from(
      '{"mysqlUsername":"usuario-sintetico","mysqlPassword":"secreto-sintetico"}',
    );
    const sobre = await cifrador.cifrar(contenido, contexto);
    contenido.fill(0);
    const perfil = {
      ...crearPerfilPersistido(sobre),
      destinoMySql: { hostname: 'mysql.autoservicio.test', port: 3306 },
    };
    const repositorio = crearRepositorio(perfil);
    const probar = vi.fn(async (_solicitud: PerfilConexionPrueba, secretos: Uint8Array) => {
      secretos.fill(0);
      return { code: 'CONNECTED' as const, completedAt: now };
    });
    const servicio = new ServicioPerfilesConexion(
      repositorio,
      cifrador,
      {
        probar,
        async abrirLecturaRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
        async abrirInsercionRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
      },
      new PoliticaDestinosConexion([], []),
      { ahora: () => now },
    );

    await expect(servicio.probar(clientId, profileId, actor)).resolves.toMatchObject({
      code: 'CONNECTED',
    });

    expect(probar).toHaveBeenCalledWith(
      expect.objectContaining({
        id: profileId,
        clientId,
        destinoMySql: { hostname: 'mysql.autoservicio.test', port: 3306 },
      }),
      expect.any(Uint8Array),
    );
    expect(repositorio.registrarPrueba).toHaveBeenCalledTimes(1);
  });

  it('propaga fallos de auditoría sin volver a etiquetarlos como fallos MySQL', async () => {
    const cifrador = crearCifrador();
    const material = Buffer.from(
      '{"mysqlUsername":"usuario-sintetico","mysqlPassword":"secreto-sintetico"}',
    );
    const sobre = await cifrador.cifrar(material, contexto);
    material.fill(0);
    const perfil = crearPerfilPersistido(sobre);
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
        async abrirInsercionRf1(): Promise<never> {
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
    const repositorio = crearRepositorio({
      ...crearPerfilPersistido(await crearCifrador().cifrar(Buffer.from('x'), contexto)),
    });
    const credenciales: SolicitudCrearPerfilConexionAdmin = {
      nombre: 'Nuevo',
      tipo: 'MYSQL_TCP',
      entorno: 'TEST',
      destinoMySql: { hostname: destino.hostname, port: destino.port },
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
        async abrirInsercionRf1(): Promise<never> {
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
    const perfil = crearPerfilPersistido(sobre);
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
        async abrirInsercionRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
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

  it('rechaza un perfil cambiado antes de descifrar credenciales para inserción', async () => {
    const cifrador = crearCifrador();
    const material = Buffer.from('{"mysqlUsername":"sintetico","mysqlPassword":"sintetico"}');
    const sobre = await cifrador.cifrar(material, contexto);
    material.fill(0);
    const perfil = crearPerfilPersistido(sobre);
    const abrirInsercionRf1 = vi.fn(async () => {
      throw new Error('no debe abrirse el broker');
    });
    const servicio = new ServicioPerfilesConexion(
      crearRepositorio(perfil),
      cifrador,
      {
        async probar() {
          return { code: 'CONNECTED', completedAt: now };
        },
        async abrirLecturaRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
        },
        abrirInsercionRf1,
      },
      new PoliticaDestinosConexion([destino], []),
      { ahora: () => now },
    );

    await expect(
      servicio.abrirInsercionRf1(
        clientId,
        profileId,
        new AbortController().signal,
        'sha256:huella-vieja',
      ),
    ).rejects.toMatchObject({ code: 'PROFILE_CHANGED', statusCode: 409 });
    expect(abrirInsercionRf1).not.toHaveBeenCalled();
  });

  it('redacta fallos del broker RF-1 antes de exponerlos a la API', async () => {
    const cifrador = crearCifrador();
    const material = Buffer.from(
      '{"mysqlUsername":"usuario-sintetico","mysqlPassword":"secreto-sintetico"}',
    );
    const sobre = await cifrador.cifrar(material, contexto);
    material.fill(0);
    const perfil = crearPerfilPersistido(sobre);
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
        async abrirInsercionRf1(): Promise<never> {
          throw new Error('RF1_CONNECTOR_NOT_CONFIGURED');
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
