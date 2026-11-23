import { createHash } from 'node:crypto';
import type { EscritorAuditoriaAuth, RelojAuth } from '../../../../packages/core/src/auth/ports.js';
import type { PerfilConexionCliente } from '../../../../packages/core/src/clients/connection-profile-ports.js';
import type {
  EntradaMapeoFacturaRf1,
  ResultadoInsercionFacturaRf1,
  DecisionAutorizacionEscrituraRf1,
} from '../../../../packages/core/src/clients/rf1-insertion-ports.js';
import type { SeleccionSociedadArchivoRf1Contrato } from '../../../../packages/contracts/src/clients.js';
import type { VistaPreviaCfdiRf1 } from '../../../../modules/rf-1/src/preview.js';
import type { ServicioAccesoCliente } from './client-access-service.js';
import {
  ErrorPerfilesConexion,
  type ServicioPerfilesConexion,
} from './connection-profile-service.js';
import { calcularHuellaPerfilConexion } from './connection-profile-fingerprint.js';
import type {
  ServicioVistaPreviaRf1,
  SolicitudServicioVistaPreviaRf1,
} from './rf1-preview-service.js';
import { RegistroConfirmacionesRf1 } from './rf1-confirmation-registry.js';

/** Solicitud que vuelve a presentar exactamente los datos revisados antes de ejecutar RF-1. */
export type SolicitudInsercionRf1 = SolicitudServicioVistaPreviaRf1;

/** Respuesta de vista previa con confirmación opaca opcional y nunca cacheable. */
export interface PreparacionInsercionRf1 {
  /** Resultados completos y redactados de la vista previa actual. */
  readonly resultados: readonly VistaPreviaCfdiRf1[];
  /** Indica que actor, capacidad, lote y gate permiten mostrar confirmación. */
  readonly executionAvailable: boolean;
  /** Token opaco de un solo uso; se entrega solo cuando todos los documentos están listos. */
  readonly confirmationToken: string | null;
}

/** Error controlado de ejecución que no conserva cuerpo fiscal ni detalles de conexión. */
export class ErrorInsercionRf1 extends Error {
  /**
   * Construye un error controlado sin adjuntar XML, datos de conexión ni mensajes del driver.
   * @param code Código estable que consume el manejador HTTP.
   * @param statusCode Estado HTTP permitido para este error de dominio.
   * @returns Instancia con nombre estable para clasificación segura en la API.
   */
  public constructor(
    public readonly code:
      | 'RF1_INSERTION_DISABLED'
      | 'RF1_CONFIRMATION_INVALID'
      | 'RF1_PREVIEW_NOT_READY'
      | 'RF1_CONNECTION_FAILED',
    public readonly statusCode: 403 | 409 | 502 | 503,
  ) {
    super(code);
    this.name = 'ErrorInsercionRf1';
  }
}

/** Orquesta autorización, confirmación y el motor transaccional de conectores existente. */
export class ServicioInsercionRf1 {
  private readonly confirmaciones = new RegistroConfirmacionesRf1();

  /**
   * Crea el servicio con permisos actuales y una compuerta global separada de capacidades.
   * @param acceso Repositorio lógico que reconsulta identidad, cliente y permiso en PostgreSQL.
   * @param perfiles Servicio server-side que descifra y abre únicamente el perfil autorizado.
   * @param vistaPrevia Parser y lectura RF-1 ya existentes; no se duplica el motor.
   * @param auditoria Puerto de auditoría sin contenido de factura ni credenciales.
   * @param reloj Fuente del instante UTC controlado por el servidor.
   * @param compuertaHabilitada Configuración explícita del proceso, cerrada por defecto.
   */
  public constructor(
    private readonly acceso: Pick<ServicioAccesoCliente, 'exigir'>,
    private readonly perfiles: Pick<ServicioPerfilesConexion, 'abrirInsercionRf1' | 'listar'>,
    private readonly vistaPrevia: Pick<ServicioVistaPreviaRf1, 'preautorizar' | 'ejecutar'>,
    private readonly auditoria: EscritorAuditoriaAuth,
    private readonly reloj: RelojAuth,
    private readonly compuertaHabilitada: boolean,
  ) {}

