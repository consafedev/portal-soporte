import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { BaseDatosAuth } from './client.js';

const carpetaMigraciones = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Aplica migraciones versionadas de autenticación con el único cliente configurado del portal. */
export async function migrarBaseAuth(database: BaseDatosAuth): Promise<void> {
  await migrate(database, { migrationsFolder: carpetaMigraciones });
}
