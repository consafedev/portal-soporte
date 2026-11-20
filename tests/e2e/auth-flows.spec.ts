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
  await expect(page).toHaveURL(/\/dashboard$/u);
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Mi contraseña', exact: true }).click();
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

/** Valida navegación, foco, contraste y ajuste móvil del dashboard con identidad sintética. */
async function probarDashboardAccesibleYResponsivo({ page }: { page: Page }): Promise<void> {
  await page.route('**/api/v1/auth/login', crearManejadorJson(200, { user: usuarioSoporte }));
  await page.route('**/api/v1/auth/me', crearManejadorJson(200, { user: usuarioSoporte }));
  await page.goto('/login');
  await page.getByLabel('Nombre de usuario').fill(usuarioSoporte.username);
  await page.getByLabel('Contraseña').fill(randomBytes(24).toString('base64url'));
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expect(page).toHaveURL(/\/dashboard$/u);
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await expect(nav.getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
  await page.getByRole('link', { name: 'e-Billia, Portal de Soporte' }).focus();
  await page.keyboard.press('Tab');
  await expect(nav.getByRole('link', { name: 'Inicio', exact: true })).toBeFocused();

  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: '.superpowers/sdd/2026-11-19-deploy-002-publicacion/dashboard-ps004-sintetico.png',
  });

  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 360, height: 780 });
  const estadoVisual = await page.evaluate(() => ({
    anchoSinDesborde: document.documentElement.scrollWidth <= window.innerWidth,
    fondoOscuro:
      getComputedStyle(document.documentElement).getPropertyValue('--fondo').trim() === '#0f141c',
    movimientoReducido: matchMedia('(prefers-reduced-motion: reduce)').matches,
    transicionAcceso: getComputedStyle(document.querySelector('.enlace-acceso') as Element)
      .transitionDuration,
  }));

  expect(estadoVisual.anchoSinDesborde).toBe(true);
  expect(estadoVisual.fondoOscuro).toBe(true);
  expect(estadoVisual.movimientoReducido).toBe(true);
  expect(estadoVisual.transicionAcceso).not.toBe('120ms');
}

/**
 * Comprueba que ADMIN cree una cuenta directa sin SMTP ni filtrar la contraseña inicial.
 *
 * @param contexto - Fixture aislado de Playwright.
 * @param contexto.page - Página que presenta una sesión ADMIN sintética.
 * @returns Promesa resuelta tras verificar el alta, la respuesta segura y el estado activo.
 */
