import { describe, expect, it } from 'vitest';
import { crearClienteBaseDatosAuth } from '../../apps/api/src/db/client.js';

/** Construye en memoria una URL con secreto sintético para probar su rechazo. */
function crearUrlConContrasenaSintetica(): string {
  const url = new URL('postgres://127.0.0.1/portal_ps003_test');
  url.username = 'ps003_test';
  url.password = 'valor-sintetico-rechazado';

  return url.href;
}

/** Agrupa pruebas que impiden que la suite conecte con una base no aislada. */
function definirPruebasDeDestinoDeBaseDatos(): void {
  it('rechaza un servidor remoto durante las pruebas', pruebaRechazaServidorRemoto);
  it('rechaza una contraseña en la URL de la suite de prueba', pruebaRechazaContrasenaEnPrueba);
  it('rechaza un nombre de base diferente al reservado', pruebaRechazaNombreDeBaseInvalido);
}

/** Comprueba que la configuración de pruebas no admita servidores remotos. */
function pruebaRechazaServidorRemoto(): void {
  expect(() =>
    crearClienteBaseDatosAuth({
      DATABASE_URL: 'postgres://ps003_test@db.example.test/portal_ps003_test',
      NODE_ENV: 'test',
    }),
  ).toThrow('NODE_ENV=test solo permite la base portal_ps003_test');
}

/** Comprueba que el destino de pruebas no acepte credenciales con contraseña. */
function pruebaRechazaContrasenaEnPrueba(): void {
  expect(() =>
    crearClienteBaseDatosAuth({
      DATABASE_URL: crearUrlConContrasenaSintetica(),
      NODE_ENV: 'test',
    }),
  ).toThrow('NODE_ENV=test solo permite la base portal_ps003_test');
}

/** Comprueba que la factoría solo habilite la base sintética reservada para integración. */
function pruebaRechazaNombreDeBaseInvalido(): void {
  expect(() =>
    crearClienteBaseDatosAuth({
      DATABASE_URL: 'postgres://ps003_test@127.0.0.1/portal_development',
      NODE_ENV: 'test',
    }),
  ).toThrow('NODE_ENV=test solo permite la base portal_ps003_test');
}

describe('protección del destino PostgreSQL de prueba', definirPruebasDeDestinoDeBaseDatos);
