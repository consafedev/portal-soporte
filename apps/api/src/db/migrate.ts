import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { BaseDatosAuth } from './client.js';

/**
 * Aplica migraciones versionadas de autenticación con el único cliente configurado del portal.
 *
 * @param database - Cliente PostgreSQL validado para el entorno actual.
 * @returns Promesa que termina tras aplicar todas las migraciones pendientes.
 * @throws Error si falta un archivo o falla una transacción de migración.
 */
export async function migrarBaseAuth(database: BaseDatosAuth): Promise<void> {
  await migrate(database, { migrationsFolder: resolverCarpetaMigraciones() });
}

/**
 * Resuelve SQL de source y del runtime compilado desde la raíz del paquete API.
 *
 * @returns Ruta absoluta a la carpeta `drizzle` versionada.
 * @throws Error si no se encuentra el directorio de migraciones.
 */
function resolverCarpetaMigraciones(): string {
  const carpetaFuente = fileURLToPath(new URL('../../drizzle', import.meta.url));
  if (existsSync(carpetaFuente)) {
    return carpetaFuente;
  }

  const carpetasLocales = [
    resolve(process.cwd(), 'drizzle'),
    resolve(process.cwd(), 'apps/api/drizzle'),
  ];
  for (const carpeta of carpetasLocales) {
    if (existsSync(carpeta)) {
      return carpeta;
    }
  }

  throw new Error('No se encontró el directorio versionado de migraciones del API.');
}
