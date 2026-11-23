import { randomUUID } from 'node:crypto';
import type {
  EndpointConexionAdmin,
  PerfilConexionAdminContrato,
  SolicitudActualizarPerfilConexionAdmin,
  SolicitudCrearPerfilConexionAdmin,
  SolicitudReemplazarCredencialesPerfilAdmin,
} from '../../../../packages/contracts/src/clients.js';
import type { ActorAdministracionClientes } from '../../../../packages/core/src/clients/ports.js';
import type {
  CambiosPerfilConexionPersistidos,
  PerfilConexionCliente,
  RepositorioPerfilesConexion,
} from '../../../../packages/core/src/clients/connection-profile-ports.js';
import type {
  CodigoResultadoPruebaConexion,
  ClientConnectionBroker,
  ContextoSobreSecreto,
  PerfilConexionPrueba,
  ResultadoPruebaConexion,
  SesionInsercionRf1,
  SesionLecturaRf1,
} from '../../../../packages/core/src/clients/secret-custody-ports.js';
import type { RelojAuth } from '../../../../packages/core/src/auth/ports.js';
import type { PoliticaDestinosConexion, ServicioCifradoSecretos } from '@portal-soporte/connectors';
import { calcularHuellaPerfilConexion } from './connection-profile-fingerprint.js';

/** Error de dominio con código y estado HTTP controlados, sin valores de conexión. */
export class ErrorPerfilesConexion extends Error {
  /** Construye un error público que no conserva entrada, stack de driver ni secretos. */
  public constructor(
    public readonly code:
      | 'PROFILE_NAME_INVALID'
      | 'PROFILE_CONFIGURATION_INVALID'
      | 'DESTINATION_NOT_ALLOWED'
      | 'PROFILE_NOT_FOUND'
      | 'PROFILE_DUPLICATE'
      | 'CLIENT_NOT_FOUND'
      | 'SECRET_CUSTODY_DISABLED'
      | 'SECRET_CUSTODY_UNAVAILABLE'
      | 'SECRET_PACKAGE_TOO_LARGE'
      | 'SECRET_PACKAGE_INVALID'
      | 'CONNECTOR_BUSY'
      | 'CONNECTION_FAILED'
      | 'CONNECTION_TIMEOUT'
      | 'REQUEST_ABORTED'
      | 'PROFILE_CHANGED',
    public readonly statusCode: 400 | 404 | 409 | 413 | 422 | 502 | 503 | 504,
  ) {
    super(code);
    this.name = 'ErrorPerfilesConexion';
  }
}

/** Administra perfiles y custodia credenciales únicamente en servicios server-side. */
export class ServicioPerfilesConexion {
  /** Crea el servicio con puertos aislados y configuración operacional allowlisted. */
  public constructor(
    private readonly repositorio: RepositorioPerfilesConexion,
    private readonly custodia: ServicioCifradoSecretos | null,
    private readonly broker: ClientConnectionBroker,
    private readonly politica: PoliticaDestinosConexion,
    private readonly reloj: RelojAuth,
    private readonly generarId: () => string = randomUUID,
  ) {}

  /** Lista perfiles administrativos redactados, sin seleccionar material cifrado. */
  public listar(clientId: string): Promise<readonly PerfilConexionCliente[]> {
    return this.repositorio.listar(clientId);
  }

