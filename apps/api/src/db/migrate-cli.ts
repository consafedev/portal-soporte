import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarConfiguracionMigracionPrueba } from '../runtime-config.js';
import { crearClienteBaseDatosAuth } from './client.js';
import { migrarBaseAuth } from './migrate.js';

/**
 * Aplica migraciones solo al PostgreSQL efímero autorizado para pruebas.
 *
 * @returns Promesa que actualiza el código de salida ante error sin revelar la URL.
 */
async function ejecutarMigracionesPrueba(): Promise<void> {
  let database: ReturnType<typeof crearClienteBaseDatosAuth> | null = null;
  let fallo = false;

  try {
    const configuracion = cargarConfiguracionMigracionPrueba(process.env);
    database = crearClienteBaseDatosAuth({
      ...process.env,
      NODE_ENV: configuracion.NODE_ENV,
      TEST_DATABASE_ROLE: 'portal_test_migrator',
      DATABASE_URL: configuracion.DATABASE_URL,
    });
    await migrarBaseAuth(database);
    process.stdout.write('Migraciones aplicadas a PostgreSQL aislado de prueba.\n');
  } catch {
    fallo = true;
    process.stderr.write('No fue posible aplicar migraciones a la base aislada de prueba.\n');
  } finally {
    if (database !== null) {
      try {
        await database.$client.end({ timeout: 5 });
      } catch {
        fallo = true;
        process.stderr.write('No fue posible cerrar el cliente de migración de prueba.\n');
      }
    }
  }

  if (fallo) {
    process.exitCode = 1;
  }
}

/**
 * Ejecuta la CLI solo al invocar directamente el archivo compilado.
 *
 * @returns `true` si el archivo es el punto de entrada de Node.
 */
function esEjecucionDirecta(): boolean {
  const archivoEntrada = process.argv[1];
  return (
    archivoEntrada !== undefined && import.meta.url === pathToFileURL(resolve(archivoEntrada)).href
  );
}

if (esEjecucionDirecta()) {
  void ejecutarMigracionesPrueba();
}
