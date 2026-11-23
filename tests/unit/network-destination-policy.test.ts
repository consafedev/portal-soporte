import { describe, expect, it, vi } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  endpointConexionAdminSchema,
  gatewaySshConexionAdminSchema,
} from '../../packages/contracts/src/clients.js';
import {
  ErrorPoliticaDestino,
  PoliticaDireccionesDestino,
  type ResolverDireccionesDestino,
} from '../../packages/connectors/src/network-destination-policy.js';

const endpoint = { hostname: 'mysql.example.test', port: 3306 } as const;
const fingerprintValida = `SHA256:${'A'.repeat(43)}`;

describe('contratos de endpoint de conexión', () => {
  it('acepta DNS ASCII y literales IPv4/IPv6 sin admitir sintaxis de URL', () => {
    expect(
      Value.Check(endpointConexionAdminSchema, { hostname: 'mysql.example.test', port: 3306 }),
    ).toBe(true);
    expect(
      Value.Check(endpointConexionAdminSchema, { hostname: '2606:4700:4700::1111', port: 3306 }),
    ).toBe(true);
    expect(
      Value.Check(endpointConexionAdminSchema, {
        hostname: 'https://mysql.example.test',
        port: 3306,
      }),
    ).toBe(false);
    expect(Value.Check(endpointConexionAdminSchema, { hostname: 'fe80::1%eth0', port: 3306 })).toBe(
      false,
    );
  });

  it('exige fingerprint SHA-256 para los gateways SSH', () => {
    expect(
      Value.Check(gatewaySshConexionAdminSchema, {
        hostname: 'ssh.example.test',
        port: 22,
        fingerprint: fingerprintValida,
      }),
    ).toBe(true);
    expect(
      Value.Check(gatewaySshConexionAdminSchema, {
        hostname: 'ssh.example.test',
        port: 22,
        fingerprint: 'MD5:aa:bb',
      }),
    ).toBe(false);
  });
});

/** Crea una policy cuyo resultado DNS queda controlado por cada caso de prueba. */
function crearPolitica(
  resultado: readonly string[] | Error,
  timeoutMs = 25,
): {
  readonly politica: PoliticaDireccionesDestino;
  readonly resolver: ResolverDireccionesDestino;
} {
  const resolver: ResolverDireccionesDestino = {
    resolver: vi.fn(async (_hostname: string, _senal: AbortSignal) => {
      if (resultado instanceof Error) {
        throw resultado;
      }
      return resultado;
    }),
  };
  return { politica: new PoliticaDireccionesDestino({ resolver, timeoutMs }), resolver };
}

