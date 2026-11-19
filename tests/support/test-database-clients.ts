import { randomUUID } from 'node:crypto';
import { cargarConfiguracionConexionPrueba } from '../../apps/api/src/runtime-config.js';
import { crearClienteBaseDatosAuth, type BaseDatosAuth } from '../../apps/api/src/db/client.js';

/**
 * Crea un cliente migrador limitado a la base sintética validada por el harness.
 * @returns Cliente del rol migrador de pruebas o `null` si no hay DSN de integración.
 * @throws Error si la configuración apunta fuera de la base/rol de prueba permitidos.
 * @effects Abre un pool acotado al llamar al helper de cliente PostgreSQL.
 *
 */
export function crearClienteMigradorPruebas(): BaseDatosAuth | null {
  const entorno: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    TEST_DATABASE_ROLE: 'portal_test_migrator',
  };
  if (entorno['TEST_DATABASE_URL'] === undefined) {
    return null;
  }

  const configuracion = cargarConfiguracionConexionPrueba(entorno, 'portal_test_migrator');
  return crearClienteBaseDatosAuth({
    ...entorno,
    DATABASE_URL: configuracion.DATABASE_URL,
  });
}

/** Identifica de forma única las auditorías creadas por una suite de integración. */
export interface IdentificadoresSolicitudPrueba {
  /** Prefijo no secreto para borrar solo la auditoría sintética propia de la suite. */
  readonly prefijo: string;
  /** Genera IDs correlacionables y únicos durante el ciclo de vida de la suite. */
  readonly generar: () => string;
}

/**
 * Crea un generador de IDs de petición con un prefijo seguro y exclusivo de prueba.
 * @returns Prefijo sintético y función que emite IDs secuenciales únicos para la suite.
 * @effects Usa UUID criptográfico para evitar mezclar auditorías entre ejecuciones.
 */
export function crearIdentificadoresSolicitudPrueba(): IdentificadoresSolicitudPrueba {
  const prefijo = `ps003-test-${randomUUID()}`;
  let secuencia = 0;

  return {
    prefijo,
    /** Emite un identificador distinto para cada petición de la suite. */
    generar: () => `${prefijo}-${++secuencia}`,
  };
}
