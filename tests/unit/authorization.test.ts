import { describe, expect, it } from 'vitest';
import type {
  EventoAuditoriaAuth,
  EscritorAuditoriaAuth,
  RelojAuth,
} from '../../packages/core/src/auth/ports.js';
import { requireRole } from '../../apps/api/src/auth/authorization.js';

const instante = new Date('2026-11-17T12:00:00.000Z');

/** Guarda eventos de autorización de prueba sin escribir información de credenciales. */
class AuditoriaMemoria implements EscritorAuditoriaAuth {
  public readonly eventos: EventoAuditoriaAuth[] = [];

  /** Conserva el evento recibido para afirmar la denegación sin serializar secretos. */
  public async registrar(evento: EventoAuditoriaAuth): Promise<void> {
    this.eventos.push(evento);
  }
}

/** Proporciona una hora fija para que la auditoría no dependa del reloj del host. */
const relojFijo: RelojAuth = {
  /** Devuelve una copia del instante fijo de la suite. */
  ahora(): Date {
    return new Date(instante);
  },
};

/** Construye un contexto sintético de petición sin importar Fastify al proyecto raíz. */
function crearSolicitud(rol: 'ADMIN' | 'SUPPORT' | null): Record<string, unknown> {
  return {
    id: 'request-sintetica',
    authContext:
      rol === null
        ? null
        : {
            sessionId: '8f7bb273-a890-4d48-8977-a40088e2c926',
            usuario: {
              id: 'c2e0ea22-71a4-4e77-a57b-83c79d3e23bd',
              username: 'soporte_sintetico',
              displayName: 'Soporte sintético',
              role: rol,
              status: 'ACTIVE',
            },
          },
  };
}

/** Ejecuta el prehandler real con una respuesta mínima compatible con el resultado observado. */
async function ejecutarGuardia(rol: 'ADMIN' | 'SUPPORT' | null, auditoria: AuditoriaMemoria) {
  const respuesta = {
    statusCode: 200,
    cuerpo: undefined as unknown,
    code(codigo: number) {
      this.statusCode = codigo;
      return this;
    },
    send(cuerpo?: unknown) {
      this.cuerpo = cuerpo;
      return this;
    },
  };
  const preHandler = requireRole(['ADMIN'], auditoria, relojFijo);
  await preHandler.call(undefined as never, crearSolicitud(rol) as never, respuesta as never);

  return respuesta;
}

describe('autorización de rutas administrativas', () => {
  it('deniega SUPPORT con 403 y registra la operación sin aceptar privilegios de UI', async () => {
    const auditoria = new AuditoriaMemoria();
    const respuesta = await ejecutarGuardia('SUPPORT', auditoria);

    expect(respuesta.statusCode).toBe(403);
    expect(auditoria.eventos).toHaveLength(1);
    expect(auditoria.eventos[0]).toMatchObject({
      action: 'AUTHORIZATION_DENIED',
      outcome: 'DENIED',
      targetUserId: null,
    });
  });

  it('deniega una ruta protegida sin contexto autenticado', async () => {
    const respuesta = await ejecutarGuardia(null, new AuditoriaMemoria());

    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.cuerpo).toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('permite ADMIN en el backend y ejecuta el handler protegido', async () => {
    const respuesta = await ejecutarGuardia('ADMIN', new AuditoriaMemoria());

    expect(respuesta.statusCode).toBe(200);
  });
});
