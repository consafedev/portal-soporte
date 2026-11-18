import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import type {
  RespuestaAltaUsuarioAdmin,
  RespuestaUsuarioAdmin,
  RespuestaUsuarioPublico,
} from '../../packages/contracts/src/auth.js';

const usuarioSoporte: RespuestaUsuarioPublico = {
  id: '018f1000-0000-7000-8000-000000000011',
  username: 'support_e2e',
  displayName: 'Soporte sintético',
  role: 'SUPPORT',
};

const usuarioAdmin: RespuestaUsuarioPublico = {
  id: '018f1000-0000-7000-8000-000000000012',
  username: 'admin_e2e',
  displayName: 'Admin sintético',
  role: 'ADMIN',
};

/** Responde una ruta del API simulado con JSON sintético y estado explícito. */
type ManejadorJsonE2e = (ruta: Route) => Promise<void>;

/**
 * Crea un manejador Playwright para respuestas públicas JSON sin datos reales.
 *
 * @param estado - Código HTTP simulado para la operación de navegador.
 * @param cuerpo - Objeto sintético que debe satisfacer el contrato de la pantalla.
 * @returns Manejador que responde sin guardar ni registrar su contenido.
 */
function crearManejadorJson(estado: number, cuerpo: unknown): ManejadorJsonE2e {
  /** Completa la ruta interceptada con el JSON y estado ya fijados por la prueba. */
  async function responder(ruta: Route): Promise<void> {
    await ruta.fulfill({
      status: estado,
      contentType: 'application/json',
      body: JSON.stringify(cuerpo),
    });
  }

  return responder;
}

/**
 * Registra la respuesta CSRF necesaria para las escrituras de la interfaz.
 *
 * @param pagina - Página aislada de Playwright que enviará la mutación.
 * @returns Token aleatorio de prueba que vive solo en memoria del proceso.
 */
async function interceptarCsrf(pagina: Page): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pagina.route('**/api/v1/auth/csrf', crearManejadorJson(200, { token }));
  return token;
}

/**
 * Comprueba login SUPPORT, error genérico, foco por teclado y cambio propio de contraseña.
 *
 * @param contexto - Fixture de Playwright que proporciona un navegador limpio.
 * @param contexto.page - Página aislada para la persona de soporte sintética.
 * @returns Promesa resuelta al comprobar navegación y reautenticación del cambio propio.
 */
async function probarAccesoSoporteYCambioPropio({ page }: { page: Page }): Promise<void> {
  const tokenCsrf = await interceptarCsrf(page);
  const contrasenaPrueba = randomBytes(24).toString('base64url');
  const contrasenaNueva = randomBytes(24).toString('base64url');
  let intentosLogin = 0;
  let csrfValidoEnCambio = false;

  /** Devuelve primero credenciales inválidas y luego la identidad SUPPORT de prueba. */
  async function responderLogin(ruta: Route): Promise<void> {
    intentosLogin += 1;
    if (intentosLogin === 1) {
      await ruta.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'INVALID_CREDENTIALS',
          message: 'El usuario o la contraseña no son válidos.',
        }),
      });
      return;
    }

    await ruta.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: usuarioSoporte }),
    });
  }

  /** Comprueba el CSRF sin conservar el cuerpo sensible de cambio de contraseña. */
  async function cambiarContrasena(ruta: Route): Promise<void> {
    csrfValidoEnCambio = ruta.request().headers()['x-csrf-token'] === tokenCsrf;
    await ruta.fulfill({ status: 204 });
  }

  await page.route('**/api/v1/auth/login', responderLogin);
  await page.route('**/api/v1/auth/me', crearManejadorJson(200, { user: usuarioSoporte }));
  await page.route('**/api/v1/auth/password', cambiarContrasena);
  await page.goto('/login');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Nombre de usuario')).toBeFocused();
  await page.getByLabel('Nombre de usuario').fill(usuarioSoporte.username);
  await page.getByLabel('Contraseña').fill(contrasenaPrueba);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('#login-error')).toContainText(
    'No fue posible iniciar sesión. Revisa tus datos e inténtalo de nuevo.',
  );

  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/profile\/password$/u);
  await expect(page.getByRole('heading', { name: 'Mi perfil' })).toBeVisible();
  await page.getByLabel('Contraseña actual').first().fill(contrasenaPrueba);
  await page.getByLabel('Contraseña nueva', { exact: true }).fill(contrasenaNueva);
  await page.getByLabel('Confirma la contraseña nueva').fill(contrasenaNueva);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();

  await expect(page.getByRole('status')).toContainText(
    'La contraseña cambió y tus otras sesiones se cerraron.',
  );
  expect(csrfValidoEnCambio).toBe(true);
}

/**
 * Comprueba que SUPPORT no reciba contenido o consultas de administración de usuarios.
 *
 * @param contexto - Fixture aislado de Playwright.
 * @param contexto.page - Página que presenta una sesión SUPPORT vigente.
 * @returns Promesa resuelta tras verificar la denegación de presentación por rol.
 */
