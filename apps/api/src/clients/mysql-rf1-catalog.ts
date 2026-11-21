import type {
  CatalogoLecturaRf1,
  SociedadCatalogoRf1,
} from '../../../../modules/rf-1/src/preview.js';
import type { SesionLecturaRf1 } from '../../../../packages/core/src/clients/secret-custody-ports.js';

/** Adapta la sesión limitada del broker al puerto de catálogo del dominio RF-1. */
export class CatalogoLecturaRf1DesdeBroker implements CatalogoLecturaRf1 {
  /**
   * Conserva una referencia a la sesión de vida corta abierta por el servicio de perfiles.
   * @param sesion Sesión de lecturas limitadas del broker.
   */
  public constructor(private readonly sesion: SesionLecturaRf1) {}

  /**
   * Delega la búsqueda limitada de sociedades al broker autorizado.
   * @param rfcReceptor RFC receptor que se consultará.
   * @returns Sociedades disponibles en el catálogo elegido.
   */
  public buscarSociedadesPorRfc(rfcReceptor: string): Promise<readonly SociedadCatalogoRf1[]> {
    return this.sesion.buscarSociedadesPorRfc(rfcReceptor);
  }

  /**
   * Delega la búsqueda contextual limitada de proveedores al broker autorizado.
   * @param rfcEmisor RFC emisor leído del CFDI.
   * @param sociedad Sociedad SAP seleccionada.
   * @param ambienteSap Ambiente vinculado a la sociedad.
   * @returns Proveedores compatibles con el contexto solicitado.
   */
  public buscarProveedoresPorContexto(
    rfcEmisor: string,
    sociedad: string,
    ambienteSap: string,
  ): Promise<readonly { readonly idProveedor: string }[]> {
    return this.sesion.buscarProveedoresPorContexto(rfcEmisor, sociedad, ambienteSap);
  }

  /**
   * Delega la comprobación de UUID sin devolver filas de facturas.
   * @param uuid UUID fiscal que se comprobará.
   * @returns Si la factura ya existe.
   */
  public existeUuid(uuid: string): Promise<boolean> {
    return this.sesion.existeUuid(uuid);
  }
}
