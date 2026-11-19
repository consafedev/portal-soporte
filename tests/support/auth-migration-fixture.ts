import { readFile } from 'node:fs/promises';

const rutasMigraciones = [
  new URL('../../apps/api/drizzle/0000_auth_core.sql', import.meta.url),
  new URL('../../apps/api/drizzle/0001_auth_throttle_expiry.sql', import.meta.url),
  new URL('../../apps/api/drizzle/0002_invitation_lifecycle.sql', import.meta.url),
  new URL('../../apps/api/drizzle/0003_ps003_portal_schema_alignment.sql', import.meta.url),
];

/** Lee las migraciones de auth en orden para las simulaciones PGlite. */
export async function leerMigracionAuth(): Promise<string> {
  const archivos = await Promise.all(rutasMigraciones.map((ruta) => readFile(ruta, 'utf8')));

  return `CREATE SCHEMA IF NOT EXISTS portal;\nSET search_path TO portal;\n${archivos.join('\n')}`;
}