async function probarDenegacionVisualSoporte({ page }: { page: Page }): Promise<void> {
  let seConsultaronUsuarios = false;

  /** Registra únicamente si la interfaz intentó listar cuentas protegidas. */
  async function registrarConsultaUsuarios(ruta: Route): Promise<void> {
    seConsultaronUsuarios = true;
    await ruta.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
  }

  await page.route('**/api/v1/auth/me', crearManejadorJson(200, { user: usuarioSoporte }));
  await page.route('**/api/v1/admin/users', registrarConsultaUsuarios);
  await page.goto('/settings/users');

  await expect(
    page.getByRole('heading', { name: 'No tienes permiso para esta pantalla' }),
  ).toBeVisible();
  expect(seConsultaronUsuarios).toBe(false);
}

/**
 * Comprueba que ADMIN pueda invitar y ver una cuenta mediante contratos de respuesta válidos.
 *
 * @param contexto - Fixture aislado de Playwright.
 * @param contexto.page - Página que presenta una sesión ADMIN sintética.
 * @returns Promesa resuelta cuando la invitación aparece en la lista administrativa.
 */
async function probarInvitacionAdministrativa({ page }: { page: Page }): Promise<void> {
  await interceptarCsrf(page);
  const correoPrueba = `usuario-${randomUUID()}@example.test`;
  const nuevaCuenta: RespuestaUsuarioAdmin = {
    ...usuarioSoporte,
    id: '018f1000-0000-7000-8000-000000000013',
    email: correoPrueba,
    emailVerifiedAt: null,
    status: 'PENDING_ACTIVATION',
    hasPassword: false,
    createdAt: new Date().toISOString(),
  };
  let cuentas: readonly RespuestaUsuarioAdmin[] = [];

  /** Devuelve el listado actual sin incluir credenciales ni tokens. */
  async function listarUsuarios(ruta: Route): Promise<void> {
    await ruta.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(cuentas),
    });
  }

  /** Crea una cuenta sintética y comunica el fallo de entrega sin perder el alta. */
  async function crearInvitacion(ruta: Route): Promise<void> {
    cuentas = [nuevaCuenta];
    const resultado: RespuestaAltaUsuarioAdmin = {
      user: nuevaCuenta,
      invitationStatus: 'DELIVERY_FAILED',
    };
    await ruta.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(resultado),
    });
  }

  /** Enruta las lecturas y escrituras de usuarios contra un estado efímero en memoria. */
  async function administrarUsuarios(ruta: Route): Promise<void> {
    if (ruta.request().method() === 'POST') {
      await crearInvitacion(ruta);
      return;
    }

    await listarUsuarios(ruta);
  }

  await page.route('**/api/v1/auth/login', crearManejadorJson(200, { user: usuarioAdmin }));
  await page.route('**/api/v1/auth/me', crearManejadorJson(200, { user: usuarioAdmin }));
  await page.route('**/api/v1/admin/users', administrarUsuarios);
  await page.goto('/login');
  await page.getByLabel('Nombre de usuario').fill(usuarioAdmin.username);
  await page.getByLabel('Contraseña').fill(randomBytes(24).toString('base64url'));
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/settings\/users$/u);
  await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();

  await page.getByLabel('Nombre de usuario').fill(nuevaCuenta.username);
  await page.getByLabel('Nombre visible').fill(nuevaCuenta.displayName);
  await page.getByLabel('Correo').fill(correoPrueba);
  await page.getByRole('button', { name: 'Crear invitación' }).click();

  await expect(page.getByRole('heading', { name: nuevaCuenta.displayName })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Cuentas' }).getByText('Pendiente', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('p.aviso-error')).toContainText(
    'La cuenta se creó, pero no se pudo entregar el enlace.',
  );
}

