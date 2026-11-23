import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Value } from '@sinclair/typebox/value';
import {
  clienteParamsSchema,
  errorClienteAdminSchema,
  respuestaVistaPreviaRf1Schema,
  resultadosInsercionRf1Schema,
  seleccionesSociedadRf1Schema,
  solicitudVistaPreviaRf1Schema,
  type EstatusVistaPreviaRf1Contrato,
  type ParametrosCliente,
  type SeleccionSociedadArchivoRf1Contrato,
  type SolicitudVistaPreviaRf1Contrato,
} from '../../../../packages/contracts/src/clients.js';
import type { RelojAuth, EscritorAuditoriaAuth } from '../../../../packages/core/src/auth/ports.js';
import { requireAuthenticatedSession } from '../auth/authorization.js';
import type { ServicioSesion } from '../auth/session-service.js';
import type { ConfiguracionAuth } from '../config.js';
import { ErrorAccesoCliente } from '../clients/client-access-service.js';
import { ErrorPerfilesConexion } from '../clients/connection-profile-service.js';
import { ServicioVistaPreviaRf1 } from '../clients/rf1-preview-service.js';
import { ErrorInsercionRf1, type ServicioInsercionRf1 } from '../clients/rf1-insertion-service.js';

const MAXIMO_ARCHIVOS = 100;
const MAXIMO_BYTES_POR_ARCHIVO = 5 * 1024 * 1024;
const MAXIMO_BYTES_POR_LOTE = 25 * 1024 * 1024;
const MAXIMO_BYTES_SELECCIONES = 16 * 1024;
const LIMITE_TIEMPO_SOLICITUD_MS = 30_000;
const LIMITES_MULTIPART = {
  files: MAXIMO_ARCHIVOS,
  fields: 1,
  parts: MAXIMO_ARCHIVOS + 1,
  fileSize: MAXIMO_BYTES_POR_ARCHIVO,
  fieldNameSize: 32,
  fieldSize: MAXIMO_BYTES_SELECCIONES,
  headerPairs: 64,
} as const;

/** Dependencias de la ruta de preview; el navegador nunca recibe acceso al broker ni a secretos. */
export interface DependenciasRutasVistaPreviaRf1 {
  /** Origen/cookie con los que el guard valida la sesión antes de leer el cuerpo. */
  readonly configuracion: ConfiguracionAuth;
  /** Resolutor server-side de sesión vigente y revocación inmediata. */
  readonly sesiones: ServicioSesion;
  /** Servicio de aplicación que revalida cliente, perfil, rol y capacidad por operación. */
  readonly vistaPrevia: ServicioVistaPreviaRf1;
  /** Servicio de escritura RF-1 detrás de un gate global cerrado por defecto. */
  readonly insercion?: ServicioInsercionRf1;
  /** Puerto de auditoría usado por guards globales y decisiones de preview. */
  readonly auditoria: EscritorAuditoriaAuth;
  /** Fuente de hora compartida para auditoría, nunca tomada de la petición. */
  readonly reloj: RelojAuth;
}

