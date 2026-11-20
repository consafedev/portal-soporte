import type { PreferenciasUsuario, TemaPreferenciaUsuario } from './models.js';
import type { RepositorioPreferenciasUsuario } from './ports.js';

/** Ejecuta los casos de uso de lectura y actualización del tema de la propia cuenta. */
export class ServicioPreferenciasUsuario {
  /**
   * Construye el servicio con el puerto de preferencias del usuario autenticado.
   *
   * @param repositorio - Puerto de persistencia acotado a preferencias del Portal.
   */
  public constructor(private readonly repositorio: RepositorioPreferenciasUsuario) {}

  /**
   * Devuelve el tema guardado de una cuenta activa.
   *
   * @param idUsuario - Identificador derivado del contexto autenticado del servidor.
   * @returns Preferencia pública o `null` si la cuenta dejó de estar disponible.
   * @throws Propaga fallos del puerto de persistencia para el manejador común de errores.
   */
  public async obtener(idUsuario: string): Promise<PreferenciasUsuario | null> {
    const tema = await this.repositorio.obtenerTemaPreferido(idUsuario);

    return tema === null ? null : { theme: tema };
  }

  /**
   * Actualiza el tema de una cuenta sin aceptar un identificador del cliente.
   *
   * @param idUsuario - Identificador derivado del contexto autenticado del servidor.
   * @param tema - Valor de tema cerrado validado por el contrato HTTP.
   * @returns Preferencia confirmada o `null` si la cuenta dejó de estar disponible.
   * @throws Propaga fallos del puerto de persistencia para el manejador común de errores.
   */
  public async actualizar(
    idUsuario: string,
    tema: TemaPreferenciaUsuario,
  ): Promise<PreferenciasUsuario | null> {
    const actualizada = await this.repositorio.actualizarTemaPreferido(idUsuario, tema);

    return actualizada ? { theme: tema } : null;
  }
}
