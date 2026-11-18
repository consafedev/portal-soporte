/** Exporta configuración y construcción de Fastify sin abrir sockets al importar el módulo. */
export { cargarConfiguracionAuth } from './config.js';
export { crearServidorAuth } from './server.js';
export type { DependenciasServidorAuth } from './server.js';
