import { Value } from '@sinclair/typebox/value';
import type { Static, TSchema } from '@sinclair/typebox';
import {
  ambienteSapClienteAdminSchema,
  clienteAdminSchema,
  errorClienteAdminSchema,
  listaPerfilesConexionAdminSchema,
  listaAmbientesSapClienteAdminSchema,
  listaClientesAdminSchema,
  perfilConexionAdminSchema,
  resultadoPruebaPerfilAdminSchema,
  type AmbienteSapClienteAdminContrato,
  type ClienteAdminContrato,
  type PerfilConexionAdminContrato,
  type ResultadoPruebaPerfilAdminContrato,
  type SolicitudActualizarAmbienteSapClienteAdmin,
  type SolicitudActualizarClienteAdmin,
  type SolicitudActualizarPerfilConexionAdmin,
  type SolicitudCrearAmbienteSapClienteAdmin,
  type SolicitudCrearClienteAdmin,
  type SolicitudCrearPerfilConexionAdmin,
  type SolicitudReemplazarCredencialesPerfilAdmin,
} from '@portal-soporte/contracts/clients';
import { csrfResponseSchema } from '@portal-soporte/contracts/auth';

type MetodoEscrituraCliente = 'POST' | 'PATCH' | 'PUT';

const MENSAJES_CLIENTES: Readonly<Record<string, string>> = {
  AUTH_REQUIRED: 'Tu sesión terminó. Inicia sesión de nuevo.',
  CLIENT_NAME_INVALID: 'El nombre del cliente debe tener entre 2 y 120 caracteres.',
  CLIENT_NOT_FOUND: 'No se encontró el cliente solicitado.',
  FORBIDDEN: 'No tienes permiso para administrar clientes.',
  INVALID_REQUEST: 'Revisa los datos del formulario.',
  NETWORK_ERROR: 'No fue posible conectar con el Portal. Inténtalo de nuevo.',
  SAP_ENVIRONMENT_CODE_INVALID: 'El código del ambiente usa caracteres no permitidos.',
  SAP_ENVIRONMENT_DUPLICATE: 'Ese código ya existe en el cliente.',
  SAP_ENVIRONMENT_NAME_INVALID: 'El nombre del ambiente debe tener entre 2 y 120 caracteres.',
  SAP_ENVIRONMENT_NOT_FOUND: 'No se encontró el ambiente SAP solicitado para ese cliente.',
  DESTINATION_NOT_ALLOWED:
    'El perfil no tiene un destino completo o no está disponible para esta operación.',
  DESTINATION_INVALID: 'Revisa el hostname, puerto y fingerprint SSH del destino.',
  MYSQL_CONNECTION_FAILED:
    'No fue posible conectar con MySQL. Revisa la configuración sin compartir sus secretos.',
  MYSQL_AUTHENTICATION_FAILED: 'MySQL rechazó las credenciales configuradas.',
  MYSQL_TLS_FAILED: 'No se pudo validar la conexión TLS de MySQL.',
  SSH_CONNECTION_FAILED: 'No fue posible abrir el túnel SSH autorizado.',
  SSH_HOST_KEY_REJECTED: 'La huella del servidor SSH no coincide con la autorizada.',
  CONNECTION_TIMEOUT: 'La prueba de conexión excedió el tiempo permitido.',
  CONNECTOR_BUSY: 'Hay otra prueba en curso. Inténtalo nuevamente en unos momentos.',
  INVALID_CREDENTIALS: 'Las credenciales o llaves no tienen un formato compatible.',
  SECRET_CUSTODY_DISABLED:
    'La custodia segura todavía no está configurada; no se guardó la credencial.',
  SECRET_PACKAGE_TOO_LARGE: 'El material de conexión excede el tamaño permitido.',
  SECRET_CUSTODY_UNAVAILABLE: 'La custodia segura no está disponible. No se abrió una conexión.',
  SECRET_PACKAGE_INVALID: 'No fue posible validar el material cifrado del perfil.',
  PROFILE_CONFIGURATION_INVALID: 'La ruta SSH o los certificados TLS no son coherentes.',
  RF1_INSERTION_DISABLED: 'La inserción de facturas está bloqueada por la política del Portal.',
  RF1_CONFIRMATION_INVALID:
    'La vista previa cambió o venció. Genera una nueva vista previa antes de confirmar.',
  RF1_PREVIEW_NOT_READY:
    'Corrige los bloqueos y vuelve a revisar la vista previa antes de insertar.',
  PROFILE_DUPLICATE: 'Ya existe un perfil con ese nombre para este cliente.',
  PROFILE_NOT_FOUND: 'No se encontró el perfil de conexión.',
  PROFILE_NAME_INVALID: 'El nombre del perfil debe tener entre 2 y 120 caracteres.',
};

