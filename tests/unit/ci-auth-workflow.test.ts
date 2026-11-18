import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * Lee el workflow vigente como texto sin conectarse a GitHub ni ejecutar acciones.
 *
 * @returns Contenido UTF-8 del workflow de CI versionado.
 * @throws Error si el archivo no existe o no puede leerse.
 */
async function leerWorkflowCi(): Promise<string> {
  return readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
}

describe('workflow de CI para autenticación PS-003', () => {
  it('instala PostgreSQL 18.7 en el runner y fija la versión del binario', async () => {
    const workflow = await leerWorkflowCi();

    expect(workflow).toContain('runs-on: ubuntu-24.04');
    expect(workflow).toContain('PG_BIN_DIR: /usr/lib/postgresql/18/bin');
    expect(workflow).toContain('postgresql-18=18.7-1.pgdg24.04+2');
    expect(workflow).toContain('B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8');
    expect(workflow).not.toMatch(/^\s*services:/mu);
    expect(workflow).not.toContain('image: postgres:');
    expect(workflow).toContain("sed -nE 's/^postgres \\(PostgreSQL\\) ([0-9]+\\.[0-9]+).*/\\1/p'");
    expect(workflow).not.toContain('test "$(/usr/lib/postgresql/18/bin/postgres --version)" =');
  });

  it('conserva los gates de tests, E2E, tipos, build y seguridad', async () => {
    const workflow = await leerWorkflowCi();

    for (const comando of [
      'pnpm verify:skills',
      'pnpm format:check',
      'pnpm lint',
      'pnpm test',
      'pnpm test:integration',
      'pnpm test:migrate-cli',
      'pnpm build',
      'pnpm typecheck',
      'pnpm test:e2e',
      'pnpm check:secrets',
      'audit --prod --audit-level high',
      'run check:dependencies:ci',
    ]) {
      expect(workflow).toContain(comando);
    }
  });
});
