import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

/**
 * Comprueba que el gestor, el runtime y los límites principales del workspace quedaron creados.
 *
 * @returns Una promesa que finaliza cuando los manifiestos y directorios requeridos son legibles.
 */
async function verificaBootstrap(): Promise<void> {
  const raiz = fileURLToPath(new URL('../', import.meta.url));
  const manifiesto = await readFile(resolve(raiz, 'package.json'), 'utf8');

  expect(manifiesto).toContain('"packageManager": "pnpm@12.21.0"');
  expect(manifiesto).toContain('"node": ">=24.0.0 <25"');

  const manifiestosDeTrabajo = [
    'apps/web/package.json',
    'apps/api/package.json',
    'packages/contracts/package.json',
    'packages/ui/package.json',
    'packages/core/package.json',
    'packages/connectors/package.json',
    'modules/rf-1/package.json',
  ];

  for (const ruta of manifiestosDeTrabajo) {
    await access(resolve(raiz, ruta));
  }
}

test('el workspace mantiene el stack y los siete límites aprobados', verificaBootstrap);