  /** Cifra la solicitud antes de persistirla y audita alta/conflicto de forma segura. */
  public async crear(
    clientId: string,
    entrada: SolicitudCrearPerfilConexionAdmin,
    actor: ActorAdministracionClientes,
  ): Promise<PerfilConexionCliente> {
    const nombre = normalizarNombrePerfil(entrada.nombre);
    const destino = this.politica.buscarMySql(
      entrada.destinoMySql.hostname,
      entrada.destinoMySql.port,
    );
    const gateway =
      entrada.gatewaySsh === undefined
        ? undefined
        : this.politica.buscarGatewaySsh(entrada.gatewaySsh.hostname, entrada.gatewaySsh.port);
    if (
      destino === undefined ||
      (entrada.tipo === 'MYSQL_SSH' && gateway === undefined) ||
      (entrada.tipo === 'MYSQL_TCP' && entrada.gatewaySsh !== undefined)
    ) {
      throw new ErrorPerfilesConexion('DESTINATION_NOT_ALLOWED', 422);
    }
    validarConfiguracionPerfil(entrada.tipo, gateway?.id, entrada.credenciales);
    const custodia = this.exigirCustodia();
    const id = this.generarId();
    const contexto = crearContextoSobre(clientId, id);
    const sobre = await this.cifrarCredenciales(custodia, entrada.credenciales, contexto);

    const resultado = await this.repositorio.crear(
      {
        id,
        clientId,
        nombre,
        tipo: entrada.tipo,
        entorno: entrada.entorno,
        destinoMySqlId: destino.id,
        gatewaySshId: gateway?.id ?? null,
        baseDatos: entrada.baseDatos,
        sobre,
        createdAt: this.reloj.ahora(),
      },
      actor,
    );
    if (resultado.kind === 'CLIENT_NOT_FOUND') {
      throw new ErrorPerfilesConexion('CLIENT_NOT_FOUND', 404);
    }
    if (resultado.kind === 'PROFILE_DUPLICATE') {
      throw new ErrorPerfilesConexion('PROFILE_DUPLICATE', 409);
    }
    return resultado.perfil;
  }

  /** Cambia metadatos y estado sin aceptar ni seleccionar credenciales. */
  public async actualizar(
    clientId: string,
    profileId: string,
    entrada: SolicitudActualizarPerfilConexionAdmin,
    actor: ActorAdministracionClientes,
  ): Promise<PerfilConexionCliente> {
    const actual = await this.buscarPerfilRedactado(clientId, profileId);
    const destino =
      entrada.destinoMySql === undefined
        ? this.politica.obtenerMySql(actual.destinoMySqlId)
        : this.politica.buscarMySql(entrada.destinoMySql.hostname, entrada.destinoMySql.port);
    const gateway =
      entrada.gatewaySsh === undefined
        ? actual.gatewaySshId === null
          ? undefined
          : this.politica.obtenerGatewaySsh(actual.gatewaySshId)
        : entrada.gatewaySsh === null
          ? undefined
          : this.politica.buscarGatewaySsh(entrada.gatewaySsh.hostname, entrada.gatewaySsh.port);
    if (
      destino === undefined ||
      (actual.tipo === 'MYSQL_SSH' && gateway === undefined) ||
      (actual.tipo === 'MYSQL_TCP' &&
        entrada.gatewaySsh !== undefined &&
        entrada.gatewaySsh !== null)
    ) {
      throw new ErrorPerfilesConexion('DESTINATION_NOT_ALLOWED', 422);
    }
    validarConfiguracionPerfil(actual.tipo, gateway?.id, undefined);
    const destinoMySqlId = destino.id;
    const gatewaySshId = gateway?.id;
    this.exigirDestinoPermitido(destinoMySqlId, gatewaySshId);

    const cambios: CambiosPerfilConexionPersistidos = {
      ...(entrada.nombre === undefined ? {} : { nombre: normalizarNombrePerfil(entrada.nombre) }),
      ...(entrada.entorno === undefined ? {} : { entorno: entrada.entorno }),
      ...(entrada.destinoMySql === undefined ? {} : { destinoMySqlId }),
      ...(entrada.gatewaySsh === undefined
        ? {}
        : { gatewaySshId: entrada.gatewaySsh === null ? null : gatewaySshId }),
      ...(entrada.baseDatos === undefined ? {} : { baseDatos: entrada.baseDatos }),
      ...(entrada.estado === undefined ? {} : { estado: entrada.estado }),
      updatedAt: this.reloj.ahora(),
    };

    try {
      const perfil = await this.repositorio.actualizar(clientId, profileId, cambios, actor);
      if (perfil === null) {
        throw new ErrorPerfilesConexion('PROFILE_NOT_FOUND', 404);
      }
      return perfil;
    } catch (error: unknown) {
      if (obtenerCodigoPostgres(error) === '23505') {
        throw new ErrorPerfilesConexion('PROFILE_DUPLICATE', 409);
      }
      throw error;
    }
  }

