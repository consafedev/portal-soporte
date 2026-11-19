import { defineConfig } from 'drizzle-kit';

/** Configura el generador de migraciones sin habilitar cambios directos de esquema. */
export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/api/src/db/schema.ts',
  schemaFilter: ['portal'],
  out: './apps/api/drizzle',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://localhost/portal_ps003_test',
  },
});