/** Error HTTP localizado sin conservar el cuerpo o la causa remota de la respuesta. */
export class ErrorApiClientes extends Error {
  /**
   * Crea un error estable para reglas de presentación y reintento.
   *
   * @param code - Código público estable sin datos internos del servidor.
   * @param status - Estado HTTP observado o cero si falló la red.
   */
  public constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(MENSAJES_CLIENTES[code] ?? 'No fue posible completar la solicitud.');
    this.name = 'ErrorApiClientes';
  }
}

/** Recupera la lista de clientes permitida por el contrato administrativo. */
export function listarClientesAdmin(): Promise<readonly ClienteAdminContrato[]> {
  return solicitarApi('/api/v1/admin/clients', listaClientesAdminSchema);
}

/** Crea un cliente mediante una mutación same-origin protegida con CSRF. */
export function crearClienteAdmin(
  solicitud: SolicitudCrearClienteAdmin,
): Promise<ClienteAdminContrato> {
  return enviarJson('/api/v1/admin/clients', solicitud, 'POST', 201, clienteAdminSchema);
}

/** Actualiza nombre o estado lógico del cliente seleccionado. */
export function actualizarClienteAdmin(
  clientId: string,
  solicitud: SolicitudActualizarClienteAdmin,
): Promise<ClienteAdminContrato> {
  return enviarJson(
    `/api/v1/admin/clients/${encodeURIComponent(clientId)}`,
    solicitud,
    'PATCH',
    200,
    clienteAdminSchema,
  );
}

/** Lista los ambientes SAP asociados al cliente, sin perfiles de conexión. */
export function listarAmbientesSapAdmin(
  clientId: string,
): Promise<readonly AmbienteSapClienteAdminContrato[]> {
  return solicitarApi(
    `/api/v1/admin/clients/${encodeURIComponent(clientId)}/sap-environments`,
    listaAmbientesSapClienteAdminSchema,
  );
}

/** Registra un ambiente SAP sin guardar valores de conexión o secretos. */
export function crearAmbienteSapAdmin(
  clientId: string,
  solicitud: SolicitudCrearAmbienteSapClienteAdmin,
): Promise<AmbienteSapClienteAdminContrato> {
  return enviarJson(
    `/api/v1/admin/clients/${encodeURIComponent(clientId)}/sap-environments`,
    solicitud,
    'POST',
    201,
    ambienteSapClienteAdminSchema,
  );
}

/** Cambia datos o estado de un ambiente SAP en su cliente propietario. */
export function actualizarAmbienteSapAdmin(
  clientId: string,
  environmentId: string,
  solicitud: SolicitudActualizarAmbienteSapClienteAdmin,
): Promise<AmbienteSapClienteAdminContrato> {
  return enviarJson(
    `/api/v1/admin/clients/${encodeURIComponent(clientId)}/sap-environments/${encodeURIComponent(environmentId)}`,
    solicitud,
    'PATCH',
    200,
    ambienteSapClienteAdminSchema,
  );
}

/** Lista perfiles de conexión por cliente y valida que la respuesta no contenga secretos. */
export function listarPerfilesConexionAdmin(
  clientId: string,
): Promise<readonly PerfilConexionAdminContrato[]> {
  return solicitarApi(
    `/api/v1/admin/clients/${encodeURIComponent(clientId)}/connection-profiles`,
    listaPerfilesConexionAdminSchema,
  );
}

/** Crea un perfil enviando secretos solo en esta solicitud cifrada por HTTPS y CSRF. */
export function crearPerfilConexionAdmin(
  clientId: string,
  solicitud: SolicitudCrearPerfilConexionAdmin,
): Promise<PerfilConexionAdminContrato> {
  return enviarJson(
    `/api/v1/admin/clients/${encodeURIComponent(clientId)}/connection-profiles`,
    solicitud,
    'POST',
    201,
    perfilConexionAdminSchema,
  );
}

/** Actualiza metadatos o estado lógico sin recuperar credenciales existentes. */
export function actualizarPerfilConexionAdmin(
  clientId: string,
  profileId: string,
  solicitud: SolicitudActualizarPerfilConexionAdmin,
): Promise<PerfilConexionAdminContrato> {
  return enviarJson(
    `/api/v1/admin/clients/${encodeURIComponent(clientId)}/connection-profiles/${encodeURIComponent(profileId)}`,
    solicitud,
    'PATCH',
    200,
    perfilConexionAdminSchema,
  );
}

