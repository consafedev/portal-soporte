import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import postgres from 'postgres';
type ConfiguracionBasePruebaModule = typeof import('../apps/api/src/runtime-config.js');
type PreflightBasePruebaModule = typeof import('../apps/api/src/db/test-database-preflight.js');
type IdentidadSshPruebaModule = typeof import('./test-database-ssh-identity.js');

const { cargarConfiguracionBasePrueba, validarModoEntradaHarnessPrueba } = (await import(
  new URL('../apps/api/dist/apps/api/src/runtime-config.js', import.meta.url).href
)) as ConfiguracionBasePruebaModule;
const {
  validarMismaInstanciaBasePrueba,
  verificarEstadoEsquemaBasePrueba,
  verificarIdentidadBasePrueba,
} = (await import(
  new URL('../apps/api/dist/apps/api/src/db/test-database-preflight.js', import.meta.url).href
)) as PreflightBasePruebaModule;
const { verificarTunelSshPrueba } = (await import(
  new URL('./test-database-ssh-identity.ts', import.meta.url).href
)) as IdentidadSshPruebaModule;

const nombreBasePrueba = 'portal_ps003_test';
const usuarioBasePrueba = 'ps003_test';
const prefijoDirectorioPrueba = 'portal-ps003-test-';
/** Limita los logs de diagnóstico del clúster temporal impresos por el job de CI. */
const limiteCaracteresRegistroPostgres = 12_000;

type OpcionesEjecucion = {
  /** Permite capturar el código de salida sin convertir un comando fallido en excepción. */
  permitirFallo: boolean;
};

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

/**
 * Lee una cola acotada del registro temporal de PostgreSQL cuando el inicio falla.
 *
 * @param rutaLog - Ruta privada al log del clúster temporal efímero.
 * @returns Contenido acotado o un mensaje sintético si el log no se puede leer.
 */
async function leerRegistroInicioTemporal(rutaLog: string): Promise<string> {
  try {
    const contenido = await readFile(rutaLog, 'utf8');
    const registro = contenido.slice(-limiteCaracteresRegistroPostgres);
    return contenido.length > limiteCaracteresRegistroPostgres
      ? '[Se omitió el inicio del registro por límite de tamaño.]\n' + registro
      : registro || '[El registro de PostgreSQL está vacío.]';
  } catch {
    return '[No se pudo leer el registro temporal de PostgreSQL.]';
  }
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

  try {
    await ejecutarBinario('pg_ctl', [
      '-D',
      directorioDatos,
      '-l',
      rutaLog,
      '-o',
      `-h 127.0.0.1 -p ${puerto} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${dirname(rutaLog)} -c log_statement=none -c log_connections=off`,
      '-w',
      'start',
    ]);
  } catch (error) {
    console.error(
      'Registro del intento de inicio de PostgreSQL:\n' +
        (await leerRegistroInicioTemporal(rutaLog)),
    );
    throw error;
  }
}

