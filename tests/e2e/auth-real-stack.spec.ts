import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { expect, test, type Page } from '@playwright/test';
import { Argon2PasswordHasher } from '../../apps/api/src/auth/argon2-password-hasher.js';
import { cargarConfiguracionConexionPrueba } from '../../apps/api/src/runtime-config.js';
import { crearClienteBaseDatosAuth, type BaseDatosAuth } from '../../apps/api/src/db/client.js';
import {
  auditEvents,
  authThrottleWindows,
  clientConnectionProfiles,
  clientSapEnvironments,
  clients,
  recoveryTokens,
  sessions,
  users,
} from '../../apps/api/src/db/schema.js';

const origenPortal = 'http://127.0.0.1:3000';

/** Roles que se prueban con cuentas aleatorias en PostgreSQL efímero. */
type RolE2e = 'ADMIN' | 'SUPPORT';

type CredencialesE2e = {
  /** Identificador aleatorio de una cuenta sin datos personales. */
  readonly id: string;
  /** Nombre de usuario aleatorio válido para las políticas del portal. */
  readonly username: string;
  /** Contraseña aleatoria que vive solo en memoria del proceso de prueba. */
  readonly password: string;
};

let database: BaseDatosAuth | null = null;
let databaseMigrador: BaseDatosAuth | null = null;
let credencialesAdmin: CredencialesE2e;
let credencialesSoporte: CredencialesE2e;
const idsCuentasE2e: string[] = [];
const idsClientesE2e: string[] = [];
const identificadoresLoginE2e = new Set<string>();

/** Prepara el esquema y dos cuentas aleatorias en la base local creada por el harness. */
test.beforeAll(async () => {
  const destino = cargarConfiguracionConexionPrueba(
    { ...process.env, NODE_ENV: 'test' },
    'portal_test_app',
  );
  database = crearClienteBaseDatosAuth({
    ...process.env,
    NODE_ENV: 'test',
    TEST_DATABASE_ROLE: 'portal_test_app',
    DATABASE_URL: destino.DATABASE_URL,
  });
  const destinoMigrador = cargarConfiguracionConexionPrueba(
    { ...process.env, NODE_ENV: 'test', TEST_DATABASE_ROLE: 'portal_test_migrator' },
    'portal_test_migrator',
  );
  databaseMigrador = crearClienteBaseDatosAuth({
    ...process.env,
    NODE_ENV: 'test',
    TEST_DATABASE_ROLE: 'portal_test_migrator',
    DATABASE_URL: destinoMigrador.DATABASE_URL,
  });

  const hasheador = new Argon2PasswordHasher();
  credencialesAdmin = await insertarUsuarioSintetico(database, hasheador, 'ADMIN');
  credencialesSoporte = await insertarUsuarioSintetico(database, hasheador, 'SUPPORT');
});

/** Borra únicamente las cuentas y eventos sintéticos creados por esta ejecución E2E. */
test.afterAll(async () => {
  if (database !== null) {
    if (idsCuentasE2e.length > 0) {
      if (databaseMigrador === null) {
        throw new Error('La limpieza E2E requiere el rol migrador de PostgreSQL de prueba.');
      }
      await databaseMigrador
        .delete(recoveryTokens)
        .where(inArray(recoveryTokens.userId, idsCuentasE2e));
      await databaseMigrador.delete(sessions).where(inArray(sessions.userId, idsCuentasE2e));
      await databaseMigrador
        .delete(auditEvents)
        .where(
          or(
            inArray(auditEvents.actorUserId, idsCuentasE2e),
            inArray(auditEvents.targetUserId, idsCuentasE2e),
            obtenerFiltroAuditoriaE2e(),
          ),
        );
      const hashesIntentos = calcularHashesLimitadorE2e([...identificadoresLoginE2e]);
      if (hashesIntentos.length > 0) {
        await databaseMigrador
          .delete(authThrottleWindows)
          .where(inArray(authThrottleWindows.keyHash, hashesIntentos));
      }
      await databaseMigrador.delete(users).where(inArray(users.id, idsCuentasE2e));
    }

    if (idsClientesE2e.length > 0 && databaseMigrador !== null) {
      await databaseMigrador
        .delete(clientConnectionProfiles)
        .where(inArray(clientConnectionProfiles.clientId, idsClientesE2e));
      await databaseMigrador
        .delete(clientSapEnvironments)
        .where(inArray(clientSapEnvironments.clientId, idsClientesE2e));
      await databaseMigrador.delete(clients).where(inArray(clients.id, idsClientesE2e));
    }

    await databaseMigrador?.$client.end({ timeout: 5 });
    await database.$client.end({ timeout: 5 });
    database = null;
    databaseMigrador = null;
  }
});

