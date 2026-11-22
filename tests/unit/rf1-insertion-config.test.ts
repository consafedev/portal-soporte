import { describe, expect, it } from 'vitest';
import { cargarConfiguracionInsercionRf1 } from '../../apps/api/src/config.js';

describe('configuración del gate global RF-1', () => {
  it('mantiene el gate apagado si no hay configuración o se solicita false', () => {
    expect(cargarConfiguracionInsercionRf1({})).toBe(false);
    expect(cargarConfiguracionInsercionRf1({ PORTAL_RF1_INSERTION_ENABLED: 'false' })).toBe(false);
  });

  it('solo activa el gate con el literal true explícito', () => {
    expect(cargarConfiguracionInsercionRf1({ PORTAL_RF1_INSERTION_ENABLED: 'true' })).toBe(true);
  });

  it('rechaza valores ambiguos en vez de habilitar escrituras por accidente', () => {
    expect(() => cargarConfiguracionInsercionRf1({ PORTAL_RF1_INSERTION_ENABLED: 'yes' })).toThrow(
      'PORTAL_RF1_INSERTION_ENABLED debe ser true o false.',
    );
  });
});
