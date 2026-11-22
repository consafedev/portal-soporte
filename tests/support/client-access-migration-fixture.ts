import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';

/** Crea una base PGlite vacía y aplica el historial versionado completo del Portal. */
export async function crearBaseClienteAccess(): Promise<PGlite> {
  const base = new PGlite();
  const carpetaMigraciones = fileURLToPath(new URL('../../apps/api/drizzle/', import.meta.url));
  await migrate(drizzle(base), {
    migrationsFolder: carpetaMigraciones,
    migrationsSchema: 'portal',
  });
  await base.exec('SET search_path TO portal');
  return base;
}

/** Cierra la instancia PGlite abierta por la fixture de acceso a clientes. */
export async function cerrarBaseClienteAccess(base: PGlite): Promise<void> {
  await base.close();
}
