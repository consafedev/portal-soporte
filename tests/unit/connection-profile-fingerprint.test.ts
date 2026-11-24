import { describe, expect, it } from 'vitest';
import { calcularHuellaPerfilConexion } from '../../apps/api/src/clients/connection-profile-fingerprint.js';
import type { PerfilConexionCliente } from '../../packages/core/src/clients/connection-profile-ports.js';

const PERFIL: PerfilConexionCliente = {
  id: '00000000-0000-4000-8000-000000000001',
  clientId: '00000000-0000-4000-8000-000000000002',
  nombre: 'Perfil sintético',
  tipo: 'MYSQL_TCP',
  entorno: 'TEST',
  destinoMySqlId: 'mysql-fixture',
  gatewaySshId: null,
  baseDatos: 'fixture_db',
  estado: 'ACTIVE',
  createdAt: new Date('2026-11-22T10:00:00.000Z'),
  updatedAt: new Date('2026-11-22T11:00:00.000Z'),
};

describe('huella segura de perfil de conexión', () => {
  it('es determinista y cambia cuando se edita el destino operativo', () => {
    const huellaOriginal = calcularHuellaPerfilConexion(PERFIL);

    expect(calcularHuellaPerfilConexion(PERFIL)).toBe(huellaOriginal);
    expect(calcularHuellaPerfilConexion({ ...PERFIL, destinoMySqlId: 'otro-destino' })).not.toBe(
      huellaOriginal,
    );
  });

  it('cambia al rotar credenciales porque la revisión del perfil se actualiza', () => {
    const perfilRotado = {
      ...PERFIL,
      updatedAt: new Date('2026-11-22T11:01:00.000Z'),
    };

    expect(calcularHuellaPerfilConexion(perfilRotado)).not.toBe(
      calcularHuellaPerfilConexion(PERFIL),
    );
  });

  it('cambia al modificar el hostname aunque la hora de actualización no cambie', () => {
    const perfilConDestino = {
      ...PERFIL,
      destinoMySql: { hostname: 'mysql.original.test', port: 3306 },
    };

    expect(
      calcularHuellaPerfilConexion({
        ...perfilConDestino,
        destinoMySql: { hostname: 'mysql.alternativo.test', port: 3306 },
      }),
    ).not.toBe(calcularHuellaPerfilConexion(perfilConDestino));
  });
});
