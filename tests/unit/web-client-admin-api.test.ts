import { describe, expect, it } from 'vitest';
import { ErrorApiClientes } from '../../apps/web/src/lib/client-admin-api.js';

describe('mensajes de error del cliente administrativo', () => {
  it('no presenta el endpoint del perfil como una allowlist del servidor', () => {
    const error = new ErrorApiClientes('DESTINATION_NOT_ALLOWED', 422);

    expect(error.message).toBe(
      'El perfil no tiene un destino completo o no está disponible para esta operación.',
    );
    expect(error.message).not.toContain('configuración del servidor');
  });
});
