import { createInterface } from 'node:readline/promises';
import { crearAdministradorInicial, TerminalContrasenaSinEco } from './bootstrap-admin.js';
import { PostgresAuthRepository } from './postgres-auth-repository.js';
import { crearClienteBaseDatosAuth } from '../db/client.js';

/** Solicita campos no secretos y crea el primer ADMIN sin aceptar credenciales en argv. */
async function ejecutarBootstrapAdmin(): Promise<void> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    process.stderr.write('BOOTSTRAP_REQUIRES_TTY: usa un terminal interactivo seguro.\n');
    process.exitCode = 1;
    return;
  }

  const preguntas = createInterface({ input: process.stdin, output: process.stdout });
  let baseDatos: ReturnType<typeof crearClienteBaseDatosAuth> | null = null;

  try {
    const username = await preguntas.question('Nombre de usuario inicial: ');
    const email = await preguntas.question('Correo de verificación: ');
    const displayName = await preguntas.question('Nombre visible: ');
    preguntas.close();

    baseDatos = crearClienteBaseDatosAuth(process.env);
    const repositorio = new PostgresAuthRepository(baseDatos);
    await crearAdministradorInicial(
      { username, email, displayName },
      new TerminalContrasenaSinEco(),
      repositorio,
    );
    process.stdout.write(
      'Administrador inicial creado; el correo sigue pendiente de verificación.\n',
    );
  } catch (error) {
    const codigo =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'BOOTSTRAP_ADMIN_FAILED';
    process.stderr.write(`No se creó el administrador inicial (${codigo}).\n`);
    process.exitCode = 1;
  } finally {
    preguntas.close();
    await baseDatos?.$client.end({ timeout: 5 });
  }
}

void ejecutarBootstrapAdmin();
