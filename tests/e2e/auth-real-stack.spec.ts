import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Argon2PasswordHasher } from '../../apps/api/src/auth/argon2-password-hasher.js';
import { cargarConfiguracionMigracionPrueba } from '../../apps/api/src/runtime-config.js';
import { crearClienteBaseDatosAuth, type BaseDatosAuth } from '../../apps/api/src/db/client.js';
import { users } from '../../apps/api/src/db/schema.js';

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
let credencialesAdmin: CredencialesE2e;
let credencialesSoporte: CredencialesE2e;

/** Prepara el esquema y dos cuentas aleatorias en la base local creada por el harness. */
test.beforeAll(async () => {
  const urlPrueba = process.env['TEST_DATABASE_URL'];
  if (urlPrueba === undefined) {
    throw new Error('La E2E de autenticación requiere el PostgreSQL efímero del harness.');
  }

  const destino = cargarConfiguracionMigracionPrueba({
    NODE_ENV: 'test',
    TEST_DATABASE_URL: urlPrueba,
  });
  database = crearClienteBaseDatosAuth({
    NODE_ENV: destino.NODE_ENV,
    DATABASE_URL: destino.DATABASE_URL,
  });

  const hasheador = new Argon2PasswordHasher();
  credencialesAdmin = await insertarUsuarioSintetico(database, hasheador, 'ADMIN');
  credencialesSoporte = await insertarUsuarioSintetico(database, hasheador, 'SUPPORT');
});

/** Cierra la conexión directa usada para sembrar identidades en PostgreSQL efímero. */
test.afterAll(async () => {
  if (database !== null) {
    await database.$client.end({ timeout: 5 });
    database = null;
  }
});

/** Inserta una cuenta verificada con credenciales aleatorias y hash Argon2id real. */
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

  return { id, username, password };
}

/** Inicia sesión mediante la interfaz real y espera la ruta correspondiente al rol. */
async function iniciarSesionEnNavegador(
  pagina: Page,
  credenciales: CredencialesE2e,
  rutaDestino: '/settings/users' | '/profile/password',
  tituloDestino: 'Usuarios' | 'Mi perfil',
): Promise<void> {
  await pagina.goto('/login');
  await pagina.getByLabel('Nombre de usuario').fill(credenciales.username);
  await pagina.getByLabel('Contraseña').fill(credenciales.password);
  await pagina.getByRole('button', { name: 'Continuar' }).click();
  await expect(pagina).toHaveURL(new RegExp(`${rutaDestino.replaceAll('/', '\\/')}$`, 'u'));
  await expect(pagina.getByRole('heading', { name: tituloDestino, exact: true })).toBeVisible();
}

/** Obtiene el estado HTTP de una ruta del API a través del proxy same-origin de Next.js. */
async function consultarApiDesdeNavegador(pagina: Page, ruta: string): Promise<number> {
  return pagina.evaluate(async (rutaApi) => {
    const respuesta = await fetch(rutaApi, { cache: 'no-store', credentials: 'same-origin' });
    return respuesta.status;
  }, ruta);
}

/** Comprueba autenticación ADMIN real, listado PostgreSQL y atributos de cookie de sesión. */
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

/** Comprueba que el guard Fastify devuelve 403 después de validar cookie y encabezado CSRF. */
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

/** Verifica el cambio propio de contraseña, su cookie rotada y la revocación remota. */
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
    await expect(page.getByRole('status')).toContainText(
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
    await expect(paginaParalela).toHaveURL(/\/profile\/password$/u);
    await expect(paginaParalela.getByRole('heading', { name: 'Mi perfil' })).toBeVisible();
  } finally {
    await contextoParalelo.close();
  }
});
