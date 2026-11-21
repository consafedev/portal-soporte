import {
  resultadosVistaPreviaRf1Schema,
  type EstatusVistaPreviaRf1Contrato,
  type ResultadosVistaPreviaRf1Contrato,
} from '@portal-soporte/contracts/clients';
import { ErrorApiClientes, leerRespuesta, obtenerTokenCsrf } from './client-admin-api.js';

/**
 * Envía CFDI en memoria al endpoint same-origin y valida resultados sin aceptar secretos.
 *
 * @param clientId - UUID del cliente seleccionado; el servidor vuelve a comprobar su permiso.
 * @param profileId - UUID del perfil permitido dentro del cliente indicado.
 * @param estatus - Estado funcional cerrado para la vista previa, sin habilitar inserciones.
 * @param files - Archivos seleccionados; se envían como multipart sin guardarlos en disco.
 * @returns Resultados fiscales validados y redactados, uno por archivo recibido.
 * @throws ErrorApiClientes si falla CSRF, red, autorización o validación de la respuesta.
 */
export async function previsualizarRf1(
  clientId: string,
  profileId: string,
  estatus: EstatusVistaPreviaRf1Contrato,
  files: readonly File[],
): Promise<ResultadosVistaPreviaRf1Contrato> {
  const tokenCsrf = await obtenerTokenCsrf();
  const formulario = new FormData();
  for (const archivo of files) {
    formulario.append('files', archivo);
  }
  const parametros = new URLSearchParams({ profileId, estatus });
  const ruta = `/api/v1/clients/${encodeURIComponent(clientId)}/modules/rf-1/preview?${parametros.toString()}`;
  const respuesta = await fetch(ruta, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'x-csrf-token': tokenCsrf },
    body: formulario,
  }).catch(() => {
    throw new ErrorApiClientes('NETWORK_ERROR', 0);
  });

  return leerRespuesta(respuesta, resultadosVistaPreviaRf1Schema);
}