  /**
   * Emite una confirmación solo para un lote READY con permiso y gate actuales.
   * @param solicitud Contexto autenticado y bytes originales ya recibidos en memoria.
   * @param resultados Resultado producido por el preview de esta misma solicitud.
   * @returns Confirmación opaca disponible o estado no ejecutable.
   * @effects El registro almacena solo hash del token, contexto y vencimiento.
   */
  public async prepararConfirmacion(
    solicitud: SolicitudInsercionRf1,
    resultados: readonly VistaPreviaCfdiRf1[],
  ): Promise<Omit<PreparacionInsercionRf1, 'resultados'>> {
    if (!this.compuertaHabilitada || !loteListo(resultados, solicitud.archivos.length)) {
      return { executionAvailable: false, confirmationToken: null };
    }
    try {
      await this.acceso.exigir(solicitud.actor, solicitud.clientId, 'rf-1:execute');
    } catch (error: unknown) {
      if (obtenerEstadoHttp(error) === 403) {
        return { executionAvailable: false, confirmationToken: null };
      }
      throw error;
    }

    const huellaPerfil = await this.obtenerHuellaPerfil(solicitud.clientId, solicitud.profileId);
    if (huellaPerfil === null) {
      return { executionAvailable: false, confirmationToken: null };
    }

    const confirmationToken = this.confirmaciones.emitir(
      {
        actorUserId: solicitud.actor.actorUserId,
        clientId: solicitud.clientId,
        profileId: solicitud.profileId,
        digest: calcularDigest(solicitud, resultados, huellaPerfil),
      },
      this.reloj.ahora(),
    );
    return {
      executionAvailable: confirmationToken !== null,
      confirmationToken,
    };
  }

  /**
   * Exige gate, lectura, ejecución y perfil antes de aceptar el multipart de inserción.
   * @param solicitud Identidad y selección de cliente/perfil recibidas por la ruta autenticada.
   * @returns Promesa que termina cuando se vuelven a validar todos los permisos actuales.
   * @throws ErrorInsercionRf1 si el gate global está cerrado.
   * @effects Consulta autorización backend sin abrir una conexión MySQL ni leer XML.
   */
  public async preautorizar(solicitud: SolicitudInsercionRf1): Promise<void> {
    if (!this.compuertaHabilitada) {
      throw new ErrorInsercionRf1('RF1_INSERTION_DISABLED', 503);
    }
    await this.acceso.exigir(solicitud.actor, solicitud.clientId, 'rf-1:read');
    await this.acceso.exigir(solicitud.actor, solicitud.clientId, 'rf-1:execute');
    await this.vistaPrevia.preautorizar(solicitud.actor, solicitud.clientId, solicitud.profileId);
  }

