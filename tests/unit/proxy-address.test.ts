import { describe, expect, it } from 'vitest';
import {
  cargarProxiesBordeConfiables,
  resolverIpClienteConfiable,
  sanearCabecerasProxyBorde,
} from '../../apps/web/src/lib/proxy-address.js';

/** Comprueba la resolución de IP del cliente solo a través de pares de red configurados. */
function definirPruebasDeProxy(): void {
  it('ignora X-Forwarded-For cuando el peer directo no es confiable', () => {
    expect(resolverIpClienteConfiable('203.0.113.17', '198.51.100.28', [])).toBe('203.0.113.17');
  });

  it('recorre una cadena de proxies confiables desde el peer hacia el cliente', () => {
    expect(
      resolverIpClienteConfiable('10.4.0.9', '198.51.100.23, 192.168.8.6', [
        '10.4.0.0/16',
        '192.168.8.0/24',
      ]),
    ).toBe('198.51.100.23');
  });

  it('falla de forma cerrada si la cadena reenviada es inválida o demasiado larga', () => {
    expect(resolverIpClienteConfiable('10.4.0.9', 'cliente-no-ip', ['10.4.0.0/16'])).toBe(
      '10.4.0.9',
    );
    const cadenaLarga = Array.from({ length: 17 }, () => '198.51.100.23').join(',');
    expect(resolverIpClienteConfiable('10.4.0.9', cadenaLarga, ['10.4.0.0/16'])).toBe('10.4.0.9');
  });

  it('reemplaza X-Forwarded y elimina aliases controlados por el cliente', () => {
    expect(
      sanearCabecerasProxyBorde(
        {
          host: 'portal.example.test',
          'x-forwarded-for': '198.51.100.200',
          'x-forwarded-host': 'attacker.example.test',
          'x-forwarded-proto': 'https',
          forwarded: 'for=198.51.100.200;host=attacker.example.test',
          'x-real-ip': '198.51.100.200',
          cookie: 'cookie-sintetica',
        },
        '127.0.0.1',
        [],
      ),
    ).toEqual({
      host: 'portal.example.test',
      cookie: 'cookie-sintetica',
      'x-forwarded-for': '127.0.0.1',
    });
  });

  it('valida los CIDR de borde y limita desarrollo a loopback', () => {
    expect(cargarProxiesBordeConfiables({ NODE_ENV: 'development' })).toEqual([]);
    expect(
      cargarProxiesBordeConfiables({
        NODE_ENV: 'development',
        TRUSTED_EDGE_PROXY_CIDRS: '127.0.0.0/8, ::1/128',
      }),
    ).toEqual(['127.0.0.0/8', '::1/128']);
    for (const cidr of ['0.0.0.0/0', '::/0', '127.0.0.1/7', '10.0.0.0/8']) {
      expect(() =>
        cargarProxiesBordeConfiables({
          NODE_ENV: 'development',
          TRUSTED_EDGE_PROXY_CIDRS: cidr,
        }),
      ).toThrow();
    }
    expect(cargarProxiesBordeConfiables({ NODE_ENV: 'production' })).toEqual([]);
    expect(
      cargarProxiesBordeConfiables({
        NODE_ENV: 'production',
        TRUSTED_EDGE_PROXY_CIDRS: '10.4.0.0/16',
      }),
    ).toEqual(['10.4.0.0/16']);
  });
}

describe('confianza de direcciones reenviadas', definirPruebasDeProxy);