/** Ejecuta pruebas o migración compilada contra el clúster temporal loopback. */
async function ejecutarPruebasIntegracion(): Promise<void> {
  const urlExistente = process.env['TEST_DATABASE_URL'];
  const argumentos = process.argv.slice(2).filter((argumento) => argumento !== '--');
  const ejecucionE2e = argumentos[0] === '--e2e';

  fijarEntornoDePruebas();
  validarModoEntradaHarnessPrueba(process.env);

  if (urlExistente !== undefined) {
    const configuracion = cargarConfiguracionBasePrueba({
      ...process.env,
      NODE_ENV: 'test',
    });
    process.env['TEST_DATABASE_MODE'] = configuracion.modo;
    process.env['TEST_DATABASE_URL'] = configuracion.TEST_DATABASE_URL;
    process.env['TEST_MIGRATOR_DATABASE_URL'] = configuracion.TEST_MIGRATOR_DATABASE_URL;

    if (configuracion.modo === 'ssh-tunnel') {
      await verificarDestinoRemotoPrueba(
        configuracion.TEST_DATABASE_URL,
        configuracion.TEST_MIGRATOR_DATABASE_URL,
      );
      if (!ejecucionE2e && argumentos[0] !== '--migrate-cli') {
        const estadoInicial = await verificarEstadoEsquemaBasePrueba(
          configuracion.TEST_MIGRATOR_DATABASE_URL,
        );
        if (estadoInicial !== 'migrado') {
          await ejecutarMigracionCompilada();
          await verificarDestinoRemotoPrueba(
            configuracion.TEST_DATABASE_URL,
            configuracion.TEST_MIGRATOR_DATABASE_URL,
          );
        }
      }
    } else if (ejecucionE2e) {
      throw new Error('El modo E2E local requiere que este harness cree un clúster efímero nuevo.');
    }
    process.env['PORTAL_TEST_HARNESS_VERIFIED'] = '1';

    if (ejecucionE2e) {
      process.env['PORTAL_TEST_REQUEST_ID_PREFIX'] ??=
        `ps003-test-${randomBytes(16).toString('hex')}-`;
      process.env['PORTAL_TEST_AUTH_HMAC_KEY'] ??= randomBytes(32).toString('base64url');
    }
    await ejecutarComandoAislado();
    if (configuracion.modo === 'ssh-tunnel') {
      if (argumentos[0] === '--migrate-cli') {
        await verificarIdentidadBasePrueba(
          configuracion.TEST_MIGRATOR_DATABASE_URL,
          'portal_test_migrator',
        );
      } else {
        await verificarDestinoRemotoPrueba(
          configuracion.TEST_DATABASE_URL,
          configuracion.TEST_MIGRATOR_DATABASE_URL,
        );
      }
      exigirEstadoMigrado(
        await verificarEstadoEsquemaBasePrueba(configuracion.TEST_MIGRATOR_DATABASE_URL),
      );
    }
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
    process.env['TEST_DATABASE_MODE'] = 'local-ephemeral';
    process.env['TEST_MIGRATOR_DATABASE_URL'] = process.env['TEST_DATABASE_URL'];
    process.env['PORTAL_TEST_HARNESS_VERIFIED'] = '1';
    if (ejecucionE2e) {
      process.env['PORTAL_TEST_REQUEST_ID_PREFIX'] ??=
        `ps003-test-${randomBytes(16).toString('hex')}-`;
      process.env['PORTAL_TEST_AUTH_HMAC_KEY'] ??= randomBytes(32).toString('base64url');
    }
    await ejecutarComandoAislado();
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

/** Fija NODE_ENV=test y rechaza ejecutar el harness bajo otro entorno declarado. */
function fijarEntornoDePruebas(): void {
  const entornoActual = process.env['NODE_ENV'];
  if (entornoActual !== undefined && entornoActual !== 'test') {
    throw new Error('El harness de PostgreSQL solo admite NODE_ENV=test.');
  }

  process.env['NODE_ENV'] = 'test';
}

/** Valida host SSH, ambos roles PostgreSQL y estado limpio antes de cualquier escritura. */
async function verificarDestinoRemotoPrueba(urlApp: string, urlMigrador: string): Promise<void> {
  verificarTunelSshPrueba();
  const identidadAplicacion = await verificarIdentidadBasePrueba(urlApp, 'portal_test_app');
  const identidadMigrador = await verificarIdentidadBasePrueba(urlMigrador, 'portal_test_migrator');
  validarMismaInstanciaBasePrueba(identidadAplicacion, identidadMigrador);
  await verificarEstadoEsquemaBasePrueba(urlMigrador);
}

/** Impide reportar PASS si la base remota no quedó en su estado migrado y vacío. */
function exigirEstadoMigrado(estado: 'vacio' | 'migrado' | 'migracion-pendiente'): void {
  if (estado !== 'migrado') {
    throw new Error('La ejecución remota no dejó aplicadas las migraciones esperadas.');
  }
}

/** Selecciona Vitest o la prueba acotada de CLI sin ampliar destinos de base de datos. */
async function ejecutarComandoAislado(): Promise<void> {
  const argumentos = process.argv.slice(2).filter((argumento) => argumento !== '--');
  if (argumentos[0] === '--e2e') {
    await ejecutarPruebasE2e(argumentos.slice(1));
    return;
  }

  if (argumentos.length === 1 && argumentos[0] === '--migrate-cli') {
    await ejecutarMigracionCompilada();
    return;
  }

  await ejecutarVitest();
}

/** Migra la base recién creada y ejecuta Chromium real con los mismos datos efímeros. */
async function ejecutarPruebasE2e(argumentos: string[]): Promise<void> {
  await ejecutarMigracionCompilada();
  if (process.env['TEST_DATABASE_MODE'] === 'ssh-tunnel') {
    const configuracion = cargarConfiguracionBasePrueba({ ...process.env, NODE_ENV: 'test' });
    await verificarDestinoRemotoPrueba(
      configuracion.TEST_DATABASE_URL,
      configuracion.TEST_MIGRATOR_DATABASE_URL,
    );
  }
  await ejecutarPlaywright(argumentos);
}

/** Ejecuta la CLI compilada y protegida en el mismo PostgreSQL efímero del harness. */
async function ejecutarMigracionCompilada(): Promise<void> {
  const rutaCli = resolve('apps/api/dist/apps/api/src/db/migrate-cli.js');
  await ejecutarNode(rutaCli, [], {
    ...process.env,
    NODE_ENV: 'test',
    TEST_DATABASE_ROLE: 'portal_test_migrator',
  });
  if (process.env['TEST_DATABASE_MODE'] === 'ssh-tunnel') {
    await concederPermisosAplicacionRemota();
  }
}

/** Concede al rol de ejecución solo el DML de autenticación previsto en la base aislada. */
async function concederPermisosAplicacionRemota(): Promise<void> {
  const variables = { ...process.env, NODE_ENV: 'test' };
  const configuracion = cargarConfiguracionBasePrueba(variables);
  if (configuracion.modo !== 'ssh-tunnel') {
    return;
  }

  const identidadMigrador = await verificarIdentidadBasePrueba(
    configuracion.TEST_MIGRATOR_DATABASE_URL,
    'portal_test_migrator',
  );
  const estado = await verificarEstadoEsquemaBasePrueba(configuracion.TEST_MIGRATOR_DATABASE_URL);
  if (estado !== 'migrado') {
    throw new Error('Solo se conceden permisos después de validar el esquema de prueba migrado.');
  }

  const conexion = postgres(configuracion.TEST_MIGRATOR_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
    queue_timeout: 5,
    connection: {
      application_name: 'portal-ps003-test-grants',
      statement_timeout: 5_000,
      lock_timeout: 2_000,
      idle_in_transaction_session_timeout: 5_000,
    },
  });

  try {
    await conexion.begin(async (transaccion) => {
      await transaccion.unsafe(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE portal.auth_throttle_windows TO portal_test_app',
      );
      await transaccion.unsafe(
        'GRANT SELECT, INSERT, UPDATE ON TABLE portal.users, portal.sessions, portal.recovery_tokens TO portal_test_app',
      );
      await transaccion.unsafe('GRANT INSERT ON TABLE portal.audit_events TO portal_test_app');
      await transaccion.unsafe(
        'GRANT SELECT, UPDATE ON TABLE portal.auth_invariants TO portal_test_app',
      );
      await transaccion.unsafe(
        'REVOKE ALL ON TABLE portal.__drizzle_migrations FROM portal_test_app',
      );
    });
  } finally {
    await conexion.end({ timeout: 5 });
  }

  const identidadAplicacion = await verificarIdentidadBasePrueba(
    configuracion.TEST_DATABASE_URL,
    'portal_test_app',
  );
  validarMismaInstanciaBasePrueba(identidadMigrador, identidadAplicacion);
}

/** Lanza Playwright directamente para no añadir intermediarios de shell. */
async function ejecutarPlaywright(argumentos: string[]): Promise<void> {
  const rutaPlaywright = resolve('node_modules/@playwright/test/cli.js');
  const entornoE2e = { ...process.env };
  await ejecutarNode(
    rutaPlaywright,
    ['test', '--config=playwright.config.ts', '--workers=1', ...argumentos],
    entornoE2e,
  );
}

/** Lanza el archivo ejecutable de Vitest sin envolver la URL ni los argumentos en shell. */
async function ejecutarVitest(): Promise<void> {
  const rutaVitest = resolve('node_modules/vitest/vitest.mjs');
  const argumentos = process.argv.slice(2).filter((argumento) => argumento !== '--');
  const argumentosSinParalelismo = argumentos.filter(
    (argumento) =>
      !argumento.startsWith('--maxWorkers') &&
      argumento !== '--fileParallelism' &&
      argumento !== '--file-parallelism',
  );

  await ejecutarNode(rutaVitest, [
    'run',
    '--config',
    'vitest.integration.config.ts',
    '--maxWorkers=1',
    '--no-file-parallelism',
    ...argumentosSinParalelismo,
  ]);
}

/** Ejecuta Node con variables heredadas o un entorno de prueba acotado. */
async function ejecutarNode(
  archivo: string,
  argumentos: string[],
  entorno: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await new Promise<void>((resolver, rechazar) => {
    const proceso = spawn(process.execPath, [archivo, ...argumentos], {
      stdio: 'inherit',
      env: entorno,
    });

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
          `El proceso de prueba terminó con código ${codigo ?? 1}${senal === null ? '' : ` por ${senal}`}.`,
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