  /** Cifra y reemplaza credenciales con AAD unido al perfil sin devolverlas. */
  public async reemplazarCredenciales(
    clientId: string,
    profileId: string,
    entrada: SolicitudReemplazarCredencialesPerfilAdmin,
    actor: ActorAdministracionClientes,
  ): Promise<PerfilConexionCliente> {
    const perfil = await this.buscarPerfilRedactado(clientId, profileId);
    validarConfiguracionPerfil(perfil.tipo, perfil.gatewaySshId ?? undefined, entrada.credenciales);
    this.exigirDestinoPermitido(perfil.destinoMySqlId, perfil.gatewaySshId ?? undefined);
    const custodia = this.exigirCustodia();
    const sobre = await this.cifrarCredenciales(
      custodia,
      entrada.credenciales,
      crearContextoSobre(clientId, profileId),
    );

    const actualizado = await this.repositorio.reemplazarSobre(
      clientId,
      profileId,
      sobre,
      this.reloj.ahora(),
      actor,
    );
    if (actualizado === null) {
      throw new ErrorPerfilesConexion('PROFILE_NOT_FOUND', 404);
    }
    return actualizado;
  }

  /** Descifra un perfil activo, ejecuta la prueba limitada y registra su resultado. */
  public async probar(
    clientId: string,
    profileId: string,
    actor: ActorAdministracionClientes,
  ): Promise<ResultadoPruebaConexion> {
    const perfil = await this.repositorio.obtenerParaPrueba(clientId, profileId);
    if (perfil === null) {
      throw new ErrorPerfilesConexion('PROFILE_NOT_FOUND', 404);
    }

    const destino = this.politica.obtenerMySql(perfil.destinoMySqlId);
    const gateway =
      perfil.gatewaySshId === null
        ? undefined
        : this.politica.obtenerGatewaySsh(perfil.gatewaySshId);
    if (destino === undefined || (perfil.tipo === 'MYSQL_SSH' && gateway === undefined)) {
      return this.auditarPrueba(clientId, profileId, actor, 'DESTINATION_NOT_ALLOWED');
    }
    if (this.custodia === null) {
      return this.auditarPrueba(clientId, profileId, actor, 'SECRET_CUSTODY_DISABLED');
    }

    let secreto: Buffer | null = null;
    let resultado: ResultadoPruebaConexion;
    try {
      secreto = await this.custodia.descifrar(
        perfil.sobre,
        crearContextoSobre(clientId, profileId),
      );
      const solicitud: PerfilConexionPrueba = {
        id: perfil.id,
        clientId: perfil.clientId,
        tipo: perfil.tipo,
        destinoMySqlId: perfil.destinoMySqlId,
        ...(perfil.gatewaySshId === null ? {} : { gatewaySshId: perfil.gatewaySshId }),
        baseDatos: perfil.baseDatos,
      };
      resultado = await this.broker.probar(solicitud, secreto);
    } catch (error: unknown) {
      const codigoErrorCustodia = obtenerCodigoErrorCustodia(error);
      if (codigoErrorCustodia === undefined) {
        resultado = { code: 'MYSQL_CONNECTION_FAILED', completedAt: this.reloj.ahora() };
      } else {
        const codigo: CodigoResultadoPruebaConexion =
          codigoErrorCustodia === 'KEY_VERSION_UNAVAILABLE' ||
          codigoErrorCustodia === 'MASTER_KEY_UNAVAILABLE'
            ? 'SECRET_CUSTODY_UNAVAILABLE'
            : 'SECRET_PACKAGE_INVALID';
        resultado = { code: codigo, completedAt: this.reloj.ahora() };
      }
    } finally {
      secreto?.fill(0);
    }

    await this.repositorio.registrarPrueba(clientId, profileId, resultado, actor);
    return resultado;
  }

