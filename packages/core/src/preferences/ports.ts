import type { TemaPreferenciaUsuario } from './models.js';

/** Persistencia acotada a las preferencias de la cuenta autenticada. */
export interface RepositorioPreferenciasUsuario {
  /**
   * Lee el tema de una cuenta activa.
   *
   * @param idUsuario - Identificador interno obtenido por el servidor.
   * @returns Tema permitido o `null` si la cuenta no está disponible.
   * @throws Fallos de persistencia que la capa HTTP convierte en error controlado.
   */
  obtenerTemaPreferido(idUsuario: string): Promise<TemaPreferenciaUsuario | null>;
  /**
   * Actualiza solo la cuenta indicada y comprueba su estado en la misma sentencia.
   *
   * @param idUsuario - Identificador interno obtenido por el servidor.
   * @param tema - Tema validado que se almacenará.
   * @returns `true` si una cuenta activa fue actualizada; `false` en otro caso.
   * @throws Fallos de persistencia que la capa HTTP convierte en error controlado.
   */
  actualizarTemaPreferido(idUsuario: string, tema: TemaPreferenciaUsuario): Promise<boolean>;
}