/**
 * Inserta una cuenta verificada con credenciales aleatorias y hash Argon2id real.
 * @param baseDatos Cliente de pruebas que inserta la cuenta sintética.
 * @param hasheador Adaptador Argon2id que almacena solo el hash de la clave aleatoria.
 * @param role Rol sintético permitido por la política de autenticación.
 * @returns Identidad de prueba y contraseña efímera conservada solo en memoria.
 * @throws Error si el hasher o la inserción PostgreSQL fallan.
 * @effects Inserta una fila exclusivamente en el esquema `portal` de la base de pruebas.
 */
async function insertarUsuarioSintetico(
  baseDatos: BaseDatosAuth,
  hasheador: Argon2PasswordHasher,
  role: RolE2e,
): Promise<CredencialesE2e> {
  const id = randomUUID();
  const username = `e2e_${role.toLowerCase()}_${randomUUID().replaceAll('-', '')}`;
  const email = `${username}@example.test`;
  const password = randomBytes(32).toString('base64url');
  const ahora = new Date();

  await baseDatos.insert(users).values({
    id,
    username,
    usernameNormalized: username.toLowerCase(),
    displayName: `Cuenta sintética ${role}`,
    email,
    emailNormalized: email.toLowerCase(),
    emailVerifiedAt: ahora,
    passwordHash: await hasheador.hash(password),
    role,
    status: 'ACTIVE',
    createdAt: ahora,
    updatedAt: ahora,
  });
  idsCuentasE2e.push(id);

  return { id, username, password };
}

/**
 * Devuelve un filtro auditado para eventos creados durante esta ejecución E2E.
 * @returns Expresión parametrizada sobre el ID de solicitud sintético de la ejecución.
 * @throws Error si el prefijo requerido por el arnés E2E falta o no es válido.
 * @effects No abre conexiones ni incorpora valores SQL no parametrizados.
 */
function obtenerFiltroAuditoriaE2e(): SQL {
  const prefijo = process.env['PORTAL_TEST_REQUEST_ID_PREFIX'];
  if (prefijo === undefined || !/^ps003-test-[0-9a-f]{32}-$/u.test(prefijo)) {
    throw new Error('La limpieza de auditoría E2E requiere el prefijo aislado de esta ejecución.');
  }
  return sql`${auditEvents.metadata}->>'requestId' LIKE ${`${prefijo}%`}`;
}

/**
 * Inicia sesión mediante la interfaz real y espera la ruta correspondiente al rol.
 * @param pagina Página Chromium que ejecuta el flujo de autenticación.
 * @param credenciales Cuenta sintética de usuario y contraseña aleatoria en memoria.
 * @param rutaDestino Ruta privada esperada para el rol autenticado.
 * @param tituloDestino Encabezado visible que confirma la navegación correcta.
 * @returns Promesa que se resuelve cuando carga la pantalla autorizada.
 * @throws Error de Playwright si el login, el estado visual o la ruta no coinciden.
 * @effects Envía credenciales de prueba al API local a través del proxy same-origin.
 */
