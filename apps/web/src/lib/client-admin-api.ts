import { Value } from '@sinclair/typebox/value';
import type { Static, TSchema } from '@sinclair/typebox';
import {
  ambienteSapClienteAdminSchema,
  clienteAdminSchema,
  errorClienteAdminSchema,
  listaAmbientesSapClienteAdminSchema,
  listaClientesAdminSchema,
  type AmbienteSapClienteAdminContrato,
  type ClienteAdminContrato,
  type SolicitudActualizarAmbienteSapClienteAdmin,
  type SolicitudActualizarClienteAdmin,
  type SolicitudCrearAmbienteSapClienteAdmin,
  type SolicitudCrearClienteAdmin,
} from '@portal-soporte/contracts/clients';
import { csrfResponseSchema } from '@portal-soporte/contracts/auth';

type MetodoEscrituraCliente = 'POST' | 'PATCH';

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
};

/** Error administrativo localizado sin conservar el cuerpo o causa de la respuesta HTTP. */
export class ErrorApiClientes extends Error {
  /** Crea un error estable para reglas de presentación y reintento. */
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

/** Ejecuta un GET same-origin y valida la respuesta antes de entregarla a React. */
async function solicitarApi<TEsquema extends TSchema>(
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

/** Obtiene el CSRF efímero antes de cada mutación y descarta fallos de respuesta. */
async function obtenerTokenCsrf(): Promise<string> {
  const respuesta = await fetch('/api/v1/auth/csrf', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  }).catch(() => {
    throw new ErrorApiClientes('CSRF_UNAVAILABLE', 0);
  });

  return (await leerRespuesta(respuesta, csrfResponseSchema)).token;
}

/** Valida JSON de éxito contra el contrato TypeBox indicado. */
async function leerRespuesta<TEsquema extends TSchema>(
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

/** Traduce el error utilizando solo su código público, nunca el texto arbitrario del servidor. */
async function traducirErrorHttp(respuesta: Response): Promise<ErrorApiClientes> {
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