async function probarAltaDirectaAdministrativa({ page }: { page: Page }): Promise<void> {
  await interceptarCsrf(page);
  const correoPrueba = `usuario-${randomUUID()}@example.test`;
  const contrasenaInicial = randomBytes(24).toString('base64url');
  const nuevaCuenta: RespuestaUsuarioAdmin = {
    ...usuarioSoporte,
    id: '018f1000-0000-7000-8000-000000000013',
    email: correoPrueba,
    emailVerifiedAt: null,
    status: 'ACTIVE',
    hasPassword: true,
    createdAt: new Date().toISOString(),
  };
  let cuentas: readonly RespuestaUsuarioAdmin[] = [];
  let seEnvioClaveInicial = false;

  /** Devuelve el listado actual sin incluir credenciales ni tokens. */
  async function listarUsuarios(ruta: Route): Promise<void> {
    await ruta.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(cuentas),
    });
  }

  /** Crea una cuenta sintética y responde solo con el estado público de su credencial. */
  async function crearCuenta(ruta: Route): Promise<void> {
    const cuerpo = ruta.request().postDataJSON() as { initialPassword?: string };
    seEnvioClaveInicial = cuerpo.initialPassword === contrasenaInicial;
    cuentas = [nuevaCuenta];
    const resultado: RespuestaAltaUsuarioAdmin = {
      user: nuevaCuenta,
      credentialStatus: 'SET_BY_ADMIN',
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
      await crearCuenta(ruta);
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
  await expect(page).toHaveURL(/\/dashboard$/u);
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await page.getByRole('link', { name: 'Usuarios' }).click();
  await expect(page).toHaveURL(/\/settings\/users$/u);
  await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();

  await page.getByLabel('Nombre de usuario').fill(nuevaCuenta.username);
  await page.getByLabel('Nombre visible').fill(nuevaCuenta.displayName);
  await page.getByLabel('Correo de referencia').fill(correoPrueba);
  await page.getByLabel('Contraseña inicial', { exact: true }).fill(contrasenaInicial);
  await page.getByLabel('Confirmar contraseña inicial', { exact: true }).fill(contrasenaInicial);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(page.getByRole('heading', { name: nuevaCuenta.displayName })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Cuentas' }).getByText('Activa', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(
    'Cuenta creada. Comparte la contraseña inicial por un canal seguro.',
  );
  expect(seEnvioClaveInicial).toBe(true);
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
  await expect(page).toHaveURL(/\/dashboard$/u);
  await page.getByRole('link', { name: 'Usuarios' }).click();
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
 * Comprueba que los flujos dependientes del correo indiquen su indisponibilidad sin llamar al API.
 *
 * @param contexto - Fixture aislado de Playwright.
 * @param contexto.page - Página que navega por las pantallas de autenticación.
 * @returns Promesa resuelta tras verificar que los formularios de correo están desactivados.
 */
async function probarRecuperacionPorCorreoDeshabilitada({ page }: { page: Page }): Promise<void> {
  let seSolicitoRecuperacion = false;

  /**
   * Registra una petición inesperada sin inspeccionar ni imprimir su cuerpo.
   *
   * @param ruta - Solicitud interceptada por Playwright.
   * @returns Promesa resuelta tras responder con el estado deshabilitado.
   */
  async function registrarSolicitudRecuperacion(ruta: Route): Promise<void> {
    seSolicitoRecuperacion = true;
    await ruta.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  }

  await page.route('**/api/v1/auth/recovery/request', registrarSolicitudRecuperacion);
  await page.goto('/login');
  await expect(page.getByRole('link', { name: '¿Necesitas recuperar el acceso?' })).toHaveCount(0);
  await expect(
    page.getByText('Contacta con una persona administradora para restablecer tu acceso.'),
  ).toBeVisible();

  await page.goto('/recover-access');
  await expect(
    page.getByRole('heading', { name: 'Recuperación por correo deshabilitada' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Contacta con una persona administradora para restablecer tu acceso.',
  );
  await expect(page.getByLabel('Correo de tu cuenta')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enviar instrucciones' })).toHaveCount(0);
  expect(seSolicitoRecuperacion).toBe(false);

  await page.goto('/recover-access/complete#flow=recovery&token=token-sintetico-no-valido');
  await expect(
    page.getByRole('heading', { name: 'Recuperación por correo deshabilitada' }),
  ).toBeVisible();
  await expect(page.getByLabel('Contraseña nueva')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Guardar contraseña' })).toHaveCount(0);
}

test(
  'SUPPORT inicia sesión, recibe error genérico y cambia su contraseña propia',
  probarAccesoSoporteYCambioPropio,
);
test('SUPPORT no carga ni muestra la administración de usuarios', probarDenegacionVisualSoporte);
test(
  'dashboard conserva teclado, contraste, movimiento reducido y formato móvil',
  probarDashboardAccesibleYResponsivo,
);
test('ADMIN crea una cuenta directa y la ve en su lista', probarAltaDirectaAdministrativa);
test(
  'ADMIN reactiva cuentas con contraseña sin reenviarlas como invitación',
  probarReactivacionCuentaConCredencial,
);
test(
  'recuperación por correo queda deshabilitada sin SMTP',
  probarRecuperacionPorCorreoDeshabilitada,
);
