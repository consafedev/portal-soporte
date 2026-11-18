import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const nombreBasePrueba = 'portal_ps003_test';
const usuarioBasePrueba = 'ps003_test';
const prefijoDirectorioPrueba = 'portal-ps003-test-';

type OpcionesEjecucion = {
  /** Permite capturar el código de salida sin convertir un comando fallido en excepción. */
  permitirFallo: boolean;
};

/** Valida que una URL provista solo apunte a la base sintética en una interfaz de loopback. */
function validarUrlExternaDePrueba(valor: string): URL {
  let url: URL;

  try {
    url = new URL(valor);
  } catch {
    throw new Error('TEST_DATABASE_URL no es una URL válida para la base aislada.');
  }

  const destinosLoopback = ['localhost', '127.0.0.1', '[::1]', '::1'];
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !destinosLoopback.includes(url.hostname.toLowerCase()) ||
    url.pathname !== `/${nombreBasePrueba}` ||
    url.username !== usuarioBasePrueba ||
    url.password.length !== 0 ||
    url.search.length !== 0 ||
    url.hash.length !== 0
  ) {
    throw new Error(
      'La suite solo admite portal_ps003_test con el usuario sintético y sin contraseña en loopback.',
    );
  }

  return url;
}

/** Reserva un puerto TCP loopback disponible para el clúster efímero. */
async function reservarPuertoLoopback(): Promise<number> {
  return new Promise((resolvePuerto, rechazarPuerto) => {
    const servidor = createServer();

    /** Resuelve el puerto reservado después de cerrar el socket de comprobación. */
    function cerrarSocket(
      error: Error | null,
      direccion?: string | ReturnType<typeof servidor.address>,
    ): void {
      if (error !== null) {
        rechazarPuerto(error);
        return;
      }

      if (direccion === undefined || direccion === null || typeof direccion === 'string') {
        rechazarPuerto(new Error('No se pudo reservar un puerto loopback para PostgreSQL.'));
        return;
      }

      servidor.close((errorCierre) => {
        if (errorCierre !== undefined) {
          rechazarPuerto(errorCierre);
          return;
        }

        resolvePuerto(direccion.port);
      });
    }

    servidor.once('error', rechazarPuerto);
    servidor.listen(0, '127.0.0.1', () => cerrarSocket(null, servidor.address()));
  });
}

/** Ejecuta un binario del cliente PostgreSQL sin interpolar argumentos en un shell. */
async function ejecutarBinario(
  nombre: string,
  argumentos: string[],
  opciones: OpcionesEjecucion = { permitirFallo: false },
): Promise<number> {
  const carpetaBinarios = process.env['PG_BIN_DIR'];
  const ejecutable = process.platform === 'win32' ? `${nombre}.exe` : nombre;
  const rutaEjecutable =
    carpetaBinarios === undefined ? ejecutable : join(resolve(carpetaBinarios), ejecutable);

  return new Promise((resolverCodigo, rechazarEjecucion) => {
    const proceso = spawn(rutaEjecutable, argumentos, { stdio: 'inherit' });

    /** Propaga errores de creación del proceso, incluida la falta de binarios PostgreSQL. */
    function rechazarError(error: Error): void {
      rechazarEjecucion(error);
    }

    /** Resuelve solo al finalizar el binario y reporta fallos de ejecución acotados. */
    function resolverSalida(codigo: number | null, senal: NodeJS.Signals | null): void {
      const codigoFinal = codigo ?? 1;
      if (!opciones.permitirFallo && codigoFinal !== 0) {
        rechazarEjecucion(
          new Error(
            `${nombre} finalizó con código ${codigoFinal}${senal === null ? '' : ` por ${senal}`}.`,
          ),
        );
        return;
      }

      resolverCodigo(codigoFinal);
    }

    proceso.once('error', rechazarError);
    proceso.once('close', resolverSalida);
  });
}

/** Comprueba que una ruta temporal pertenezca a la carpeta creada para esta suite. */
async function validarDirectorioPropio(ruta: string): Promise<void> {
  const raizTemporal = await realpath(tmpdir());
  const carpeta = resolve(ruta);
  const prefijoTemporal = `${resolve(raizTemporal)}${sep}`;

  if (
    !carpeta.startsWith(prefijoTemporal) ||
    !basename(carpeta).startsWith(prefijoDirectorioPrueba)
  ) {
    throw new Error(
      'La limpieza rechazó una ruta fuera del directorio temporal creado por la suite.',
    );
  }
}

/** Detiene con cierre rápido el servidor temporal antes de eliminar su directorio. */
async function detenerServidorTemporal(directorioDatos: string): Promise<boolean> {
  const estado = await ejecutarBinario('pg_ctl', ['-D', directorioDatos, 'status'], {
    permitirFallo: true,
  });
  if (estado !== 0) {
    return true;
  }

  return (
    (await ejecutarBinario('pg_ctl', ['-D', directorioDatos, '-m', 'fast', '-w', 'stop'], {
      permitirFallo: true,
    })) === 0
  );
}

