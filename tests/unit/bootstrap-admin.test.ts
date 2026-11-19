import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type {
  EntradaBootstrapAdminPersistida,
  RepositorioBootstrapAdmin,
} from '../../apps/api/src/auth/admin-user-service.js';
import {
  crearAdministradorInicial,
  TerminalContrasenaSinEco,
  type TerminalBootstrapAdmin,
} from '../../apps/api/src/auth/bootstrap-admin.js';

/** Construye un destino sintético para inspeccionar la cuenta inicial persistida. */
function crearRepositorioCapturado(
  capturar: (entrada: EntradaBootstrapAdminPersistida) => void,
): RepositorioBootstrapAdmin {
  return {
    async crearAdministradorInicial(entrada) {
      capturar(entrada);

      return {
        id: entrada.id,
        username: entrada.username,
        displayName: entrada.displayName,
        role: 'ADMIN',
        email: entrada.email,
        emailVerifiedAt: null,
        status: 'ACTIVE',
        hasPassword: true,
        createdAt: entrada.createdAt,
      };
    },
  };
}

describe('bootstrap del primer administrador', () => {
  it('lee texto en raw mode sin imprimir caracteres y restaura el terminal', async () => {
    const entrada = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode: vi.fn(),
    }) as unknown as NodeJS.ReadStream;
    const registroSalida = { texto: '' };
    const salida = {
      write(fragmento: string) {
        registroSalida.texto += fragmento;
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    const lector = new TerminalContrasenaSinEco(entrada, salida);
    const secretoSintetico = 'No debe aparecer en salida 123';
    const lectura = lector.leerContrasenaSinEco();

    entrada.emit('data', secretoSintetico);
    entrada.emit('data', '\r');

    await expect(lectura).resolves.toBe(secretoSintetico);
    expect(entrada.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(entrada.setRawMode).toHaveBeenNthCalledWith(2, false);
    expect(registroSalida.texto).not.toContain(secretoSintetico);
  });

  it('se niega a leer o crear credenciales cuando el terminal no es interactivo', async () => {
    const leerContrasena = vi.fn(async () => 'Frase sintética no usada 123');
    const terminal: TerminalBootstrapAdmin = {
      esInteractiva: () => false,
      leerContrasenaSinEco: leerContrasena,
    };
    const crearAdministrador = vi.fn();
    const repositorio: RepositorioBootstrapAdmin = {
      async crearAdministradorInicial(entrada) {
        crearAdministrador(entrada);
        throw new Error('No debe alcanzar persistencia.');
      },
    };

    await expect(
      crearAdministradorInicial(
        {
          username: 'admin_sintetico',
          email: 'admin_sintetico@example.test',
          displayName: 'Administrador sintético',
        },
        terminal,
        repositorio,
      ),
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_REQUIRES_TTY' });

    expect(leerContrasena).not.toHaveBeenCalled();
    expect(crearAdministrador).not.toHaveBeenCalled();
  });

  it('rechaza una contraseña inicial sin confirmación coincidente', async () => {
    const leerContrasena = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('Primera frase sintética segura 123')
      .mockResolvedValueOnce('Otra frase sintética segura 456');
    const terminal: TerminalBootstrapAdmin = {
      esInteractiva: () => true,
      leerContrasenaSinEco: leerContrasena,
    };
    const persistir = vi.fn();
    const repositorio: RepositorioBootstrapAdmin = {
      async crearAdministradorInicial(entrada) {
        persistir(entrada);
        throw new Error('No debe persistirse una contraseña sin confirmar.');
      },
    };

    await expect(
      crearAdministradorInicial(
        {
          username: 'admin_sintetico',
          email: 'admin_sintetico@example.test',
          displayName: 'Administrador sintético',
        },
        terminal,
        repositorio,
      ),
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_PASSWORD_MISMATCH' });

    expect(leerContrasena).toHaveBeenCalledTimes(2);
    expect(persistir).not.toHaveBeenCalled();
  });

  it('lee la contraseña sin eco y entrega al repositorio solo su hash Argon2id', async () => {
    const contrasena = 'Clave de bootstrap segura ñ 123';
    const entradaPersistida: EntradaBootstrapAdminPersistida[] = [];
    const terminal: TerminalBootstrapAdmin = {
      esInteractiva: () => true,
      async leerContrasenaSinEco() {
        return contrasena;
      },
    };
    const resultado = await crearAdministradorInicial(
      {
        username: 'Admin_Sintetico',
        email: 'Admin_Sintetico@example.test',
        displayName: 'Administrador sintético',
      },
      terminal,
      crearRepositorioCapturado((entrada) => entradaPersistida.push(entrada)),
    );
    const persistida = entradaPersistida[0];

    expect(resultado).toMatchObject({ role: 'ADMIN', status: 'ACTIVE', emailVerifiedAt: null });
    expect(persistida?.username).toBe('admin_sintetico');
    expect(persistida?.usernameNormalized).toBe('admin_sintetico');
    expect(persistida?.emailNormalized).toBe('admin_sintetico@example.test');
    expect(persistida?.passwordHash).toMatch(/^\$argon2id\$/u);
    expect(persistida?.passwordHash).not.toBe(contrasena);
    expect('password' in (persistida ?? {})).toBe(false);
  });
});
