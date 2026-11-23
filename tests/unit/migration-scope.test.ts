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

/** Verifica que 0009 solo agregue destinos al perfil del esquema portal. */
function probarMigracionDeDestinosAditiva(): void {
  const rutaJournal = resolve(process.cwd(), 'apps/api/drizzle/meta/_journal.json');
  const rutaMigracion = resolve(
    process.cwd(),
    'apps/api/drizzle/0009_connection_profile_destinations.sql',
  );
  const journal = JSON.parse(readFileSync(rutaJournal, 'utf8')) as {
    readonly entries: readonly { readonly tag: string }[];
  };
  const migracion = readFileSync(rutaMigracion, 'utf8');

  expect(
    journal.entries.some((entrada) => entrada.tag === '0009_connection_profile_destinations'),
  ).toBe(true);
  const tablasAlteradas = [...migracion.matchAll(/ALTER TABLE "([^"]+)"\."([^"]+)"/gu)].map(
    ([, esquema, tabla]) => `${esquema}.${tabla}`,
  );
  expect(new Set(tablasAlteradas)).toEqual(new Set(['portal.client_connection_profiles']));
  expect(migracion.match(/ADD COLUMN/gu)).toHaveLength(5);
  expect(migracion.match(/ADD CONSTRAINT/gu)).toHaveLength(2);
  expect(migracion).not.toMatch(/\b(?:DROP|DELETE|TRUNCATE)\b/iu);
}

/** Verifica que 0010 añada solo el CHECK null-safe de perfiles de conexión. */
function probarCorreccionNulaDeMigracion0010(): void {
  const rutaJournal = resolve(process.cwd(), 'apps/api/drizzle/meta/_journal.json');
  const rutaMigracion = resolve(
    process.cwd(),
    'apps/api/drizzle/0010_connection_profile_complete_endpoint.sql',
  );
  const journal = JSON.parse(readFileSync(rutaJournal, 'utf8')) as {
    readonly entries: readonly { readonly tag: string }[];
  };
  const migracion = readFileSync(rutaMigracion, 'utf8');

  expect(journal.entries.at(-1)?.tag).toBe('0010_connection_profile_complete_endpoint');
  expect([...migracion.matchAll(/ALTER TABLE "([^"]+)"\."([^"]+)"/gu)]).toHaveLength(1);
  expect(migracion).toContain('client_connection_profiles_complete_endpoint_check');
  expect(migracion).toContain('"portal"."client_connection_profiles"');
  expect(migracion).toContain('"gateway_fingerprint" IS NOT NULL');
  expect(migracion).toContain('"destination_port" IS NOT NULL');
  expect(migracion).toMatch(/ADD CONSTRAINT/iu);
  expect(migracion).not.toMatch(/\b(?:DROP|DELETE|TRUNCATE)\b/iu);
}

/** Registra las pruebas de límites de las migraciones del Portal. */
function definirPruebasDeAlcanceMigratorio(): void {
  it('excluye migraciones MFA no aprobadas por AP-013', probarJournalSinMigracionesMfa);
}

describe('alcance de las migraciones Portal', definirPruebasDeAlcanceMigratorio);

describe('migración aditiva de destinos PS-005.4', () => {
  it('solo modifica client_connection_profiles dentro de portal', probarMigracionDeDestinosAditiva);
  it(
    'añade una restricción que rechaza valores incompletos con semántica NULL',
    probarCorreccionNulaDeMigracion0010,
  );
});
