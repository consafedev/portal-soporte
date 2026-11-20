import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Valida que el journal no incluya trabajos fuera del alcance aprobado. */
function probarJournalSinMigracionesMfa(): void {
  const rutaJournal = resolve(process.cwd(), 'apps/api/drizzle/meta/_journal.json');
  const journal = JSON.parse(readFileSync(rutaJournal, 'utf8')) as {
    readonly entries: readonly { readonly tag: string }[];
  };

  expect(journal.entries.some((entrada) => /mfa/iu.test(entrada.tag))).toBe(false);
}

/** Registra las pruebas de límites de las migraciones del Portal. */
function definirPruebasDeAlcanceMigratorio(): void {
  it('excluye migraciones MFA no aprobadas por AP-013', probarJournalSinMigracionesMfa);
}

describe('alcance de las migraciones Portal', definirPruebasDeAlcanceMigratorio);