/** Inicia una instancia temporal PostgreSQL con escucha limitada a loopback. */
async function iniciarServidorTemporal(
  directorioDatos: string,
  rutaLog: string,
  puerto: number,
): Promise<void> {
  await ejecutarBinario('initdb', [
    '-D',
    directorioDatos,
    '-U',
    usuarioBasePrueba,
    '-A',
    'trust',
    '--auth-local=trust',
    '--auth-host=trust',
    '--encoding=UTF8',
    '--no-locale',
  ]);

  await ejecutarBinario('pg_ctl', [
    '-D',
    directorioDatos,
    '-l',
    rutaLog,
    '-o',
    `-h 127.0.0.1 -p ${puerto} -c listen_addresses=127.0.0.1 -c log_statement=none -c log_connections=off`,
    '-w',
    'start',
  ]);
}

/** Ejecuta Vitest de integración contra un clúster temporal o servicio de prueba loopback. */
async function ejecutarPruebasIntegracion(): Promise<void> {
  const urlExistente = process.env['TEST_DATABASE_URL'];
  if (urlExistente !== undefined) {
    process.env['TEST_DATABASE_URL'] = validarUrlExternaDePrueba(urlExistente).href;
    await ejecutarVitest();
    return;
  }

  const directorioTemporal = await mkdtemp(join(tmpdir(), prefijoDirectorioPrueba));
  const directorioDatos = join(directorioTemporal, 'data');
  const rutaLog = join(directorioTemporal, 'postgres.log');
  const puerto = await reservarPuertoLoopback();
  let procesoIniciado = false;

  try {
    await iniciarServidorTemporal(directorioDatos, rutaLog, puerto);
    procesoIniciado = true;
    await ejecutarBinario('createdb', [
      '-h',
      '127.0.0.1',
      '-p',
      String(puerto),
      '-U',
      usuarioBasePrueba,
      nombreBasePrueba,
    ]);
    process.env['TEST_DATABASE_URL'] =
      `postgres://${usuarioBasePrueba}@127.0.0.1:${puerto}/${nombreBasePrueba}`;
    await ejecutarVitest();
  } finally {
    const sePuedeEliminar = !procesoIniciado || (await detenerServidorTemporal(directorioDatos));
    if (sePuedeEliminar) {
      await validarDirectorioPropio(directorioTemporal);
      await rm(directorioTemporal, { recursive: true, force: true });
    } else {
      console.error(
        `PostgreSQL de prueba no se detuvo; se conserva el clúster temporal en ${directorioTemporal}.`,
      );
    }
  }
}

/** Lanza el archivo ejecutable de Vitest sin envolver la URL ni los argumentos en shell. */
async function ejecutarVitest(): Promise<void> {
  const rutaVitest = resolve('node_modules/vitest/vitest.mjs');
  const argumentos = process.argv.slice(2).filter((argumento) => argumento !== '--');

  await ejecutarNode(rutaVitest, [
    'run',
    '--config',
    'vitest.integration.config.ts',
    ...argumentos,
  ]);
}

/** Ejecuta Vitest con el runtime Node fijado por el repositorio. */
async function ejecutarNode(archivo: string, argumentos: string[]): Promise<void> {
  await new Promise<void>((resolver, rechazar) => {
    const proceso = spawn(process.execPath, [archivo, ...argumentos], { stdio: 'inherit' });

    /** Propaga los errores de lanzamiento de Node.js. */
    function rechazarError(error: Error): void {
      rechazar(error);
    }

    /** Termina la espera con el resultado del proceso de pruebas. */
    function resolverSalida(codigo: number | null, senal: NodeJS.Signals | null): void {
      if (codigo === 0) {
        resolver();
        return;
      }

      rechazar(
        new Error(
          `Vitest terminó con código ${codigo ?? 1}${senal === null ? '' : ` por ${senal}`}.`,
        ),
      );
    }

    proceso.once('error', rechazarError);
    proceso.once('close', resolverSalida);
  });
}

/** Registra un error sin mostrar URLs, tokens, contraseñas u otros argumentos sensibles. */
function informarFallo(error: unknown): void {
  const mensaje =
    error instanceof Error ? error.message : 'Error inesperado en la suite de integración.';
  console.error(`No se completó la suite PostgreSQL aislada: ${mensaje}`);
  process.exitCode = 1;
}

/** Valida el destino y ejecuta la suite real de PostgreSQL con limpieza limitada a su clúster. */
async function main(): Promise<void> {
  await ejecutarPruebasIntegracion();
}

void main().catch(informarFallo);
