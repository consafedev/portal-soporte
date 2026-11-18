import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as esquema from '../../apps/api/src/db/schema.js';
import { LimitadorIntentosPostgres } from '../../apps/api/src/auth/attempt-limiter.js';
import type { BaseDatosAuth } from '../../apps/api/src/db/client.js';
import { authThrottleWindows } from '../../apps/api/src/db/schema.js';
import { leerMigracionAuth } from '../support/auth-migration-fixture.js';

const motor = new PGlite();
const base = drizzle(motor, { schema: esquema }) as unknown as BaseDatosAuth;
const limitador = new LimitadorIntentosPostgres(base, Buffer.alloc(32, 41));
const instante = new Date('2026-11-18T06:00:00.000Z');

/** Aplica migraciones versionadas antes de probar consultas compatibles en PGlite. */
async function prepararSimulacion(): Promise<void> {
  await motor.exec(await leerMigracionAuth());
}

/** Borra solo las ventanas temporales de este motor embebido entre pruebas. */
async function limpiarVentanas(): Promise<void> {
  await base.delete(authThrottleWindows);
}

/** Cierra el motor embebido creado exclusivamente para esta suite. */
async function cerrarSimulacion(): Promise<void> {
  await motor.close();
}

/** Verifica los umbrales y el almacenamiento minimizado del limitador HMAC. */
function definirPruebasDeLimitador(): void {
  it('permite cinco intentos por identificador y bloquea los siguientes durante la ventana', async () => {
    const resultados: boolean[] = [];
    for (let intento = 0; intento < 7; intento += 1) {
      resultados.push(
        await limitador.registrarIntento(
          'LOGIN',
          'support_sintetico',
          '127.0.0.8',
          new Date(instante.getTime() + intento),
        ),
      );
    }

    expect(resultados).toEqual([true, true, true, true, true, false, false]);
  });

  it('limita por IP aunque el atacante cambie el identificador en cada petición', async () => {
    const resultados: boolean[] = [];
    for (let intento = 0; intento < 21; intento += 1) {
      resultados.push(
        await limitador.registrarIntento(
          'RECOVERY',
          `usuario_sintetico_${intento}`,
          '127.0.0.9',
          new Date(instante.getTime() + intento),
        ),
      );
    }

    expect(resultados.slice(0, 20).every(Boolean)).toBe(true);
    expect(resultados[20]).toBe(false);
  });

  it('purga ventanas vencidas mientras inicia otra ventana', async () => {
    await limitador.registrarIntento('LOGIN', 'usuario_anterior', '127.0.0.11', instante);
    const nuevaVentana = new Date(instante.getTime() + 16 * 60_000);

    await limitador.registrarIntento('LOGIN', 'usuario_nuevo', '127.0.0.12', nuevaVentana);
    const filas = await base.select().from(authThrottleWindows);

    expect(filas).toHaveLength(2);
    expect(filas.every((fila) => fila.windowStartedAt.getTime() === nuevaVentana.getTime())).toBe(
      true,
    );
  });

  it('guarda solo digests HMAC y permite reiniciar los contadores tras login válido', async () => {
    const identificador = 'admin_sintetico@example.test';
    const direccionIp = '127.0.0.10';
    await limitador.registrarIntento('LOGIN', identificador, direccionIp, instante);
    const filas = await base.select().from(authThrottleWindows);

    expect(filas).toHaveLength(2);
    expect(filas.every((fila) => /^[0-9a-f]{64}$/u.test(fila.keyHash))).toBe(true);
    expect(JSON.stringify(filas)).not.toContain(identificador);
    expect(JSON.stringify(filas)).not.toContain(direccionIp);

    await limitador.reiniciarIntentos('LOGIN', identificador, direccionIp);

    expect(await base.select().from(authThrottleWindows)).toHaveLength(0);
  });
}

describe('limitación HMAC de intentos simulada con PGlite', definirPruebasDeLimitador);
beforeAll(prepararSimulacion);
beforeEach(limpiarVentanas);
afterAll(cerrarSimulacion);
