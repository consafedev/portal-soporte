/** Exporta configuración y construcción de Fastify sin abrir sockets al importar el módulo. */
export { cargarConfiguracionAuth } from './config.js';
export {
  cargarConfiguracionEscuchaApi,
  cargarConfiguracionMigracionPrueba,
} from './runtime-config.js';
export { crearRuntimeAuth } from './runtime.js';
export { crearServidorAuth } from './server.js';
export type { RuntimeAuth } from './runtime.js';
export type { DependenciasServidorAuth } from './server.js';