/** Registra el POST de preview multipart con autorización previa y límites de memoria estrictos. */
export async function registrarRutasVistaPreviaRf1(
  aplicacion: FastifyInstance,
  dependencias: DependenciasRutasVistaPreviaRf1,
): Promise<void> {
  await aplicacion.register(async (rutas) => {
    rutas.setErrorHandler(manejarErrorVistaPrevia);
    const autenticado = requireAuthenticatedSession(
      dependencias.sesiones,
      dependencias.configuracion,
    );

    /** Autoriza antes de leer el multipart y vuelve a validar dentro del servicio de dominio. */
    async function previsualizar(
      solicitud: FastifyRequest<{
        Params: ParametrosCliente;
        Querystring: SolicitudVistaPreviaRf1Contrato;
      }>,
      respuesta: FastifyReply,
    ): Promise<FastifyReply> {
      const actor = exigirActorVistaPrevia(solicitud);
      await dependencias.vistaPrevia.preautorizar(
        actor,
        solicitud.params.clientId,
        solicitud.query.profileId,
      );

      if (!solicitud.isMultipart()) {
        return respuesta.code(415).send({
          code: 'MULTIPART_REQUIRED',
          message: 'La solicitud debe contener archivos multipart/form-data.',
        });
      }

      const controlador = new AbortController();
      let vencioTiempo = false;
      const temporizador = setTimeout(() => {
        vencioTiempo = true;
        controlador.abort();
        solicitud.raw.destroy();
      }, LIMITE_TIEMPO_SOLICITUD_MS);
      temporizador.unref();

      /** Propaga el cierre temprano de la conexión al broker de solo lectura. */
      const cancelarAlAbortar = (): void => controlador.abort();
      /** Cancela trabajo backend si el cliente HTTP cierra mientras se procesa el lote. */
      const cancelarAlCerrarRespuesta = (): void => {
        if (!respuesta.raw.writableEnded) {
          controlador.abort();
        }
      };
      solicitud.raw.once('aborted', cancelarAlAbortar);
      respuesta.raw.once('close', cancelarAlCerrarRespuesta);

      const archivos: Buffer[] = [];
      try {
        const lote = await leerArchivosMultipart(solicitud, controlador.signal);
        archivos.push(...lote.archivos);
        if (vencioTiempo) {
          return respuesta.code(408).send({
            code: 'REQUEST_TIMEOUT',
            message: 'La solicitud excedió el tiempo permitido.',
          });
        }

        const solicitudServicio = {
          actor,
          clientId: solicitud.params.clientId,
          profileId: solicitud.query.profileId,
          estatus: solicitud.query.estatus as EstatusVistaPreviaRf1Contrato,
          archivos,
          seleccionesSociedad: lote.seleccionesSociedad,
          senal: controlador.signal,
        };
        const resultados = await dependencias.vistaPrevia.ejecutar(solicitudServicio);
        const confirmacion = (await dependencias.insercion?.prepararConfirmacion(
          solicitudServicio,
          resultados,
        )) ?? {
          executionAvailable: false,
          confirmationToken: null,
        };
        respuesta.header('cache-control', 'no-store, private').header('pragma', 'no-cache');
        return respuesta.code(200).send({ resultados, ...confirmacion });
      } catch (error: unknown) {
        if (vencioTiempo) {
          return respuesta.code(408).send({
            code: 'REQUEST_TIMEOUT',
            message: 'La solicitud excedió el tiempo permitido.',
          });
        }
        throw error;
      } finally {
        clearTimeout(temporizador);
        solicitud.raw.off('aborted', cancelarAlAbortar);
        respuesta.raw.off('close', cancelarAlCerrarRespuesta);
        for (const archivo of archivos) {
          archivo.fill(0);
        }
      }
    }

    rutas.post<{
      Params: ParametrosCliente;
      Querystring: SolicitudVistaPreviaRf1Contrato;
    }>(
      '/api/v1/clients/:clientId/modules/rf-1/preview',
      {
        preHandler: autenticado,
        schema: {
          params: clienteParamsSchema,
          querystring: solicitudVistaPreviaRf1Schema,
          response: {
            200: respuestaVistaPreviaRf1Schema,
            400: errorClienteAdminSchema,
            401: errorClienteAdminSchema,
            403: errorClienteAdminSchema,
            408: errorClienteAdminSchema,
            404: errorClienteAdminSchema,
            409: errorClienteAdminSchema,
            413: errorClienteAdminSchema,
            415: errorClienteAdminSchema,
            422: errorClienteAdminSchema,
            502: errorClienteAdminSchema,
            503: errorClienteAdminSchema,
            504: errorClienteAdminSchema,
            500: errorClienteAdminSchema,
          },
        },
      },
      previsualizar,
    );

    /**
     * Bloquea gate y permisos antes de leer archivos de cualquier solicitud de escritura.
     * @param solicitud Request con sesión autenticada y contexto de cliente/perfil.
     * @param respuesta Respuesta Fastify para rechazar formatos de cuerpo no permitidos.
     * @returns Respuesta temprana cuando el contenido no es multipart; en otro caso `undefined`.
     * @throws ErrorInsercionRf1 si el servicio o la compuerta global no están habilitados.
     * @effects Revalida rol, cliente, capacidades y perfil antes de consumir el cuerpo.
     */
    async function preautorizarEjecucion(
      solicitud: FastifyRequest<{
        Params: ParametrosCliente;
        Querystring: SolicitudVistaPreviaRf1Contrato;
      }>,
      respuesta: FastifyReply,
    ): Promise<FastifyReply | undefined> {
      const insercion = dependencias.insercion;
      if (insercion === undefined) {
        throw new ErrorInsercionRf1('RF1_INSERTION_DISABLED', 503);
      }
      const actor = exigirActorVistaPrevia(solicitud);
      await insercion.preautorizar({
        actor,
        clientId: solicitud.params.clientId,
        profileId: solicitud.query.profileId,
        estatus: solicitud.query.estatus as EstatusVistaPreviaRf1Contrato,
        archivos: [],
        seleccionesSociedad: [],
        senal: new AbortController().signal,
      });
      if (!solicitud.isMultipart()) {
        return respuesta.code(415).send({
          code: 'MULTIPART_REQUIRED',
          message: 'La solicitud debe contener archivos multipart/form-data.',
        });
      }
      return undefined;
    }

    /**
     * Recalcula el lote, consume el token de un solo uso y llama el motor transaccional fijo.
     * @param solicitud Request multipart autenticada, protegida con CSRF y limitada por tamaño.
     * @param respuesta Respuesta Fastify para estados individuales y errores controlados.
     * @returns Respuesta HTTP con un resultado por archivo o un error redactado.
     * @throws ErrorInsercionRf1 ante token, autorización, gate o preview no válidos.
     * @effects Borra los buffers de XML al finalizar y no conserva el contenido en logs.
     */
    async function insertar(
      solicitud: FastifyRequest<{
        Params: ParametrosCliente;
        Querystring: SolicitudVistaPreviaRf1Contrato;
      }>,
      respuesta: FastifyReply,
    ): Promise<FastifyReply> {
      const rechazo = await preautorizarEjecucion(solicitud, respuesta);
      if (rechazo !== undefined) {
        return rechazo;
      }
      const insercion = dependencias.insercion;
      if (insercion === undefined) {
        throw new ErrorInsercionRf1('RF1_INSERTION_DISABLED', 503);
      }
      const actor = exigirActorVistaPrevia(solicitud);
      const controlador = new AbortController();
      let vencioTiempo = false;
      const temporizador = setTimeout(() => {
        vencioTiempo = true;
        controlador.abort();
        solicitud.raw.destroy();
      }, LIMITE_TIEMPO_SOLICITUD_MS);
      temporizador.unref();
      const cancelarAlAbortar = (): void => controlador.abort();
      const cancelarAlCerrarRespuesta = (): void => {
        if (!respuesta.raw.writableEnded) {
          controlador.abort();
        }
      };
      solicitud.raw.once('aborted', cancelarAlAbortar);
      respuesta.raw.once('close', cancelarAlCerrarRespuesta);
      const archivos: Buffer[] = [];
      try {
        const lote = await leerArchivosMultipart(solicitud, controlador.signal, true);
        archivos.push(...lote.archivos);
        if (vencioTiempo) {
          return respuesta.code(408).send({
            code: 'REQUEST_TIMEOUT',
            message: 'La solicitud excedió el tiempo permitido.',
          });
        }
        if (lote.confirmationToken === undefined) {
          throw new ErrorInsercionRf1('RF1_CONFIRMATION_INVALID', 409);
        }
        const resultados = await insercion.ejecutar(
          {
            actor,
            clientId: solicitud.params.clientId,
            profileId: solicitud.query.profileId,
            estatus: solicitud.query.estatus as EstatusVistaPreviaRf1Contrato,
            archivos,
            seleccionesSociedad: lote.seleccionesSociedad,
            senal: controlador.signal,
          },
          lote.confirmationToken,
        );
        respuesta.header('cache-control', 'no-store, private').header('pragma', 'no-cache');
        return respuesta.code(200).send(resultados);
      } catch (error: unknown) {
        if (vencioTiempo) {
          return respuesta.code(408).send({
            code: 'REQUEST_TIMEOUT',
            message: 'La solicitud excedió el tiempo permitido.',
          });
        }
        throw error;
      } finally {
        clearTimeout(temporizador);
        solicitud.raw.off('aborted', cancelarAlAbortar);
        respuesta.raw.off('close', cancelarAlCerrarRespuesta);
        for (const archivo of archivos) {
          archivo.fill(0);
        }
      }
    }

    rutas.post<{
      Params: ParametrosCliente;
      Querystring: SolicitudVistaPreviaRf1Contrato;
    }>(
      '/api/v1/clients/:clientId/modules/rf-1/execute',
      {
        preHandler: autenticado,
        schema: {
          params: clienteParamsSchema,
          querystring: solicitudVistaPreviaRf1Schema,
          response: {
            200: resultadosInsercionRf1Schema,
            400: errorClienteAdminSchema,
            401: errorClienteAdminSchema,
            403: errorClienteAdminSchema,
            408: errorClienteAdminSchema,
            409: errorClienteAdminSchema,
            413: errorClienteAdminSchema,
            415: errorClienteAdminSchema,
            422: errorClienteAdminSchema,
            502: errorClienteAdminSchema,
            503: errorClienteAdminSchema,
            504: errorClienteAdminSchema,
            500: errorClienteAdminSchema,
          },
        },
      },
      insertar,
    );
  });
}