  /**
   * Descifra temporalmente un perfil activo y abre lecturas RF-1 limitadas.
   * El llamador debe autorizar cliente, rol y capacidad vigente antes de invocar este método.
   * @param clientId Cliente al que pertenece el perfil.
   * @param profileId Perfil activo asociado al cliente.
   * @param senal Cancelación de la operación que debe propagarse al socket.
   * @returns Sesión de solo lectura que el llamador debe cerrar en `finally`.
   * @throws ErrorPerfilesConexion si el perfil, destino o custodia no están disponibles.
   */
  public async abrirLecturaRf1(
    clientId: string,
    profileId: string,
    senal: AbortSignal,
  ): Promise<SesionLecturaRf1> {
    const perfil = await this.repositorio.obtenerParaPrueba(clientId, profileId);
    if (perfil === null) {
      throw new ErrorPerfilesConexion('PROFILE_NOT_FOUND', 404);
    }
    this.exigirDestinoPermitido(
      perfil.destinoMySqlId,
      perfil.gatewaySshId === null ? undefined : perfil.gatewaySshId,
    );
    const custodia = this.exigirCustodia();
    let secreto: Buffer | null = null;
    try {
      secreto = await custodia.descifrar(perfil.sobre, crearContextoSobre(clientId, profileId));
      const solicitud: PerfilConexionPrueba = {
        id: perfil.id,
        clientId: perfil.clientId,
        tipo: perfil.tipo,
        destinoMySqlId: perfil.destinoMySqlId,
        ...(perfil.gatewaySshId === null ? {} : { gatewaySshId: perfil.gatewaySshId }),
        baseDatos: perfil.baseDatos,
      };
      return await this.broker.abrirLecturaRf1(solicitud, secreto, senal);
    } catch (error: unknown) {
      throw convertirErrorLecturaRf1(error);
    } finally {
      secreto?.fill(0);
    }
  }

  /**
   * Descifra temporalmente un perfil activo y abre escritura RF-1 parametrizada.
   * El llamador debe exigir sesión, rol, asignación, capacidad y gate global antes de invocarlo.
   * @param clientId Cliente propietario del perfil solicitado.
   * @param profileId Perfil activo asociado al cliente.
   * @param senal Cancelación que se propaga a MySQL y al túnel SSH.
   * @param huellaEsperada Huella confirmada durante la previsualización; invalida cambios de destino o credenciales.
   * @returns Sesión transaccional RF-1 que debe cerrarse en finally.
   * @throws ErrorPerfilesConexion ante perfil, destino, custodia o conexión inválidos.
   */
  public async abrirInsercionRf1(
    clientId: string,
    profileId: string,
    senal: AbortSignal,
    huellaEsperada: string,
  ): Promise<SesionInsercionRf1> {
    const perfil = await this.repositorio.obtenerParaPrueba(clientId, profileId);
    if (perfil === null) {
      throw new ErrorPerfilesConexion('PROFILE_NOT_FOUND', 404);
    }
    if (calcularHuellaPerfilConexion(perfil) !== huellaEsperada) {
      throw new ErrorPerfilesConexion('PROFILE_CHANGED', 409);
    }
    this.exigirDestinoPermitido(
      perfil.destinoMySqlId,
      perfil.gatewaySshId === null ? undefined : perfil.gatewaySshId,
    );
    const custodia = this.exigirCustodia();
    let secreto: Buffer | null = null;
    try {
      secreto = await custodia.descifrar(perfil.sobre, crearContextoSobre(clientId, profileId));
      const solicitud: PerfilConexionPrueba = {
        id: perfil.id,
        clientId: perfil.clientId,
        tipo: perfil.tipo,
        destinoMySqlId: perfil.destinoMySqlId,
        ...(perfil.gatewaySshId === null ? {} : { gatewaySshId: perfil.gatewaySshId }),
        baseDatos: perfil.baseDatos,
      };
      return await this.broker.abrirInsercionRf1(solicitud, secreto, senal);
    } catch (error: unknown) {
      throw convertirErrorLecturaRf1(error);
    } finally {
      secreto?.fill(0);
    }
  }

  /** Comprueba y resuelve destinos desde allowlist operacional, nunca desde host API. */
  private exigirDestinoPermitido(destinoMySqlId: string, gatewaySshId?: string): void {
    if (
      this.politica.obtenerMySql(destinoMySqlId) === undefined ||
      (gatewaySshId !== undefined && this.politica.obtenerGatewaySsh(gatewaySshId) === undefined)
    ) {
      throw new ErrorPerfilesConexion('DESTINATION_NOT_ALLOWED', 422);
    }
  }

