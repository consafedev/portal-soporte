import { describe, expect, it } from 'vitest';
import {
  obtenerDescripcionFlujo,
  obtenerTituloFlujo,
} from '../../apps/web/src/lib/recovery-link-copy.js';

describe('texto del enlace de acceso', () => {
  it('indica que debe solicitarse un enlace nuevo si falta el propósito válido', () => {
    expect(obtenerTituloFlujo(null)).toBe('No se pudo verificar el enlace');
    expect(obtenerDescripcionFlujo(null)).toBe(
      'Solicita un enlace nuevo desde la pantalla de recuperación.',
    );
  });
});