/** Lee los XML y la selección opcional desde multipart, solo en memoria.
 * @param solicitud - Request de Fastify ya autenticada y protegida contra CSRF.
 * @param senal - Señal que detiene lectura y procesamiento al cancelar o vencer la petición.
 * @param exigirConfirmacion - Exige un token opaco multipart además de las selecciones de sociedad.
 * @returns Archivos originales y selecciones con índices validados dentro del lote.
 * @throws ErrorCargaVistaPrevia ante límites, estructura multipart o selección inválidos.
 * @effects Borra buffers acumulados si la lectura o validación falla.
 */
async function leerArchivosMultipart(
  solicitud: FastifyRequest,
  senal: AbortSignal,
  exigirConfirmacion = false,
): Promise<{
  readonly archivos: readonly Buffer[];
  readonly seleccionesSociedad: readonly SeleccionSociedadArchivoRf1Contrato[];
  readonly confirmationToken?: string;
}> {
  const archivos: Buffer[] = [];
  let totalBytes = 0;
  let recibioSelecciones = false;
  let confirmationToken: string | undefined;
  let jsonSelecciones: string | undefined;
  try {
    for await (const parte of solicitud.parts({
      limits: {
        ...LIMITES_MULTIPART,
        fields: exigirConfirmacion ? 2 : 1,
        parts: MAXIMO_ARCHIVOS + (exigirConfirmacion ? 2 : 1),
      },
    })) {
      if (senal.aborted) {
        throw new ErrorCargaVistaPrevia('REQUEST_ABORTED', 408);
      }
      if (parte.type === 'field') {
        if (
          exigirConfirmacion &&
          parte.fieldname === 'confirmationToken' &&
          confirmationToken === undefined &&
          !parte.fieldnameTruncated &&
          !parte.valueTruncated &&
          typeof parte.value === 'string' &&
          /^[A-Za-z0-9_-]{43}$/u.test(parte.value)
        ) {
          confirmationToken = parte.value;
          continue;
        }
        if (
          parte.fieldname !== 'seleccionesSociedad' ||
          recibioSelecciones ||
          parte.fieldnameTruncated ||
          parte.valueTruncated ||
          typeof parte.value !== 'string'
        ) {
          throw new ErrorCargaVistaPrevia('MULTIPART_SELECTION_INVALID', 400);
        }
        recibioSelecciones = true;
        jsonSelecciones = parte.value;
        continue;
      }
      if (parte.fieldname !== 'files') {
        parte.file.destroy();
        throw new ErrorCargaVistaPrevia('MULTIPART_FIELD_INVALID', 400);
      }
      archivos.push(
        await leerArchivoLimitado(parte, senal, (bytes) => {
          totalBytes += bytes;
          if (totalBytes > MAXIMO_BYTES_POR_LOTE) {
            throw new ErrorCargaVistaPrevia('BATCH_TOO_LARGE', 413);
          }
        }),
      );
    }
    if (exigirConfirmacion && confirmationToken === undefined) {
      throw new ErrorCargaVistaPrevia('MULTIPART_SELECTION_INVALID', 400);
    }
    if (archivos.length === 0) {
      throw new ErrorCargaVistaPrevia('BATCH_EMPTY', 400);
    }
    const seleccionesSociedad = validarSeleccionesSociedad(jsonSelecciones, archivos.length);
    return {
      archivos,
      seleccionesSociedad,
      ...(confirmationToken === undefined ? {} : { confirmationToken }),
    };
  } catch (error: unknown) {
    for (const archivo of archivos) {
      archivo.fill(0);
    }
    if (error instanceof ErrorCargaVistaPrevia) {
      throw error;
    }
    throw traducirErrorMultipart(error);
  }
}