/** Comprueba que una cuenta deshabilitada con contraseña se reactive como cuenta activa. */
async function probarReactivacionCuentaConCredencial({ page }: { page: Page }): Promise<void> {
  await interceptarCsrf(page);
  const cuentaDeshabilitada: RespuestaUsuarioAdmin = {
    ...usuarioAdmin,
    email: 'admin@example.test',
    emailVerifiedAt: null,
    status: 'DISABLED',
    hasPassword: true,
    createdAt: new Date().toISOString(),
  };
  let estadoCuenta: RespuestaUsuarioAdmin['status'] = 'DISABLED';
  let mensajeConfirmacion = '';
  let seSolicitoInvitacion = false;

  /** Devuelve estado sintético y actualiza solo la mutación de estado esperada. */
  async function administrarCuenta(ruta: Route): Promise<void> {
    if (ruta.request().method() === 'PATCH') {
      const solicitud = ruta.request().postDataJSON() as { status?: string };
      if (solicitud.status === 'ACTIVE') estadoCuenta = 'ACTIVE';
      await ruta.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...cuentaDeshabilitada, status: estadoCuenta }),
      });
      return;
    }

    await ruta.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ ...cuentaDeshabilitada, status: estadoCuenta }]),
    });
  }

  /** Detecta que reactivar una cuenta con contraseña no inicie el flujo de invitación. */
  async function detectarInvitacion(ruta: Route): Promise<void> {
    seSolicitoInvitacion = true;
    await ruta.fulfill({ status: 204 });
  }

  page.on('dialog', async (dialog) => {
    mensajeConfirmacion = dialog.message();
    await dialog.accept();
  });
  await page.route('**/api/v1/auth/login', crearManejadorJson(200, { user: usuarioAdmin }));
  await page.route('**/api/v1/auth/me', crearManejadorJson(200, { user: usuarioAdmin }));
  await page.route('**/api/v1/admin/users', administrarCuenta);
  await page.route('**/api/v1/admin/users/*', administrarCuenta);
  await page.route('**/api/v1/admin/users/*/reset', detectarInvitacion);
  await page.goto('/login');
  await page.getByLabel('Nombre de usuario').fill(usuarioAdmin.username);
  await page.getByLabel('Contraseña').fill(randomBytes(24).toString('base64url'));
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/settings\/users$/u);
  const tarjeta = page.locator('.tarjeta-usuario').filter({
    has: page.getByRole('heading', { name: cuentaDeshabilitada.displayName }),
  });
  await tarjeta.locator('details summary').click();
  await tarjeta.getByRole('button', { name: 'Activar cuenta' }).click();

  await expect(page.locator('.aviso-exito')).toContainText('La cuenta quedó activa.');
  await expect(tarjeta.locator('.etiqueta-estado')).toHaveText('Activa');
  expect(mensajeConfirmacion).toBe('¿Reactivar la cuenta de admin_e2e?');
  expect(estadoCuenta).toBe('ACTIVE');
  expect(seSolicitoInvitacion).toBe(false);
}

/**
 * Comprueba respuesta genérica de recuperación y consumo de enlace sin dejar token en URL.
 *
 * @param contexto - Fixture aislado de Playwright.
 * @param contexto.page - Página que recibe solo valores aleatorios de prueba.
 * @returns Promesa resuelta tras verificar limpieza del fragmento y POST de un solo uso.
 */
async function probarRecuperacionSinFiltrarToken({ page }: { page: Page }): Promise<void> {
  const tokenTemporal = randomBytes(32).toString('base64url');
  const correoSintetico = `recuperacion-${randomUUID()}@example.test`;
  const contrasenaTemporal = randomBytes(24).toString('base64url');
  let tokenEnviadoEnCuerpo = false;
  await interceptarCsrf(page);
  await page.route('**/api/v1/auth/recovery/request', crearManejadorJson(202, { accepted: true }));

  /** Detecta el token únicamente dentro del cuerpo POST, sin imprimir el valor. */
  async function consumirRecuperacion(ruta: Route): Promise<void> {
    tokenEnviadoEnCuerpo = (ruta.request().postData() ?? '').includes(tokenTemporal);
    await ruta.fulfill({ status: 204 });
  }

  await page.goto('/recover-access');
  await page.getByLabel('Correo de tu cuenta').fill(correoSintetico);
  await page.getByRole('button', { name: 'Enviar instrucciones' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Si el correo pertenece a una cuenta activa y verificada, recibirás instrucciones',
  );

  await page.route('**/api/v1/auth/recovery/complete', consumirRecuperacion);
  const fragmento = new URLSearchParams({ flow: 'recovery', token: tokenTemporal });
  await page.goto(`/recover-access/complete#${fragmento.toString()}`);
  await expect(page).toHaveURL('http://127.0.0.1:3000/recover-access/complete');
  expect(!page.url().includes(tokenTemporal)).toBe(true);
  await page.getByLabel('Contraseña nueva', { exact: true }).fill(contrasenaTemporal);
  await page.getByLabel('Confirma la contraseña').fill(contrasenaTemporal);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();

  await expect(page.getByRole('status')).toContainText('La contraseña se actualizó.');
  await expect(page.locator('.auth-panel').getByRole('alert')).toHaveCount(0);
  expect(tokenEnviadoEnCuerpo).toBe(true);
}

test(
  'SUPPORT inicia sesión, recibe error genérico y cambia su contraseña propia',
  probarAccesoSoporteYCambioPropio,
);
test('SUPPORT no carga ni muestra la administración de usuarios', probarDenegacionVisualSoporte);
test('ADMIN invita una cuenta y la ve en su lista', probarInvitacionAdministrativa);
test(
  'ADMIN reactiva cuentas con contraseña sin reenviarlas como invitación',
  probarReactivacionCuentaConCredencial,
);
test(
  'recuperación no enumera correos y envía el token solo en POST',
  probarRecuperacionSinFiltrarToken,
);
