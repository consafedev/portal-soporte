import {
  respuestaVistaPreviaRf1Schema,
  resultadosInsercionRf1Schema,
  type EstatusVistaPreviaRf1Contrato,
  type DocumentosFacturaRf1Contrato,
  type RespuestaVistaPreviaRf1Contrato,
  type ResultadosInsercionRf1Contrato,
  type SeleccionSociedadArchivoRf1Contrato,
} from '@portal-soporte/contracts/clients';
import { ErrorApiClientes, leerRespuesta, obtenerTokenCsrf } from './client-admin-api.ts';

/**
 * Envía CFDI en memoria al endpoint same-origin y valida resultados sin aceptar secretos.
 *
 * @param clientId - UUID del cliente seleccionado; el servidor vuelve a comprobar su permiso.
 * @param profileId - UUID del perfil permitido dentro del cliente indicado.
 * @param estatus - Estado funcional cerrado para la vista previa, sin habilitar inserciones.
 * @param files - Archivos seleccionados; se envían como multipart sin guardarlos en disco.
 * @param seleccionesSociedad - Pares elegidos de las opciones reales recibidas para cada archivo.
 * @param documentos - Valores opcionales existentes ligados al índice de cada CFDI.
 * @returns Resultados redactados y un token opaco opcional emitido solo cuando hay permiso.
 * @throws ErrorApiClientes si falla CSRF, red, autorización o validación de la respuesta.
 */
export async function previsualizarRf1(
  clientId: string,
  profileId: string,
  estatus: EstatusVistaPreviaRf1Contrato,
  files: readonly File[],
  seleccionesSociedad: readonly SeleccionSociedadArchivoRf1Contrato[] = [],
  documentos: readonly DocumentosFacturaRf1Contrato[] = [],
): Promise<RespuestaVistaPreviaRf1Contrato> {
  const tokenCsrf = await obtenerTokenCsrf();
  const formulario = new FormData();
  for (const archivo of files) {
    formulario.append('files', archivo);
  }
  if (seleccionesSociedad.length > 0) {
    formulario.append('seleccionesSociedad', JSON.stringify(seleccionesSociedad));
  }
  if (documentos.length > 0) {
    formulario.append('documentos', JSON.stringify(documentos));
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

  return leerRespuesta(respuesta, respuestaVistaPreviaRf1Schema);
}

/**
 * Ejecuta el lote ya revisado con CSRF y token ligado al mismo actor, cliente y contenido.
 * @param clientId Cliente que el backend vuelve a autorizar para cada escritura.
 * @param profileId Perfil activo perteneciente al cliente seleccionado.
 * @param estatus Estado fiscal solicitado para cada factura.
 * @param files Mismos archivos originales conservados en memoria desde el preview.
 * @param confirmationToken Token efímero de un solo uso emitido por el preview.
 * @param seleccionesSociedad Pares explícitos elegidos en el catálogo de ese perfil.
 * @param documentos Campos opcionales que deben coincidir con los validados en preview.
 * @returns Estado individual de cada factura sin mensajes de base de datos.
 * @throws ErrorApiClientes si CSRF, autorización, red o contrato de respuesta falla.
 */
export async function ejecutarRf1(
  clientId: string,
  profileId: string,
  estatus: EstatusVistaPreviaRf1Contrato,
  files: readonly File[],
  confirmationToken: string,
  seleccionesSociedad: readonly SeleccionSociedadArchivoRf1Contrato[] = [],
  documentos: readonly DocumentosFacturaRf1Contrato[] = [],
): Promise<ResultadosInsercionRf1Contrato> {
  const tokenCsrf = await obtenerTokenCsrf();
  const formulario = crearFormulario(files, seleccionesSociedad, documentos);
  formulario.append('confirmationToken', confirmationToken);
  const parametros = new URLSearchParams({ profileId, estatus });
  const ruta = `/api/v1/clients/${encodeURIComponent(clientId)}/modules/rf-1/execute?${parametros.toString()}`;
  const respuesta = await fetch(ruta, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'x-csrf-token': tokenCsrf },
    body: formulario,
  }).catch(() => {
    throw new ErrorApiClientes('NETWORK_ERROR', 0);
  });

  return leerRespuesta(respuesta, resultadosInsercionRf1Schema);
}

/** Serializa archivos, selecciones y referencias opcionales sin alterar el XML original. */
function crearFormulario(
  files: readonly File[],
  seleccionesSociedad: readonly SeleccionSociedadArchivoRf1Contrato[],
  documentos: readonly DocumentosFacturaRf1Contrato[],
): FormData {
  const formulario = new FormData();
  for (const archivo of files) {
    formulario.append('files', archivo);
  }
  if (seleccionesSociedad.length > 0) {
    formulario.append('seleccionesSociedad', JSON.stringify(seleccionesSociedad));
  }
  if (documentos.length > 0) {
    formulario.append('documentos', JSON.stringify(documentos));
  }
  return formulario;
}
