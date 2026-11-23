import {
  accesoClienteAdminSchema,
  listaAmbientesSapClienteAdminSchema,
  listaClientesAccesiblesSchema,
  listaPerfilesConexionAccesiblesSchema,
  type CapacidadClienteContrato,
  type AmbienteSapClienteAdminContrato,
  type AccesoClienteAdminContrato,
  type ClienteAccesibleContrato,
} from '@portal-soporte/contracts/clients';
import type { Static } from '@sinclair/typebox';
import {
  ErrorApiClientes,
  obtenerTokenCsrf,
  solicitarApi,
  traducirErrorHttp,
} from './client-admin-api.ts';

/** Métodos HTTP permitidos para concesiones, revocaciones y capacidades de RF-1. */
type MetodoMutacionAcceso = 'PUT' | 'DELETE';

/** Tipo de perfil de conexión visible para una operación autorizada. */
export type PerfilConexionAccesibleContrato = Static<
  typeof import('@portal-soporte/contracts/clients').perfilConexionAccesibleSchema
>;

/**
 * Recupera los clientes permitidos por la sesión y sus capacidades vigentes.
 *
 * @returns Clientes redactados que la sesión puede seleccionar.
 * @throws ErrorApiClientes si la sesión perdió acceso o la respuesta no cumple el contrato.
 */
export function listarClientesAutorizados(): Promise<readonly ClienteAccesibleContrato[]> {
  return solicitarApi('/api/v1/clients', listaClientesAccesiblesSchema);
}

/**
 * Recupera ambientes SAP solo cuando el servidor confirma acceso vigente al cliente.
 *
 * @param clientId - UUID del cliente seleccionado en la sesión autenticada.
 * @returns Ambientes redactados que pertenecen al cliente solicitado.
 * @throws ErrorApiClientes si se revocó el acceso o la respuesta no cumple el contrato.
 */
export function listarAmbientesSapCliente(
  clientId: string,
): Promise<readonly AmbienteSapClienteAdminContrato[]> {
  return solicitarApi(
    `/api/v1/clients/${encodeURIComponent(clientId)}/sap-environments`,
    listaAmbientesSapClienteAdminSchema,
  );
}

/**
 * Recupera perfiles utilizables sin exponer destinos, usuarios ni material secreto.
 *
 * @param clientId - UUID del cliente seleccionado en la sesión autenticada.
 * @returns Perfiles accesibles limitados a identificador y entorno lógico.
 * @throws ErrorApiClientes si se revocó el acceso o la respuesta contiene campos extra.
 */
export function listarPerfilesConexionCliente(
  clientId: string,
): Promise<readonly PerfilConexionAccesibleContrato[]> {
  return solicitarApi(
    `/api/v1/clients/${encodeURIComponent(clientId)}/connection-profiles`,
    listaPerfilesConexionAccesiblesSchema,
  );
}

/**
 * Obtiene asignaciones y capacidades redactadas para el panel administrativo de un cliente.
 *
 * @param clientId - UUID del cliente visible en la pantalla de administración.
 * @returns Asignaciones y capacidades actuales sin secretos ni correos.
 * @throws ErrorApiClientes si ADMIN no tiene permiso o el contrato de salida es inválido.
 */
export function listarAsignacionesCliente(clientId: string): Promise<AccesoClienteAdminContrato> {
  return solicitarApi(
    `/api/v1/admin/clients/${encodeURIComponent(clientId)}/access`,
    accesoClienteAdminSchema,
  );
}

/**
 * Concede acceso a una cuenta SUPPORT mediante una operación autenticada y auditable.
 *
 * @param clientId - UUID del cliente al que se asignará acceso.
 * @param userId - UUID de la cuenta SUPPORT seleccionada por ADMIN.
 * @returns Promesa que termina cuando el backend confirma la concesión.
 * @throws ErrorApiClientes si falla CSRF, autorización o persistencia.
 */
export function concederAccesoCliente(clientId: string, userId: string): Promise<void> {
  return enviarMutacionAcceso(
    `/api/v1/admin/clients/${encodeURIComponent(clientId)}/access/users/${encodeURIComponent(userId)}`,
    'PUT',
  );
}

/**
 * Revoca el acceso del usuario al cliente sin alterar otras asignaciones.
 *
 * @param clientId - UUID del cliente cuya asignación se revoca.
 * @param userId - UUID de la cuenta SUPPORT afectada.
 * @returns Promesa que termina cuando el backend confirma la revocación.
 * @throws ErrorApiClientes si falla CSRF, autorización o persistencia.
 */
export function revocarAccesoCliente(clientId: string, userId: string): Promise<void> {
  return enviarMutacionAcceso(
    `/api/v1/admin/clients/${encodeURIComponent(clientId)}/access/users/${encodeURIComponent(userId)}`,
    'DELETE',
  );
}

/**
 * Cambia la capacidad allowlisted del cliente; el gate global sigue siendo independiente.
 *
 * @param clientId - UUID del cliente administrado.
 * @param capacidad - Capacidad allowlisted, restringida aquí a lectura RF-1.
 * @param enabled - Nuevo estado explícito para las vistas previas.
 * @returns Promesa que termina al persistir el cambio auditado.
 * @throws ErrorApiClientes si el backend rechaza la mutación o la respuesta CSRF.
 */
export function establecerCapacidadCliente(
  clientId: string,
  capacidad: CapacidadClienteContrato,
  enabled: boolean,
): Promise<void> {
  if (capacidad !== 'rf-1:read' && capacidad !== 'rf-1:execute') {
    throw new ErrorApiClientes('CAPABILITY_UNAVAILABLE', 403);
  }
  return enviarMutacionAcceso(
    `/api/v1/admin/clients/${encodeURIComponent(clientId)}/capabilities/${encodeURIComponent(capacidad)}`,
    'PUT',
    { enabled },
  );
}

/**
 * Ejecuta una mutación de acceso con CSRF y espera la respuesta vacía del contrato API.
 *
 * @param ruta - Ruta relativa de acceso administrativo same-origin.
 * @param metodo - Método permitido para la mutación solicitada.
 * @param cuerpo - Estado de capacidad opcional; las asignaciones no reciben cuerpo.
 * @returns Promesa que se completa únicamente ante la respuesta HTTP 204.
 * @throws ErrorApiClientes si falla red, CSRF, autorización o estado de respuesta.
 */
async function enviarMutacionAcceso(
  ruta: string,
  metodo: MetodoMutacionAcceso,
  cuerpo?: { readonly enabled: boolean },
): Promise<void> {
  const tokenCsrf = await obtenerTokenCsrf();
  const encabezados: Record<string, string> = { 'x-csrf-token': tokenCsrf };
  if (cuerpo !== undefined) {
    encabezados['content-type'] = 'application/json';
  }

  const respuesta = await fetch(ruta, {
    method: metodo,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: encabezados,
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  }).catch(() => {
    throw new ErrorApiClientes('NETWORK_ERROR', 0);
  });

  if (respuesta.status !== 204) {
    throw await traducirErrorHttp(respuesta);
  }
}