  /**
   * Revalida lectura, escritura, perfil, vista previa y token antes de insertar en serie.
   * @param solicitud XML original y selecciones exactas revisadas por el operador.
   * @param confirmationToken Token opaco emitido para la misma identidad y contenido.
   * @returns Un resultado independiente por factura, sin mensajes de driver.
   * @throws ErrorInsercionRf1 si gate, token o preview ya no son válidos.
   * @effects Ejecuta el escritor RF-1 fijo, cada factura en su transacción existente.
   */
  public async ejecutar(
    solicitud: SolicitudInsercionRf1,
    confirmationToken: string,
  ): Promise<readonly ResultadoInsercionFacturaRf1[]> {
    if (!this.compuertaHabilitada) {
      await this.auditar(solicitud, 'RF1_INSERTION_DENIED', 'DENIED', 'GATE_DISABLED');
      throw new ErrorInsercionRf1('RF1_INSERTION_DISABLED', 503);
    }

    await this.preautorizar(solicitud);
    const resultadosPreview = await this.vistaPrevia.ejecutar(solicitud);
    if (!loteListo(resultadosPreview, solicitud.archivos.length)) {
      await this.auditar(solicitud, 'RF1_INSERTION_DENIED', 'DENIED', 'PREVIEW_NOT_READY');
      throw new ErrorInsercionRf1('RF1_PREVIEW_NOT_READY', 409);
    }

    const huellaPerfil = await this.obtenerHuellaPerfil(solicitud.clientId, solicitud.profileId);
    if (huellaPerfil === null) {
      await this.auditar(solicitud, 'RF1_INSERTION_DENIED', 'DENIED', 'PROFILE_CHANGED');
      throw new ErrorInsercionRf1('RF1_CONFIRMATION_INVALID', 409);
    }

    const tokenValido = this.confirmaciones.consumir(
      confirmationToken,
      {
        actorUserId: solicitud.actor.actorUserId,
        clientId: solicitud.clientId,
        profileId: solicitud.profileId,
        digest: calcularDigest(solicitud, resultadosPreview, huellaPerfil),
      },
      this.reloj.ahora(),
    );
    if (!tokenValido) {
      await this.auditar(solicitud, 'RF1_INSERTION_DENIED', 'DENIED', 'CONFIRMATION_INVALID');
      throw new ErrorInsercionRf1('RF1_CONFIRMATION_INVALID', 409);
    }

    await this.auditar(solicitud, 'RF1_INSERTION_REQUESTED', 'SUCCESS', 'CONFIRMED_PREVIEW');

    let sesion: Awaited<ReturnType<ServicioPerfilesConexion['abrirInsercionRf1']>>;
    try {
      sesion = await this.perfiles.abrirInsercionRf1(
        solicitud.clientId,
        solicitud.profileId,
        solicitud.senal,
        huellaPerfil,
      );
    } catch (error: unknown) {
      if (error instanceof ErrorPerfilesConexion && error.code === 'PROFILE_CHANGED') {
        await this.auditar(solicitud, 'RF1_INSERTION_DENIED', 'DENIED', 'PROFILE_CHANGED');
        throw new ErrorInsercionRf1('RF1_CONFIRMATION_INVALID', 409);
      }
      await this.auditar(solicitud, 'RF1_INSERTION_FAILED', 'FAILURE', 'CONNECTION_UNAVAILABLE');
      throw new ErrorInsercionRf1('RF1_CONNECTION_FAILED', 502);
    }
    const resultados: ResultadoInsercionFacturaRf1[] = [];
    try {
      for (const [indice, vista] of resultadosPreview.entries()) {
        const entrada = convertirVistaAEntrada(vista, this.reloj.ahora());
        /**
         * Vuelve a consultar el permiso y la revisión del perfil antes del DML de esta factura.
         * @returns Decisión cerrada del guard que consume el conector antes de insertar.
         * @effects Evita una escritura nueva si el acceso se revocó o el perfil cambió.
         */
        const autorizarEscrituraVigente = async (): Promise<DecisionAutorizacionEscrituraRf1> => {
          try {
            await this.acceso.exigir(solicitud.actor, solicitud.clientId, 'rf-1:execute');
          } catch (error: unknown) {
            if (obtenerEstadoHttp(error) === 403) {
              return 'ACCESO_REVOCADO';
            }
            throw error;
          }
          return (await this.obtenerHuellaPerfil(solicitud.clientId, solicitud.profileId)) ===
            huellaPerfil
            ? 'AUTORIZADA'
            : 'PERFIL_CAMBIADO';
        };
        const resultado = await sesion.insertar(entrada, autorizarEscrituraVigente);
        resultados.push(resultado);
        if (
          resultado.errorCode === 'RF1_ACCESS_REVOKED' ||
          resultado.errorCode === 'RF1_PROFILE_CHANGED'
        ) {
          const errorCode = resultado.errorCode;
          for (let restante = indice + 1; restante < resultadosPreview.length; restante += 1) {
            resultados.push({ status: 'RECHAZADA', errorCode });
          }
          break;
        }
      }
    } finally {
      await sesion.cerrar();
    }

    const resumen = resumirResultados(resultados);
    const huboFallo = resultados.some(
      (resultado) =>
        resultado.status === 'ERROR_REVERTIDO' ||
        resultado.status === 'INDETERMINADO' ||
        resultado.status === 'RECHAZADA',
    );
    await this.auditar(
      solicitud,
      'RF1_INSERTION_COMPLETED',
      huboFallo ? 'FAILURE' : 'SUCCESS',
      resumen,
    );
    return resultados;
  }

  /**
   * Registra acción y conteo agregado; excluye XML, UUID, tokens y credenciales.
   * @param solicitud Contexto autenticado con IDs de cliente, perfil y request.
   * @param action Acción de auditoría estable de la operación RF-1.
   * @param outcome Resultado de auditoría permitido para el evento.
   * @param resultCode Resumen estable o conteos agregados sin datos fiscales.
   * @returns Promesa resuelta cuando el repositorio confirma el evento.
   * @effects Persiste metadatos mínimos para trazabilidad; propaga fallos de auditoría.
   */
  private async auditar(
    solicitud: SolicitudInsercionRf1,
    action: string,
    outcome: 'SUCCESS' | 'FAILURE' | 'DENIED',
    resultCode: string,
  ): Promise<void> {
    await this.auditoria.registrar({
      actorUserId: solicitud.actor.actorUserId,
      action,
      targetUserId: null,
      outcome,
      metadata: {
        clientId: solicitud.clientId,
        profileId: solicitud.profileId,
        requestId: solicitud.actor.requestId,
        resultCode,
        fileCount: solicitud.archivos.length,
      },
      createdAt: this.reloj.ahora(),
    });
  }

  /**
   * Recupera la huella solo de un perfil que siga perteneciendo y activo para el cliente.
   * @param clientId Cliente que el guard ya autorizó para la operación.
   * @param profileId Perfil que debe pertenecer al cliente y seguir activo.
   * @returns Huella operativa o `null` si ya no existe, pertenece a otro cliente o está inactivo.
   * @effects Lee metadatos del perfil sin entregar el sobre cifrado al navegador.
   */
  private async obtenerHuellaPerfil(clientId: string, profileId: string): Promise<string | null> {
    const perfil: PerfilConexionCliente | undefined = (await this.perfiles.listar(clientId)).find(
      (fila) => fila.id === profileId,
    );
    return perfil === undefined || perfil.estado !== 'ACTIVE'
      ? null
      : calcularHuellaPerfilConexion(perfil);
  }
}