  /** Proyecta endpoints autorizados para ADMIN sin exponer referencias operacionales internas. */
  public presentarPerfilAdmin(perfil: PerfilConexionCliente): PerfilConexionAdminContrato {
    const destino = this.politica.obtenerMySql(perfil.destinoMySqlId);
    const gateway =
      perfil.gatewaySshId === null
        ? undefined
        : this.politica.obtenerGatewaySsh(perfil.gatewaySshId);
    return {
      id: perfil.id,
      clientId: perfil.clientId,
      nombre: perfil.nombre,
      tipo: perfil.tipo,
      entorno: perfil.entorno,
      destinoMySql: destino === undefined ? null : endpointVisible(destino),
      gatewaySsh: gateway === undefined ? null : endpointVisible(gateway),
      baseDatos: perfil.baseDatos,
      estado: perfil.estado,
      createdAt: perfil.createdAt.toISOString(),
      updatedAt: perfil.updatedAt.toISOString(),
    };
  }

  /** Devuelve la custodia configurada o detiene la operación antes de cambiar la base. */
  private exigirCustodia(): ServicioCifradoSecretos {
    if (this.custodia === null) {
      throw new ErrorPerfilesConexion('SECRET_CUSTODY_DISABLED', 503);
    }
    return this.custodia;
  }

  /** Cifra el paquete en memoria, borra su buffer y traduce fallos criptográficos estables. */
  private async cifrarCredenciales(
    custodia: ServicioCifradoSecretos,
    credenciales: SolicitudCrearPerfilConexionAdmin['credenciales'],
    contexto: ContextoSobreSecreto,
  ): Promise<Awaited<ReturnType<ServicioCifradoSecretos['cifrar']>>> {
    const secreto = Buffer.from(JSON.stringify(credenciales), 'utf8');
    try {
      return await custodia.cifrar(secreto, contexto);
    } catch (error: unknown) {
      const codigo = obtenerCodigoErrorCustodia(error);
      if (codigo === 'SECRET_PACKAGE_TOO_LARGE') {
        throw new ErrorPerfilesConexion('SECRET_PACKAGE_TOO_LARGE', 413);
      }
      if (codigo !== undefined) {
        throw new ErrorPerfilesConexion('SECRET_CUSTODY_UNAVAILABLE', 503);
      }
      throw error;
    } finally {
      secreto.fill(0);
    }
  }

  /** Recupera un perfil redactado y exige que pertenezca al cliente indicado. */
  private async buscarPerfilRedactado(
    clientId: string,
    profileId: string,
  ): Promise<PerfilConexionCliente> {
    const perfil = (await this.repositorio.listar(clientId)).find((fila) => fila.id === profileId);
    if (perfil === undefined) {
      throw new ErrorPerfilesConexion('PROFILE_NOT_FOUND', 404);
    }
    return perfil;
  }

  /** Audita un resultado controlado sin descifrar ni abrir una conexión. */
  private async auditarPrueba(
    clientId: string,
    profileId: string,
    actor: ActorAdministracionClientes,
    code: CodigoResultadoPruebaConexion,
  ): Promise<ResultadoPruebaConexion> {
    const resultado: ResultadoPruebaConexion = { code, completedAt: this.reloj.ahora() };
    await this.repositorio.registrarPrueba(clientId, profileId, resultado, actor);
    return resultado;
  }
}

/** Normaliza y valida la etiqueta que distingue perfiles en la interfaz ADMIN. */
function normalizarNombrePerfil(valor: string): string {
  const nombre = valor.trim();
  if (nombre.length < 2 || nombre.length > 120) {
    throw new ErrorPerfilesConexion('PROFILE_NAME_INVALID', 400);
  }
  return nombre;
}

/** Copia únicamente hostname y puerto desde la política, sin ID ni dirección fijada. */
function endpointVisible(valor: {
  readonly hostname: string;
  readonly port: number;
}): EndpointConexionAdmin {
  return { hostname: valor.hostname, port: valor.port };
}