/** Valida estructura, unicidad e índices del campo opcional antes de abrir el broker.
 * @param json - Contenido JSON acotado del campo multipart o `undefined` en el primer análisis.
 * @param cantidadArchivos - Número de archivos aceptados en la misma solicitud.
 * @returns Selecciones tipadas, únicas y acotadas al lote.
 * @throws ErrorCargaVistaPrevia si el JSON, las propiedades o sus índices no son válidos.
 */
function validarSeleccionesSociedad(
  json: string | undefined,
  cantidadArchivos: number,
): readonly SeleccionSociedadArchivoRf1Contrato[] {
  if (json === undefined) {
    return [];
  }

  let valor: unknown;
  try {
    valor = JSON.parse(json) as unknown;
  } catch {
    throw new ErrorCargaVistaPrevia('MULTIPART_SELECTION_INVALID', 400);
  }
  if (!Value.Check(seleccionesSociedadRf1Schema, valor)) {
    throw new ErrorCargaVistaPrevia('MULTIPART_SELECTION_INVALID', 400);
  }

  const selecciones = valor as readonly SeleccionSociedadArchivoRf1Contrato[];
  const indices = new Set<number>();
  for (const seleccion of selecciones) {
    if (seleccion.indiceArchivo >= cantidadArchivos || indices.has(seleccion.indiceArchivo)) {
      throw new ErrorCargaVistaPrevia('MULTIPART_SELECTION_INVALID', 400);
    }
    indices.add(seleccion.indiceArchivo);
  }
  return selecciones;
}