describe('PoliticaDireccionesDestino', () => {
  it('fija una dirección pública y conserva el hostname original para TLS', async () => {
    const { politica, resolver } = crearPolitica(['1.1.1.1', '2606:4700:4700::1111']);

    await expect(
      politica.fijarMySqlDirecto(endpoint, new AbortController().signal),
    ).resolves.toEqual({
      hostname: endpoint.hostname,
      address: '1.1.1.1',
      port: endpoint.port,
    });
    expect(resolver.resolver).toHaveBeenCalledTimes(1);
  });

  it('rechaza toda una respuesta DNS mezclada antes de abrir sockets', async () => {
    const { politica, resolver } = crearPolitica(['1.1.1.1', '10.20.30.40']);

    await expect(
      politica.fijarMySqlDirecto(endpoint, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'DESTINATION_UNSAFE',
    });
    expect(resolver.resolver).toHaveBeenCalledTimes(1);
  });

  it('falla cerrado ante timeout, respuesta vacía y demasiadas respuestas DNS', async () => {
    const resolverLento: ResolverDireccionesDestino = {
      resolver: vi.fn(
        (_hostname: string, senal: AbortSignal) =>
          new Promise<readonly string[]>((_, rechazo) => {
            senal.addEventListener('abort', () => rechazo(new Error('timeout sintético')), {
              once: true,
            });
          }),
      ),
    };
    const politicaLenta = new PoliticaDireccionesDestino({ resolver: resolverLento, timeoutMs: 5 });
    const vacia = crearPolitica([]);
    const errorDns = crearPolitica(new Error('resolver details must stay private'));
    const excesiva = crearPolitica(Array.from({ length: 17 }, () => '1.1.1.1'));

    await expect(
      politicaLenta.fijarMySqlDirecto(endpoint, new AbortController().signal),
    ).rejects.toBeInstanceOf(ErrorPoliticaDestino);
    await expect(
      vacia.politica.fijarMySqlDirecto(endpoint, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'DNS_RESOLUTION_FAILED',
    });
    await expect(
      errorDns.politica.fijarMySqlDirecto(endpoint, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'DNS_RESOLUTION_FAILED', message: 'DNS_RESOLUTION_FAILED' });
    await expect(
      excesiva.politica.fijarMySqlDirecto(endpoint, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'DESTINATION_UNSAFE' });
  });

  it('rechaza hostnames malformados antes de consultar DNS', async () => {
    const { politica, resolver } = crearPolitica(['1.1.1.1']);

    for (const hostname of [
      'https://mysql.example.test',
      'mysql.example.test/path',
      '[2606:4700::1]',
      'mysql.example.test%eth0',
      '999.99.99.99',
    ]) {
      await expect(
        politica.fijarMySqlDirecto({ hostname, port: 3306 }, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'DESTINATION_INVALID' });
    }
    expect(resolver.resolver).not.toHaveBeenCalled();
  });

  it('conecta literales IPv4 e IPv6 sin resolverlos de nuevo', async () => {
    const resolver: ResolverDireccionesDestino = { resolver: vi.fn() };
    const politica = new PoliticaDireccionesDestino({ resolver });

    await expect(
      politica.fijarMySqlDirecto({ hostname: '8.8.8.8', port: 3306 }, new AbortController().signal),
    ).resolves.toMatchObject({ address: '8.8.8.8' });
    await expect(
      politica.fijarMySqlDirecto(
        { hostname: '2606:4700:4700::1111', port: 3306 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ address: '2606:4700:4700::1111' });
    expect(resolver.resolver).not.toHaveBeenCalled();
  });

  it.each([
    ['loopback IPv4', '127.0.0.1'],
    ['RFC1918', '10.0.0.5'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['link-local IPv4', '169.254.169.254'],
    ['metadata AWS', '169.254.169.253'],
    ['AS112 IPv4', '192.31.196.1'],
    ['AMT IPv4', '192.52.193.1'],
    ['AS112 IPv4 directo', '192.175.48.1'],
    ['multicast IPv4', '224.0.0.1'],
    ['reservada IPv4', '240.0.0.1'],
    ['loopback IPv6', '::1'],
    ['ULA IPv6', 'fd00::1'],
    ['link-local IPv6', 'fe80::1'],
    ['multicast IPv6', 'ff02::1'],
    ['IPv4 mapped IPv6 privado', '::ffff:10.0.0.1'],
    ['IPv6 documentation', '2001:db8::1'],
    ['IPv6 benchmark', '2001:2::1'],
    ['NAT64 global IPv6', '64:ff9b::c000:221'],
    ['NAT64 local IPv6', '64:ff9b:1::1'],
    ['discard-only IPv6', '100::1'],
    ['dummy prefix IPv6', '100:0:0:1::1'],
    ['AS112 IPv6', '2620:4f:8000::1'],
    ['SRv6 SID IPv6', '5f00::1'],
    ['6to4', '2002::1'],
  ])('rechaza %s en una conexión directa', async (_caso, address) => {
    const { politica } = crearPolitica([address]);

    await expect(
      politica.fijarMySqlDirecto({ hostname: address, port: 3306 }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'DESTINATION_UNSAFE' });
  });

  it('permite loopback y RFC1918 únicamente como destino dentro de SSH', async () => {
    const resolver: ResolverDireccionesDestino = { resolver: vi.fn(async () => ['1.1.1.1']) };
    const politica = new PoliticaDireccionesDestino({ resolver });

    await expect(
      politica.fijarMySqlEnTunel(
        { hostname: '127.0.0.1', port: 3306 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ address: '127.0.0.1' });
    const privado = crearPolitica(['10.20.30.40']);
    await expect(
      privado.politica.fijarMySqlEnTunel(endpoint, new AbortController().signal),
    ).resolves.toMatchObject({ address: '10.20.30.40' });
    const ipv6Privada = crearPolitica(['fd12:3456::2']);
    await expect(
      ipv6Privada.politica.fijarMySqlEnTunel(endpoint, new AbortController().signal),
    ).resolves.toMatchObject({ address: 'fd12:3456::2' });
    await expect(
      politica.fijarGatewaySsh(
        { hostname: 'ssh.example.test', port: 22 },
        fingerprintValida,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ address: '1.1.1.1' });
  });

  it('exige fingerprint SHA-256 SSH en formato OpenSSH y valida el gateway como público', async () => {
    const { politica, resolver } = crearPolitica(['10.0.0.1']);

    await expect(
      politica.fijarGatewaySsh(
        { hostname: 'ssh.example.test', port: 22 },
        'MD5:aa:bb',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'DESTINATION_INVALID' });
    await expect(
      politica.fijarGatewaySsh(
        { hostname: 'ssh.example.test', port: 22 },
        fingerprintValida,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'DESTINATION_UNSAFE' });
    expect(resolver.resolver).toHaveBeenCalledTimes(1);
  });

  it.each(['169.254.169.254', 'fe80::1', 'ff02::1', '::'])(
    'rechaza %s también como target SSH',
    async (address) => {
      const { politica } = crearPolitica([address]);

      await expect(
        politica.fijarMySqlEnTunel(endpoint, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'DESTINATION_UNSAFE' });
    },
  );

  it('normaliza el hostname DNS a minúsculas y quita el punto raíz', async () => {
    const { politica } = crearPolitica(['1.1.1.1']);

    await expect(
      politica.fijarMySqlDirecto(
        { hostname: 'MYSQL.Example.Test.', port: 3306 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ hostname: 'mysql.example.test' });
  });
});
