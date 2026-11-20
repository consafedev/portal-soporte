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
  await expect(page.getByRole('button', { name: 'Cambiar a tema oscuro' })).toBeFocused();
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
  await expect(
    page.getByRole('heading', { name: 'Hola, Soporte sintético', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Mi perfil', exact: true }).click();
  await expect(page).toHaveURL(/\/profile\/password$/u);
  await expect(page.getByRole('heading', { name: 'Mi perfil' })).toBeVisible();
  await page.getByLabel('Contraseña actual').first().fill(contrasenaPrueba);
  await page.getByLabel('Contraseña nueva', { exact: true }).fill(contrasenaNueva);
  await page.getByLabel('Confirma la contraseña nueva').fill(contrasenaNueva);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();

  await expect(page.locator('.aviso-exito')).toContainText(
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
 * Valida navegación, foco, contraste, tema y ajuste móvil con identidad sintética.
 *
 * @param contexto - Fixture de navegador aislado de Playwright.
 * @param contexto.page - Página con API simulada y usuario SUPPORT ficticio.
 * @returns Promesa resuelta después de comprobar los estados visuales y accesibles.
 */
async function probarDashboardAccesibleYResponsivo({ page }: { page: Page }): Promise<void> {
  const tokenCsrf = await interceptarCsrf(page);
  let temaGuardado = 'system';
  let seValidoCsrf = false;

  /**
   * Lee o persiste un tema sintético y verifica CSRF en la escritura del perfil.
   *
   * @param ruta - Solicitud a preferencias capturada por Playwright.
   * @returns Promesa resuelta tras responder con el tema sintético vigente.
   * @effects Actualiza el estado en memoria de la prueba, nunca una cuenta real.
   */
  async function manejarPreferenciaTema(ruta: Route): Promise<void> {
    if (ruta.request().method() === 'GET') {
      await ruta.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ theme: temaGuardado }),
      });
      return;
    }

    const solicitud = ruta.request().postDataJSON() as { theme: string };
    seValidoCsrf = ruta.request().headers()['x-csrf-token'] === tokenCsrf;
    temaGuardado = solicitud.theme;
    await ruta.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ theme: temaGuardado }),
    });
  }

  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.route('**/api/v1/auth/login', crearManejadorJson(200, { user: usuarioSoporte }));
  await page.route('**/api/v1/auth/me', crearManejadorJson(200, { user: usuarioSoporte }));
  await page.route('**/api/v1/me/preferences', manejarPreferenciaTema);
  await page.goto('/login');
  await page.getByLabel('Nombre de usuario').fill(usuarioSoporte.username);
  await page.getByLabel('Contraseña').fill(randomBytes(24).toString('base64url'));
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expect(page).toHaveURL(/\/dashboard$/u);
  await expect(
    page.getByRole('heading', { name: 'Hola, Soporte sintético', exact: true }),
  ).toBeVisible();
  // Evita que la insignia exclusiva de desarrollo contamine la evidencia visual del producto.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await expect(
    page.locator('.pagina-dashboard').locator('section, canvas, table, svg'),
  ).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await expect(nav.getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
  await page.getByRole('link', { name: 'e-Billia, Portal de Soporte' }).focus();
  await page.keyboard.press('Tab');
  await expect(nav.getByRole('link', { name: 'Inicio', exact: true })).toBeFocused();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: '.superpowers/sdd/2026-11-19-deploy-002-publicacion/dashboard-ps004-sintetico.png',
  });

  const duracionTransicionTema = await page
    .locator('.boton-cambiar-tema svg')
    .first()
    .evaluate((icono) => getComputedStyle(icono).transitionDuration);
  expect(Number.parseFloat(duracionTransicionTema)).toBeGreaterThan(0);

  const botonTemaOscuro = page.getByRole('button', { name: 'Cambiar a tema oscuro' });
  await expect(botonTemaOscuro).toHaveAttribute('aria-pressed', 'false');
  await botonTemaOscuro.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Cambiar a tema claro' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(temaGuardado).toBe('dark');
  expect(seValidoCsrf).toBe(true);

  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 360, height: 780 });
  const estadoVisual = await page.evaluate(() => ({
    anchoSinDesborde: document.documentElement.scrollWidth <= window.innerWidth,
    fondoOscuro:
      getComputedStyle(document.documentElement).getPropertyValue('--fondo').trim() === '#0f141c',
    movimientoReducido: matchMedia('(prefers-reduced-motion: reduce)').matches,
    transicionTema: getComputedStyle(document.querySelector('.boton-cambiar-tema svg') as Element)
      .transitionDuration,
  }));

  expect(estadoVisual.anchoSinDesborde).toBe(true);
  expect(estadoVisual.fondoOscuro).toBe(true);
  expect(estadoVisual.movimientoReducido).toBe(true);
  expect(Number.parseFloat(estadoVisual.transicionTema)).toBeLessThan(0.001);
  await page.getByRole('button', { name: 'Cambiar a tema claro' }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({
    path: '.superpowers/sdd/2026-11-19-deploy-002-publicacion/dashboard-ps004-movil.png',
  });
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
  await expect(
    page.getByRole('heading', { name: 'Hola, Admin sintético', exact: true }),
  ).toBeVisible();
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

/**
 * Comprueba tema persistido, teclado, contraste y la limitación visible de SMTP.
 *
 * @param contexto - Fixture aislado de Playwright.
 * @param contexto.page - Página con API sintética y usuario SUPPORT ficticio.
 * @returns Promesa resuelta tras validar persistencia y presentación del perfil.
 */
async function probarPreferenciasPersonales({ page }: { page: Page }): Promise<void> {
  const tokenCsrf = await interceptarCsrf(page);
  let temaGuardado = 'system';
  let seValidaronCsrf = false;

  /** Devuelve la preferencia sintética o guarda el tema elegido desde el formulario. */
  async function manejarPreferencias(ruta: Route): Promise<void> {
    if (ruta.request().method() === 'GET') {
      if (page.url().endsWith('/login')) {
        await ruta.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
        return;
      }
      await ruta.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ theme: temaGuardado }),
      });
      return;
    }

    const solicitud = ruta.request().postDataJSON() as { theme: string };
    seValidaronCsrf = ruta.request().headers()['x-csrf-token'] === tokenCsrf;
    temaGuardado = solicitud.theme;
    await ruta.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ theme: temaGuardado }),
    });
  }

  /** Simula una sesión válida en el perfil y una sesión ausente en la pantalla pública. */
  async function manejarIdentidad(ruta: Route): Promise<void> {
    if (page.url().endsWith('/login')) {
      await ruta.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      return;
    }
    await ruta.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: usuarioSoporte }),
    });
  }

  await page.route('**/api/v1/auth/me', manejarIdentidad);
  await page.route('**/api/v1/me/preferences', manejarPreferencias);
  await page.goto('/profile/password');

  await expect(page.getByRole('heading', { name: 'Apariencia' })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'El cambio de correo está deshabilitado' }),
  ).toBeVisible();
  await expect(page.getByLabel('Correo nuevo')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  expect(await obtenerContrasteTextoPreferencias(page)).toBeGreaterThanOrEqual(4.5);
  const opcionOscura = page.getByRole('radio', { name: /^Oscuro/u });
  await opcionOscura.focus();
  await expect(opcionOscura).toBeFocused();
  await page.keyboard.press('Space');
  await expect(opcionOscura).toBeChecked();
  await page.getByRole('button', { name: 'Guardar apariencia' }).click();
  await expect(page.locator('.aviso-exito')).toContainText('Preferencia guardada.');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(seValidaronCsrf).toBe(true);
  expect(await obtenerContrasteTextoPreferencias(page)).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({
    path: '.superpowers/sdd/2026-11-19-deploy-002-publicacion/perfil-ps004-sintetico.png',
  });

  await page.reload();
  await expect(page.getByLabel('Oscuro')).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('portal-soporte-theme'))).toBe('dark');
  await page.setViewportSize({ width: 360, height: 780 });
  await page.screenshot({
    path: '.superpowers/sdd/2026-11-19-deploy-002-publicacion/perfil-ps004-movil-sintetico.png',
  });
  const estadoVisual = await page.evaluate(() => ({
    sinDesbordamiento: document.documentElement.scrollWidth <= window.innerWidth,
    temaOscuro: getComputedStyle(document.documentElement).getPropertyValue('--fondo').trim(),
    movimientoReducido: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }));
  expect(estadoVisual.sinDesbordamiento).toBe(true);
  expect(estadoVisual.temaOscuro).toBe('#0f141c');
  expect(estadoVisual.movimientoReducido).toBe(true);

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Inicia sesión' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Cambiar a tema claro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('portal-soporte-theme'))).toBe('light');
  await page.getByRole('button', { name: 'Cambiar a tema oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('portal-soporte-theme'))).toBe('dark');
}

/**
 * Lee el contraste real del texto secundario sobre la opción visible del formulario.
 *
 * @param page - Página de Playwright con el perfil sintético abierto.
 * @returns Proporción WCAG del texto secundario sobre su superficie.
 */
async function obtenerContrasteTextoPreferencias(page: Page): Promise<number> {
  const colores = await page.evaluate(leerColoresCssPreferencias);

  if (colores === null) {
    throw new Error('No se pudo identificar el texto de la opción de apariencia.');
  }

  return calcularContrasteWcag(colores.texto, colores.fondo);
}

/** Lee colores computados del formulario, sin recoger etiquetas ni contenido de cuenta. */
function leerColoresCssPreferencias(): { texto: string; fondo: string } | null {
  const texto = document.querySelector('.opcion-tema .texto-secundario');
  const opcion = texto?.closest('.opcion-tema');
  if (texto === null || opcion === null || opcion === undefined) return null;
  return {
    texto: getComputedStyle(texto).color,
    fondo: getComputedStyle(opcion).backgroundColor,
  };
}

/**
 * Calcula la proporción WCAG 2.1 entre colores CSS RGB de texto y superficie.
 *
 * @param colorTexto - Color CSS computado del texto secundario.
 * @param colorFondo - Color CSS computado de la opción que lo contiene.
 * @returns Relación de contraste que se compara con el mínimo de texto normal.
 */
function calcularContrasteWcag(colorTexto: string, colorFondo: string): number {
  const luminanciaTexto = calcularLuminanciaRelativa(colorTexto);
  const luminanciaFondo = calcularLuminanciaRelativa(colorFondo);
  const luminanciaMayor = Math.max(luminanciaTexto, luminanciaFondo);
  const luminanciaMenor = Math.min(luminanciaTexto, luminanciaFondo);
  return (luminanciaMayor + 0.05) / (luminanciaMenor + 0.05);
}

/**
 * Convierte el triplete CSS RGB a luminancia relativa con la curva sRGB de WCAG.
 *
 * @param colorCss - Valor RGB computado por el navegador.
 * @returns Luminancia relativa lineal del color.
 * @throws Error si el navegador no devuelve tres canales RGB.
 */
function calcularLuminanciaRelativa(colorCss: string): number {
  const canales = colorCss
    .match(/\d+(?:\.\d+)?/gu)
    ?.slice(0, 3)
    .map(Number);
  const [rojo, verde, azul] = canales ?? [];
  if (rojo === undefined || verde === undefined || azul === undefined) {
    throw new Error('El color CSS de la preferencia no es un triplete RGB válido.');
  }

  return (
    0.2126 * linealizarCanalSrgb(rojo) +
    0.7152 * linealizarCanalSrgb(verde) +
    0.0722 * linealizarCanalSrgb(azul)
  );
}

/**
 * Normaliza un canal sRGB de 8 bits y aplica su tramo lineal o potencia.
 *
 * @param canal - Intensidad CSS entre cero y 255.
 * @returns Componente sRGB lineal para la luminancia WCAG.
 */
function linealizarCanalSrgb(canal: number): number {
  const normalizado = canal / 255;
  return normalizado <= 0.04045 ? normalizado / 12.92 : ((normalizado + 0.055) / 1.055) ** 2.4;
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
test(
  'ADMIN y SUPPORT conservan tema personal y no ofrecen cambio de correo sin SMTP',
  probarPreferenciasPersonales,
);