/** Acumula un archivo de hasta 5 MiB y borra segmentos temporales después de unirlos. */
async function leerArchivoLimitado(
  parte: MultipartFile,
  senal: AbortSignal,
  registrarBytes: (bytes: number) => void,
): Promise<Buffer> {
  const segmentos: Buffer[] = [];
  let bytesArchivo = 0;
  try {
    for await (const segmento of parte.file) {
      if (senal.aborted) {
        throw new ErrorCargaVistaPrevia('REQUEST_ABORTED', 408);
      }
      const bytes = Buffer.isBuffer(segmento) ? segmento : Buffer.from(segmento);
      bytesArchivo += bytes.byteLength;
      if (bytesArchivo > MAXIMO_BYTES_POR_ARCHIVO) {
        parte.file.destroy();
        throw new ErrorCargaVistaPrevia('FILE_TOO_LARGE', 413);
      }
      registrarBytes(bytes.byteLength);
      segmentos.push(Buffer.from(bytes));
    }
    if (parte.file.truncated) {
      throw new ErrorCargaVistaPrevia('FILE_TOO_LARGE', 413);
    }
    return Buffer.concat(segmentos, bytesArchivo);
  } finally {
    for (const segmento of segmentos) {
      segmento.fill(0);
    }
  }
}

/** Convierte clases conocidas del parser multipart a errores públicos sin detalle interno. */
function traducirErrorMultipart(error: unknown): ErrorCargaVistaPrevia {
  const codigo = obtenerCodigo(error);
  if (
    codigo === 'FST_REQ_FILE_TOO_LARGE' ||
    codigo === 'FST_FILES_LIMIT' ||
    codigo === 'FST_PARTS_LIMIT' ||
    codigo === 'FST_FIELDS_LIMIT'
  ) {
    return new ErrorCargaVistaPrevia('UPLOAD_LIMIT_EXCEEDED', 413);
  }
  if (codigo === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
    return new ErrorCargaVistaPrevia('MULTIPART_REQUIRED', 415);
  }
  return new ErrorCargaVistaPrevia('MULTIPART_INVALID', 400);
}

/** Devuelve el actor obtenido del contexto de sesión, nunca de parámetros enviados por el cliente. */
function exigirActorVistaPrevia(solicitud: FastifyRequest): {
  readonly actorUserId: string;
  readonly requestId: string;
} {
  if (solicitud.authContext === null) {
    throw new Error('AUTH_CONTEXT_MISSING');
  }
  return { actorUserId: solicitud.authContext.usuario.id, requestId: solicitud.id };
}

