import {
  accesoClienteAdminSchema,
  listaClientesAccesiblesSchema,
  type CapacidadClienteContrato,
  type AccesoClienteAdminContrato,
  type ClienteAccesibleContrato,
} from '@portal-soporte/contracts/clients';
import {
  ErrorApiClientes,
  obtenerTokenCsrf,
  solicitarApi,
  traducirErrorHttp,
} from './client-admin-api.ts';

/** Métodos HTTP permitidos para concesiones, revocaciones y capacidad de lectura. */
type MetodoMutacionAcceso = 'PUT' | 'DELETE';

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
 * Cambia solo `rf-1:read`; la capacidad de ejecución no forma parte de esta interfaz.
 *
 * @param clientId - UUID del cliente administrado.
 * @param capacidad - Capacidad allowlisted, restringida aquí a lectura RF-1.
 * @param enabled - Nuevo estado explícito para las vistas previas.
 * @returns Promesa que termina al persistir el cambio auditado.
 * @throws ErrorApiClientes si se pide `rf-1:execute` o el backend rechaza la mutación.
 */
export function establecerCapacidadCliente(
  clientId: string,
  capacidad: CapacidadClienteContrato,
  enabled: boolean,
): Promise<void> {
  if (capacidad !== 'rf-1:read') {
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