/** Reemplaza credenciales sin consultar ni rellenar el material previamente guardado. */
export function reemplazarCredencialesPerfilAdmin(
  clientId: string,
  profileId: string,
  solicitud: SolicitudReemplazarCredencialesPerfilAdmin,
): Promise<PerfilConexionAdminContrato> {
  return enviarJson(
    `/api/v1/admin/clients/${encodeURIComponent(clientId)}/connection-profiles/${encodeURIComponent(profileId)}/credentials`,
    solicitud,
    'PUT',
    200,
    perfilConexionAdminSchema,
  );
}

/** Solicita una prueba de conectividad de solo lectura sin enviar SQL o secretos al navegador. */
export function probarPerfilConexionAdmin(
  clientId: string,
  profileId: string,
): Promise<ResultadoPruebaPerfilAdminContrato> {
  return enviarJson(
    `/api/v1/admin/clients/${encodeURIComponent(clientId)}/connection-profiles/${encodeURIComponent(profileId)}/test`,
    undefined,
    'POST',
    200,
    resultadoPruebaPerfilAdminSchema,
  );
}

/**
 * Ejecuta un GET same-origin y valida la respuesta antes de entregarla a React.
 *
 * @param ruta - Ruta relativa al mismo origen; nunca recibe una URL de destino externo.
 * @param esquema - Contrato TypeBox que limita los campos aceptados.
 * @returns Respuesta validada según el esquema solicitado.
 * @throws ErrorApiClientes si falla la red, el estado HTTP o la validación de salida.
 */
export async function solicitarApi<TEsquema extends TSchema>(
  ruta: string,
  esquema: TEsquema,
): Promise<Static<TEsquema>> {
  const respuesta = await fetch(ruta, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  }).catch(() => {
    throw new ErrorApiClientes('NETWORK_ERROR', 0);
  });

  return leerRespuesta(respuesta, esquema);
}

/** Ejecuta la escritura con token CSRF de un solo uso y valida su contrato de salida. */
async function enviarJson<TEsquema extends TSchema, TCuerpo>(
  ruta: string,
  cuerpo: TCuerpo,
  metodo: MetodoEscrituraCliente,
  estadoEsperado: 200 | 201,
  esquema: TEsquema,
): Promise<Static<TEsquema>> {
  const tokenCsrf = await obtenerTokenCsrf();
  const respuesta = await fetch(ruta, {
    method: metodo,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-csrf-token': tokenCsrf },
    body: JSON.stringify(cuerpo),
  }).catch(() => {
    throw new ErrorApiClientes('NETWORK_ERROR', 0);
  });
  if (respuesta.status !== estadoEsperado) {
    throw await traducirErrorHttp(respuesta);
  }

  return leerRespuesta(respuesta, esquema);
}

/**
 * Obtiene el CSRF efímero antes de cada mutación y descarta fallos de respuesta.
 *
 * @returns Token de doble envío que vive solo en memoria del cliente web.
 * @throws ErrorApiClientes si el endpoint CSRF no está disponible o incumple su contrato.
 */
export async function obtenerTokenCsrf(): Promise<string> {
  const respuesta = await fetch('/api/v1/auth/csrf', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  }).catch(() => {
    throw new ErrorApiClientes('CSRF_UNAVAILABLE', 0);
  });

  return (await leerRespuesta(respuesta, csrfResponseSchema)).token;
}

/**
 * Valida JSON de éxito contra el contrato TypeBox indicado.
 *
 * @param respuesta - Respuesta HTTP same-origin recibida.
 * @param esquema - Contrato que limita los datos entregados a la aplicación.
 * @returns Objeto validado en tiempo de ejecución y tipado por el esquema.
 * @throws ErrorApiClientes ante estado no exitoso, JSON inválido o campos inesperados.
 */
export async function leerRespuesta<TEsquema extends TSchema>(
  respuesta: Response,
  esquema: TEsquema,
): Promise<Static<TEsquema>> {
  if (!respuesta.ok) {
    throw await traducirErrorHttp(respuesta);
  }

  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    throw new ErrorApiClientes('INVALID_RESPONSE', 502);
  }
  if (!Value.Check(esquema, cuerpo)) {
    throw new ErrorApiClientes('INVALID_RESPONSE', 502);
  }

  return cuerpo;
}

/**
 * Traduce el error utilizando solo su código público, nunca el texto arbitrario del servidor.
 *
 * @param respuesta - Respuesta HTTP no exitosa que contiene un código público opcional.
 * @returns Error localizado sin conservar el mensaje o cuerpo remoto.
 */
export async function traducirErrorHttp(respuesta: Response): Promise<ErrorApiClientes> {
  let codigo = 'REQUEST_FAILED';
  try {
    const cuerpo: unknown = await respuesta.json();
    if (Value.Check(errorClienteAdminSchema, cuerpo)) {
      codigo = cuerpo.code;
    }
  } catch {
    codigo = 'REQUEST_FAILED';
  }

  return new ErrorApiClientes(codigo, respuesta.status);
}