async function iniciarSesionEnNavegador(
  pagina: Page,
  credenciales: CredencialesE2e,
  rutaDestino: '/dashboard' | '/settings/users' | '/settings/clients' | '/profile/password',
  tituloDestino: 'Usuarios' | 'Clientes' | 'Mi perfil',
): Promise<void> {
  identificadoresLoginE2e.add(credenciales.username.toLowerCase());
  await pagina.goto('/login');
  await pagina.getByLabel('Nombre de usuario').fill(credenciales.username);
  await pagina.getByLabel('Contraseña').fill(credenciales.password);
  await pagina.getByRole('button', { name: 'Continuar' }).click();
  await expect(pagina).toHaveURL(/\/dashboard$/u);
  await expect(
    pagina.getByRole('heading', { name: /^Hola, Cuenta sintética (ADMIN|SUPPORT)$/u }),
  ).toBeVisible();
  if (rutaDestino !== '/dashboard') {
    const etiquetaEnlace =
      rutaDestino === '/settings/users'
        ? 'Usuarios'
        : rutaDestino === '/settings/clients'
          ? 'Clientes'
          : 'Mi perfil';
    await pagina.getByRole('link', { name: etiquetaEnlace, exact: true }).click();
  }
  await expect(pagina).toHaveURL(new RegExp(`${rutaDestino.replaceAll('/', '\\/')}$`, 'u'));
  await expect(pagina.getByRole('heading', { name: tituloDestino, exact: true })).toBeVisible();
}

/**
 * Obtiene el estado HTTP de una ruta del API a través del proxy same-origin de Next.js.
 * @param pagina Página autenticada o anónima desde la que se consulta.
 * @param ruta Ruta relativa del API dentro del origen de pruebas.
 * @returns Código HTTP observado en la respuesta.
 * @throws Error de Playwright si no puede completarse la solicitud del navegador.
 * @effects Envía una petición GET con credenciales same-origin y sin caché.
 */
async function consultarApiDesdeNavegador(pagina: Page, ruta: string): Promise<number> {
  return pagina.evaluate(async (rutaApi) => {
    const respuesta = await fetch(rutaApi, { cache: 'no-store', credentials: 'same-origin' });
    return respuesta.status;
  }, ruta);
}

/**
 * Deriva solo los hashes HMAC de login creados por esta suite sintética.
 * @param identificadores Nombres de usuario sintéticos usados por los casos E2E.
 * @returns Claves HMAC en memoria compatibles con las ventanas de throttling creadas.
 * @throws Error si falta la clave efímera o no cumple 256 bits.
 * @effects No retorna identificadores originales ni persiste la clave HMAC.
 */
function calcularHashesLimitadorE2e(identificadores: readonly string[]): string[] {
  const claveConfigurada = process.env['PORTAL_TEST_AUTH_HMAC_KEY'];
  if (claveConfigurada === undefined) {
    throw new Error('Falta la clave efímera del limitador E2E.');
  }
  const claveHmac = Buffer.from(claveConfigurada, 'base64url');
  if (claveHmac.length < 32) {
    throw new Error('La clave efímera del limitador E2E no cumple la longitud mínima.');
  }
  const claves = new Set<string>();
  const direccionIp = '127.0.0.1';
  for (const identificador of identificadores) {
    for (const [alcance, valor] of [
      ['LOGIN_ACCOUNT', identificador],
      ['LOGIN_NETWORK', ''],
    ] as const) {
      const material = `${alcance}\0${valor.length}:${valor}\0${direccionIp.length}:${direccionIp}`;
      claves.add(createHmac('sha256', claveHmac).update(material, 'utf8').digest('hex'));
    }
  }

  return [...claves];
}

/**
 * Comprueba autenticación ADMIN real, listado PostgreSQL y atributos de cookie de sesión.
 * @param fixtures Fixture de Playwright con página y contexto Chromium.
 * @returns Promesa que termina tras validar autenticación, listado y cookie.
 * @throws Error si la página, el API o los atributos de cookie incumplen el contrato.
 * @effects Consulta el API a través del proxy y usa cuentas sintéticas de PostgreSQL.
 */
