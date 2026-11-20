/** Temas de apariencia permitidos para una cuenta del Portal de Soporte. */
export type TemaPreferenciaUsuario = 'system' | 'light' | 'dark';

/** Preferencias personales que el núcleo permite consultar y actualizar. */
export interface PreferenciasUsuario {
  /** Tema elegido o valor system cuando la cuenta conserva el comportamiento del dispositivo. */
  readonly theme: TemaPreferenciaUsuario;
}