/** Rechaza rutas SSH o pares TLS incoherentes antes de cifrar las credenciales. */
function validarConfiguracionPerfil(
  tipo: 'MYSQL_TCP' | 'MYSQL_SSH',
  gatewaySshId: string | null | undefined,
  credenciales: SolicitudCrearPerfilConexionAdmin['credenciales'] | undefined,
): void {
  const usaSsh = credenciales?.ssh !== undefined;
  const certificadoTls = credenciales?.tls?.cert !== undefined;
  const llaveTls = credenciales?.tls?.key !== undefined;
  const tlsIncompleto = certificadoTls !== llaveTls;
  const sshInvalido =
    tipo === 'MYSQL_SSH'
      ? gatewaySshId === undefined ||
        gatewaySshId === null ||
        (credenciales !== undefined && !usaSsh)
      : (gatewaySshId !== undefined && gatewaySshId !== null) ||
        (credenciales !== undefined && usaSsh);
  if (sshInvalido || tlsIncompleto) {
    throw new ErrorPerfilesConexion('PROFILE_CONFIGURATION_INVALID', 400);
  }
}

/** Forma el AAD canónico que evita mover el sobre a otro cliente o perfil. */
function crearContextoSobre(clientId: string, profileId: string): ContextoSobreSecreto {
  return { clientId, profileId, purpose: 'MYSQL_CREDENTIALS' };
}

/** Obtiene SQLSTATE sin depender de mensajes o parámetros del driver. */
function obtenerCodigoPostgres(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

/** Reconoce códigos de custodia estables sin depender de una instancia duplicada del paquete. */
function obtenerCodigoErrorCustodia(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === 'string' &&
    [
      'INVALID_SECRET_CONTEXT',
      'INVALID_SECRET_ENVELOPE',
      'MASTER_KEY_INVALID',
      'MASTER_KEY_UNAVAILABLE',
      'KEY_VERSION_UNAVAILABLE',
      'ENVELOPE_DECRYPTION_FAILED',
      'SECRET_PACKAGE_TOO_LARGE',
    ].includes(code)
    ? code
    : undefined;
}

/** Traduce fallos de custodia y red a errores públicos sin copiar detalles internos. */
function convertirErrorLecturaRf1(error: unknown): ErrorPerfilesConexion {
  if (error instanceof ErrorPerfilesConexion) {
    return error;
  }
  const codigoCustodia = obtenerCodigoErrorCustodia(error);
  if (codigoCustodia !== undefined) {
    const noDisponible =
      codigoCustodia === 'KEY_VERSION_UNAVAILABLE' || codigoCustodia === 'MASTER_KEY_UNAVAILABLE';
    return new ErrorPerfilesConexion(
      noDisponible ? 'SECRET_CUSTODY_UNAVAILABLE' : 'SECRET_PACKAGE_INVALID',
      noDisponible ? 503 : 422,
    );
  }
  const codigo = error instanceof Error ? error.message : '';
  if (codigo === 'CONNECTOR_BUSY') {
    return new ErrorPerfilesConexion('CONNECTOR_BUSY', 503);
  }
  if (codigo === 'RF1_CONNECTION_TIMEOUT') {
    return new ErrorPerfilesConexion('CONNECTION_TIMEOUT', 504);
  }
  if (codigo === 'RF1_SESSION_ABORTED') {
    return new ErrorPerfilesConexion('REQUEST_ABORTED', 400);
  }
  if (codigo === 'PROFILE_INVALID') {
    return new ErrorPerfilesConexion('PROFILE_CONFIGURATION_INVALID', 422);
  }
  if (codigo === 'DESTINATION_NOT_ALLOWED') {
    return new ErrorPerfilesConexion('DESTINATION_NOT_ALLOWED', 422);
  }
  if (codigo === 'INVALID_CREDENTIALS' || codigo === 'SSH_KEY_FORMAT_UNSUPPORTED') {
    return new ErrorPerfilesConexion('SECRET_PACKAGE_INVALID', 422);
  }
  return new ErrorPerfilesConexion('CONNECTION_FAILED', 502);
}