test('ADMIN inicia sesión, ve cuentas persistidas y recibe cookie HttpOnly', async ({
  page,
  context,
}) => {
  await iniciarSesionEnNavegador(page, credencialesAdmin, '/settings/users', 'Usuarios');
  await expect(page.getByText(`@${credencialesAdmin.username}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`@${credencialesSoporte.username}`, { exact: true })).toBeVisible();

  const cookie = (await context.cookies(origenPortal)).find(
    (entrada) => entrada.name === 'portal_test_session',
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');
  expect(cookie?.secure).toBe(false);
  expect(await consultarApiDesdeNavegador(page, '/api/v1/auth/me')).toBe(200);
});

/**
 * Comprueba que el guard Fastify devuelve 403 después de validar cookie y encabezado CSRF.
 * @param fixtures Fixture de Playwright con la página de usuario SUPPORT.
 * @returns Promesa que se resuelve tras verificar el código 403 de autorización.
 * @throws Error si CSRF no se acepta o el backend no deniega la operación administrativa.
 * @effects Envía una escritura protegida únicamente contra la API de pruebas aislada.
 */
test('SUPPORT recibe 403 del backend en una escritura que sí supera CSRF', async ({ page }) => {
  await iniciarSesionEnNavegador(page, credencialesSoporte, '/profile/password', 'Mi perfil');

  const respuesta = await page.evaluate(async (idUsuario) => {
    const respuestaCsrf = await fetch('/api/v1/auth/csrf', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const csrf = (await respuestaCsrf.json()) as { token: string };
    const resultado = await fetch(`/api/v1/admin/users/${idUsuario}/sessions/revoke`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrf.token },
    });
    const cuerpo = (await resultado.json()) as { code?: string };
    return { status: resultado.status, code: cuerpo.code ?? null };
  }, credencialesSoporte.id);

  expect(respuesta.status).toBe(403);
  expect(respuesta.code).toBe('FORBIDDEN');
});

/**
 * Verifica el cambio propio de contraseña, su cookie rotada y la revocación remota.
 * @param fixtures Fixture Playwright con página principal y navegador de Chromium.
 * @returns Promesa que finaliza tras confirmar el cierre de la sesión paralela.
 * @throws Error si el cambio propio, la revocación o el nuevo login no coinciden.
 * @effects Cambia una contraseña sintética y crea una sesión paralela en la base aislada.
 */
test('SUPPORT cambia su contraseña y el otro navegador queda revocado', async ({
  page,
  browser,
}) => {
  const contextoParalelo = await browser.newContext();
  try {
    const paginaParalela = await contextoParalelo.newPage();
    await iniciarSesionEnNavegador(page, credencialesSoporte, '/profile/password', 'Mi perfil');
    await iniciarSesionEnNavegador(
      paginaParalela,
      credencialesSoporte,
      '/profile/password',
      'Mi perfil',
    );

    const sesionAnterior = (await page.context().cookies(origenPortal)).find(
      (entrada) => entrada.name === 'portal_test_session',
    )?.value;
    const nuevaContrasena = randomBytes(32).toString('base64url');
    await page.getByLabel('Contraseña actual').first().fill(credencialesSoporte.password);
    await page.getByLabel('Contraseña nueva', { exact: true }).fill(nuevaContrasena);
    await page.getByLabel('Confirma la contraseña nueva').fill(nuevaContrasena);
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.locator('.aviso-exito')).toContainText(
      'La contraseña cambió y tus otras sesiones se cerraron.',
    );

    const sesionActual = (await page.context().cookies(origenPortal)).find(
      (entrada) => entrada.name === 'portal_test_session',
    )?.value;
    expect(typeof sesionActual === 'string' && sesionActual !== sesionAnterior).toBe(true);
    expect(await consultarApiDesdeNavegador(page, '/api/v1/auth/me')).toBe(200);
    expect(await consultarApiDesdeNavegador(paginaParalela, '/api/v1/auth/me')).toBe(401);

    await paginaParalela.goto('/login');
    await paginaParalela.getByLabel('Nombre de usuario').fill(credencialesSoporte.username);
    await paginaParalela.getByLabel('Contraseña').fill(credencialesSoporte.password);
    await paginaParalela.getByRole('button', { name: 'Continuar' }).click();
    await expect(paginaParalela.locator('#login-error')).toBeVisible();

    await paginaParalela.getByLabel('Contraseña').fill(nuevaContrasena);
    await paginaParalela.getByRole('button', { name: 'Continuar' }).click();
    await expect(paginaParalela).toHaveURL(/\/dashboard$/u);
    await expect(
      paginaParalela.getByRole('heading', { name: 'Hola, Cuenta sintética SUPPORT', exact: true }),
    ).toBeVisible();
    await paginaParalela.getByRole('link', { name: 'Mi perfil', exact: true }).click();
    await expect(paginaParalela).toHaveURL(/\/profile\/password$/u);
    await expect(paginaParalela.getByRole('heading', { name: 'Mi perfil' })).toBeVisible();
  } finally {
    await contextoParalelo.close();
  }
});

/** Comprueba que el formulario borre el secreto cuando el keyring no está disponible. */
test('ADMIN ve los controles de conexión y el formulario elimina el secreto sin keyring', async ({
  page,
}) => {
  await iniciarSesionEnNavegador(page, credencialesAdmin, '/settings/clients', 'Clientes');
  const nombreCliente = `Cliente conexión ${randomUUID().slice(0, 8)}`;
  const secretoSintetico = randomBytes(32).toString('base64url');
  await page.getByLabel('Nombre del cliente').fill(nombreCliente);
  await page.getByRole('button', { name: 'Guardar cliente' }).click();
  const tarjeta = page.getByRole('article', { name: nombreCliente });
  await expect(tarjeta).toBeVisible();
  if (database === null) {
    throw new Error('La limpieza E2E requiere la conexión a PostgreSQL de pruebas.');
  }
  const clienteGuardado = await database
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.displayName, nombreCliente));
  const clientId = clienteGuardado[0]?.id;
  if (clientId === undefined) {
    throw new Error('El formulario no dejó un cliente sintético para limpiar.');
  }
  idsClientesE2e.push(clientId);
  await tarjeta.getByText('Editar y administrar ambientes SAP').click();
  await tarjeta.getByText('Conexiones MySQL', { exact: true }).click();
  await expect(tarjeta.getByLabel('MySQL Hostname')).toBeVisible();
  await expect(tarjeta.getByLabel('MySQL Port')).toBeVisible();
  await expect(tarjeta.getByLabel('Usuario MySQL')).toBeVisible();
  await tarjeta.getByLabel('Nombre del perfil').focus();
  await expect(tarjeta.getByLabel('Nombre del perfil')).toBeFocused();

  const botonTemaOscuro = page.getByRole('button', { name: 'Cambiar a tema oscuro' });
  if (await botonTemaOscuro.count()) {
    await botonTemaOscuro.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: join(tmpdir(), 'portal-soporte-ps005-2-clientes-desktop-sintetico.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(tmpdir(), 'portal-soporte-ps005-2-clientes-movil-sintetico.png'),
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1280, height: 900 });

  await tarjeta.getByLabel('Nombre del perfil').fill('Perfil sintético');
  await tarjeta.getByLabel('MySQL Hostname').fill('destino-sin-configurar.example.test');
  await tarjeta.getByLabel('MySQL Port').fill('3306');
  await tarjeta.getByLabel('Base MySQL').fill('base_sintetica');
  await tarjeta.getByLabel('Usuario MySQL').fill('usuario_sintetico');
  await tarjeta.getByLabel('Contraseña MySQL').fill(secretoSintetico);
  await tarjeta.getByRole('button', { name: 'Guardar perfil' }).click();

  await expect(tarjeta.getByRole('alert')).toContainText(
    'La custodia segura todavía no está configurada',
  );
  await expect(tarjeta.getByLabel('Contraseña MySQL')).toHaveValue('');
  expect(await page.locator('body').innerText()).not.toContain(secretoSintetico);
  expect(await page.locator('body').innerText()).not.toContain('password-sintetico');
});
