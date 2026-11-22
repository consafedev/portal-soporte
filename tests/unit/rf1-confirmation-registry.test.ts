import { describe, expect, it } from 'vitest';
import { RegistroConfirmacionesRf1 } from '../../apps/api/src/clients/rf1-confirmation-registry.js';

describe('registro efímero de confirmaciones RF-1', () => {
  it('consume una sola vez un token ligado a actor, cliente, perfil y contenido', () => {
    const registro = new RegistroConfirmacionesRf1();
    const contexto = {
      actorUserId: '00000000-0000-4000-8000-000000000001',
      clientId: '00000000-0000-4000-8000-000000000002',
      profileId: '00000000-0000-4000-8000-000000000003',
      digest: 'sha256-del-lote-sintetico',
    };
    const ahora = new Date('2026-11-22T12:00:00.000Z');
    const token = registro.emitir(contexto, ahora);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(
      registro.consumir(
        token!,
        { ...contexto, profileId: '00000000-0000-4000-8000-000000000004' },
        ahora,
      ),
    ).toBe(false);
    expect(registro.consumir(token!, contexto, ahora)).toBe(true);
    expect(registro.consumir(token!, contexto, ahora)).toBe(false);
  });

  it('rechaza tokens expirados y no entrega el token tras alcanzar su límite', () => {
    const registro = new RegistroConfirmacionesRf1(1, 1);
    const contexto = {
      actorUserId: '00000000-0000-4000-8000-000000000001',
      clientId: '00000000-0000-4000-8000-000000000002',
      profileId: '00000000-0000-4000-8000-000000000003',
      digest: 'sha256-del-lote-sintetico',
    };
    const ahora = new Date('2026-11-22T12:00:00.000Z');
    const token = registro.emitir(contexto, ahora);

    expect(registro.emitir(contexto, ahora)).toBeNull();
    expect(registro.consumir(token!, contexto, new Date(ahora.getTime() + 2))).toBe(false);
    expect(registro.emitir(contexto, new Date(ahora.getTime() + 2))).not.toBeNull();
  });
});