/**
 * Exige un resultado READY íntegro por cada archivo solicitado antes de una confirmación.
 * @param resultados Resultados redactados de la vista previa actual.
 * @param cantidadArchivos Cantidad de buffers originales que acompañan la solicitud.
 * @returns `true` si existe exactamente un resultado listo por cada archivo.
 */
function loteListo(resultados: readonly VistaPreviaCfdiRf1[], cantidadArchivos: number): boolean {
  return (
    resultados.length > 0 &&
    resultados.length === cantidadArchivos &&
    resultados.every(
      (resultado) =>
        resultado.status === 'READY' &&
        resultado.factura !== undefined &&
        resultado.resolution !== undefined &&
        resultado.estatus !== undefined,
    )
  );
}

/**
 * Convierte un resultado READY del parser a la entrada tipada del escritor existente.
 * @param vista Resultado de vista previa cuya factura y resolución ya fueron validadas.
 * @param fechaCarga Instante UTC capturado por el reloj del servidor para esta factura.
 * @returns Entrada de mapeo RF-1 sin campos de destino seleccionables por el navegador.
 * @throws ErrorInsercionRf1 si la vista previa dejó de estar lista.
 */
function convertirVistaAEntrada(
  vista: VistaPreviaCfdiRf1,
  fechaCarga: Date,
): EntradaMapeoFacturaRf1 {
  if (
    vista.status !== 'READY' ||
    vista.factura === undefined ||
    vista.resolution === undefined ||
    vista.estatus === undefined
  ) {
    throw new ErrorInsercionRf1('RF1_PREVIEW_NOT_READY', 409);
  }
  return {
    factura: vista.factura,
    resolution: vista.resolution,
    estatus: vista.estatus,
    fechaCarga,
  };
}

/**
 * Calcula una huella no reversible con identidad, contexto, selecciones y bytes del lote.
 * @param solicitud Solicitud autenticada, contexto operativo y XML originales en memoria.
 * @param resultados Resoluciones y datos normalizados producidos por la vista previa.
 * @param huellaPerfil Revisión operativa del perfil activo que se usará al escribir.
 * @returns Digest SHA-256 que liga la confirmación a la solicitud exacta.
 * @effects No conserva el XML, el digest ni el token en PostgreSQL o en los logs.
 */
function calcularDigest(
  solicitud: SolicitudInsercionRf1,
  resultados: readonly VistaPreviaCfdiRf1[],
  huellaPerfil: string,
): string {
  const hash = createHash('sha256');
  const selecciones = [...(solicitud.seleccionesSociedad ?? [])]
    .sort((izquierda, derecha) => izquierda.indiceArchivo - derecha.indiceArchivo)
    .map((seleccion: SeleccionSociedadArchivoRf1Contrato) => ({
      indiceArchivo: seleccion.indiceArchivo,
      sociedad: seleccion.sociedad,
      ambienteSap: seleccion.ambienteSap,
    }));
  hash.update(
    JSON.stringify({
      actorUserId: solicitud.actor.actorUserId,
      clientId: solicitud.clientId,
      profileId: solicitud.profileId,
      estatus: solicitud.estatus,
      selecciones,
      huellaPerfil,
      cantidad: solicitud.archivos.length,
      resultados: resultados.map((resultado) => ({
        status: resultado.status,
        errorCode: resultado.errorCode,
        factura: resultado.factura,
        estatus: resultado.estatus,
        resolution: resultado.resolution,
      })),
    }),
    'utf8',
  );
  for (const archivo of solicitud.archivos) {
    const longitud = Buffer.allocUnsafe(8);
    longitud.writeBigUInt64BE(BigInt(archivo.byteLength));
    hash.update(longitud);
    hash.update(archivo);
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Resume estados individuales para auditoría sin enumerar documentos fiscales.
 * @param resultados Resultados por factura devueltos por el conector.
 * @returns Conteos ordenados por estado, sin UUID ni valores de factura.
 */
function resumirResultados(resultados: readonly ResultadoInsercionFacturaRf1[]): string {
  const conteos = new Map<string, number>();
  for (const resultado of resultados) {
    conteos.set(resultado.status, (conteos.get(resultado.status) ?? 0) + 1);
  }
  return [...conteos]
    .sort(([izquierda], [derecha]) => izquierda.localeCompare(derecha))
    .map(([estado, cantidad]) => `${estado}:${cantidad}`)
    .join(',');
}

/**
 * Extrae el estado HTTP estructural de un error sin exponer su mensaje.
 * @param error Excepción recibida del guard o de otra capa de aplicación.
 * @returns Código numérico de estado cuando está presente, o `undefined`.
 */
function obtenerEstadoHttp(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number(error.statusCode)
    : undefined;
}