/** Traduce autorización, custodia, límites y errores inesperados a respuestas controladas. */
function manejarErrorVistaPrevia(
  error: unknown,
  solicitud: FastifyRequest,
  respuesta: FastifyReply,
): FastifyReply {
  if (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    error.validation !== undefined
  ) {
    return respuesta.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'La solicitud no tiene un formato válido.',
    });
  }
  if (error instanceof ErrorAccesoCliente) {
    return respuesta.code(error.statusCode).send({
      code: 'CLIENT_ACCESS_DENIED',
      message: 'No tienes acceso a este cliente o a la operación solicitada.',
    });
  }
  if (error instanceof ErrorPerfilesConexion) {
    return respuesta.code(error.statusCode).send({
      code: error.code,
      message: 'No fue posible utilizar el perfil autorizado.',
    });
  }
  if (error instanceof ErrorInsercionRf1) {
    return respuesta.code(error.statusCode).send({
      code: error.code,
      message: traducirErrorInsercionRf1(error.code),
    });
  }
  if (error instanceof ErrorCargaVistaPrevia) {
    return respuesta
      .code(error.statusCode)
      .send({ code: error.code, message: mensajeCarga(error) });
  }

  solicitud.log.error(
    { requestId: solicitud.id, code: 'RF1_PREVIEW_ROUTE_FAILURE' },
    'Fallo controlado de la ruta de vista previa RF-1.',
  );
  return respuesta.code(500).send({
    code: 'INTERNAL_ERROR',
    message: 'No fue posible procesar la vista previa.',
  });
}

/**
 * Traduce errores de inserción a mensajes estables sin contenido fiscal ni de conexión.
 * @param codigo Código de dominio acotado producido por el servicio de inserción.
 * @returns Texto en español apto para respuesta HTTP y presentación al operador.
 */
function traducirErrorInsercionRf1(codigo: ErrorInsercionRf1['code']): string {
  switch (codigo) {
    case 'RF1_INSERTION_DISABLED':
      return 'La inserción RF-1 permanece deshabilitada por la política del servidor.';
    case 'RF1_CONFIRMATION_INVALID':
      return 'La vista previa cambió o la confirmación ya venció; genera una nueva vista previa.';
    case 'RF1_PREVIEW_NOT_READY':
      return 'La vista previa contiene facturas que requieren corrección antes de confirmar.';
    case 'RF1_CONNECTION_FAILED':
      return 'No fue posible abrir el perfil autorizado; no se ejecutó la inserción.';
  }
}

/** Error local de carga cuyo código y estado no retienen contenido del archivo. */
class ErrorCargaVistaPrevia extends Error {
  /** Construye un error de entrada con respuesta estable y sin conservar bytes de XML. */
  public constructor(
    public readonly code:
      | 'BATCH_EMPTY'
      | 'BATCH_TOO_LARGE'
      | 'FILE_TOO_LARGE'
      | 'MULTIPART_FIELD_INVALID'
      | 'MULTIPART_SELECTION_INVALID'
      | 'MULTIPART_INVALID'
      | 'MULTIPART_REQUIRED'
      | 'REQUEST_ABORTED'
      | 'UPLOAD_LIMIT_EXCEEDED',
    public readonly statusCode: 400 | 408 | 413 | 415,
  ) {
    super(code);
    this.name = 'ErrorCargaVistaPrevia';
  }
}

/** Devuelve un código de error del plugin sin inspeccionar su mensaje o propiedades sensibles. */
function obtenerCodigo(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

/** Traduce códigos de carga a mensajes cortos en español sin repetir nombres de archivo. */
function mensajeCarga(error: ErrorCargaVistaPrevia): string {
  switch (error.code) {
    case 'BATCH_EMPTY':
      return 'Debe adjuntarse al menos un archivo XML.';
    case 'BATCH_TOO_LARGE':
    case 'FILE_TOO_LARGE':
    case 'UPLOAD_LIMIT_EXCEEDED':
      return 'El lote supera los límites de archivos o tamaño permitidos.';
    case 'MULTIPART_REQUIRED':
      return 'La solicitud debe contener archivos multipart/form-data.';
    case 'REQUEST_ABORTED':
      return 'La solicitud fue cancelada antes de terminar.';
    case 'MULTIPART_FIELD_INVALID':
    case 'MULTIPART_SELECTION_INVALID':
    case 'MULTIPART_INVALID':
      return 'El cuerpo multipart no tiene el formato permitido.';
  }
}
