/** Tipos de conexión externa que un módulo puede declarar en su manifest. */
export type SupportedConnectionType = 'MYSQL_TCP' | 'MYSQL_URL' | 'MYSQL_SSH' | 'SSH_SERVER';

/** Estados permitidos para describir la salud de un módulo registrado. */
export type ModuleHealth = 'ready' | 'degraded' | 'disabled';

/**
 * Describe un módulo incluido en el build y sus requisitos públicos de ejecución.
 *
 * El manifest no activa el módulo ni concede permisos; el catálogo y el backend aplican esas
 * decisiones en tiempo de ejecución.
 */
export interface ModuleManifest {
  /** Identificador técnico estable del módulo. */
  readonly id: string;
  /** Versión del contrato del módulo. */
  readonly version: string;
  /** Nombre legible para el catálogo administrativo. */
  readonly displayName: string;
  /** Ruta que el frontend utilizará si el módulo está habilitado. */
  readonly route: string;
  /** Capacidades que debe autorizar el backend para operar el módulo. */
  readonly requiredCapabilities: readonly string[];
  /** Tipos de conexión externos que el módulo puede solicitar al broker. */
  readonly supportedConnectionTypes: readonly SupportedConnectionType[];
  /** Acciones de backend que el módulo declara al catálogo central. */
  readonly backendActions: readonly string[];
  /** Valor literal falso para impedir visibilidad implícita al registrar módulos. */
  readonly visibilityDefault: false;
  /** Flags de producto que requieren activación explícita. */
  readonly featureFlags: readonly string[];
  /** Versión mínima del núcleo compatible con el módulo. */
  readonly minimumCoreVersion: string;
  /** Estado de salud comunicado por el módulo. */
  readonly health: ModuleHealth;
}
