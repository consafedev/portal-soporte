import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Route } from '@playwright/test';
import type { RespuestaUsuarioPublico } from '../../../packages/contracts/src/auth.js';
import type {
  AmbienteSapClienteAdminContrato,
  ClienteAdminContrato,
  PerfilConexionAdminContrato,
} from '../../../packages/contracts/src/clients.js';

const administradorVisual: RespuestaUsuarioPublico = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  username: 'admin_visual_sintetico',
  displayName: 'Administración sintética',
  role: 'ADMIN',
};

const clienteVisual: ClienteAdminContrato = {
  id: '550e8400-e29b-41d4-a716-446655440020',
  nombre: 'Cliente visual sintético',
  estado: 'ACTIVE',
  createdAt: '2026-11-21T00:00:00.000Z',
  updatedAt: '2026-11-21T00:00:00.000Z',
};

const perfilVisual: PerfilConexionAdminContrato = {
  id: '550e8400-e29b-41d4-a716-446655440030',
  clientId: clienteVisual.id,
  nombre: 'Perfil visual sintético',
  tipo: 'MYSQL_TCP',
  entorno: 'TEST',
  destinoMySqlId: 'destino-visual',
  gatewaySshId: null,
  baseDatos: 'base_visual',
  estado: 'ACTIVE',
  createdAt: '2026-11-21T00:00:00.000Z',
  updatedAt: '2026-11-21T00:00:00.000Z',
};

const ambienteVisual: AmbienteSapClienteAdminContrato = {
  id: '550e8400-e29b-41d4-a716-446655440040',
  clientId: clienteVisual.id,
  codigo: 'PRUEBAS_VISUAL',
  nombre: 'Ambiente SAP sintético',
  estado: 'ACTIVE',
  createdAt: '2026-11-21T00:00:00.000Z',
  updatedAt: '2026-11-21T00:00:00.000Z',
};

/** Responde una ruta con JSON fijo de prueba sin consultar servicios externos. */
function respuestaJson(cuerpo: unknown, estado: number = 200) {
  /** Finaliza la respuesta de Playwright con datos sintéticos no persistentes. */
  return async function responder(ruta: Route): Promise<void> {
    await ruta.fulfill({
      status: estado,
      contentType: 'application/json',
      body: JSON.stringify(cuerpo),
    });
  };
}

/** Sirve la lista de clientes y perfiles simulados sin acceder a servicios o datos persistentes. */
async function responderCatalogos(
  ruta: Route,
  estado: {
    perfiles: PerfilConexionAdminContrato[];
    resultadosPrueba: number;
    solicitudesCredenciales: unknown[];
  },
): Promise<void> {
  const url = new URL(ruta.request().url());
  const metodo = ruta.request().method();
  if (url.pathname.endsWith('/connection-profiles') && metodo === 'GET') {
    await respuestaJson(estado.perfiles)(ruta);
    return;
  }
  if (url.pathname.endsWith('/connection-profiles') && metodo === 'POST') {
    const solicitud = ruta.request().postDataJSON() as Record<string, unknown>;
    estado.solicitudesCredenciales.push(solicitud['credenciales']);
    const perfilCreado: PerfilConexionAdminContrato = {
      ...perfilVisual,
      id: '550e8400-e29b-41d4-a716-446655440031',
      nombre: String(solicitud['nombre']),
      tipo: solicitud['tipo'] === 'MYSQL_SSH' ? 'MYSQL_SSH' : 'MYSQL_TCP',
      entorno: solicitud['entorno'] === 'PRODUCTION' ? 'PRODUCTION' : 'TEST',
      destinoMySqlId: String(solicitud['destinoMySqlId']),
      gatewaySshId:
        typeof solicitud['gatewaySshId'] === 'string' ? solicitud['gatewaySshId'] : null,
      baseDatos: String(solicitud['baseDatos']),
    };
    estado.perfiles.push(perfilCreado);
    await respuestaJson(perfilCreado, 201)(ruta);
    return;
  }
  if (url.pathname.endsWith('/credentials') && metodo === 'PUT') {
    estado.solicitudesCredenciales.push(ruta.request().postDataJSON());
    await respuestaJson(estado.perfiles.at(-1) ?? perfilVisual)(ruta);
    return;
  }
  if (/\/connection-profiles\/[0-9a-f-]+$/iu.test(url.pathname) && metodo === 'PATCH') {
    const cambios = ruta.request().postDataJSON() as Record<string, unknown>;
    const perfilActualizado: PerfilConexionAdminContrato = {
      ...(estado.perfiles.at(-1) ?? perfilVisual),
      nombre: typeof cambios['nombre'] === 'string' ? cambios['nombre'] : perfilVisual.nombre,
      updatedAt: '2026-11-21T00:01:00.000Z',
    };
    estado.perfiles[estado.perfiles.length - 1] = perfilActualizado;
    await respuestaJson(perfilActualizado)(ruta);
    return;
  }
  if (url.pathname.endsWith('/test') && metodo === 'POST') {
    estado.resultadosPrueba += 1;
    await respuestaJson({
      code: estado.resultadosPrueba === 1 ? 'CONNECTED' : 'MYSQL_TLS_FAILED',
      completedAt: '2026-11-21T00:00:00.000Z',
    })(ruta);
    return;
  }
  if (url.pathname === '/api/v1/admin/clients' && metodo === 'GET') {
    await respuestaJson([clienteVisual])(ruta);
    return;
  }
  if (/\/sap-environments$/u.test(url.pathname) && metodo === 'GET') {
    await respuestaJson([ambienteVisual])(ruta);
    return;
  }
  await respuestaJson({ code: 'VISUAL_FIXTURE_ROUTE_UNEXPECTED' }, 500)(ruta);
}

/** Valida jerarquía, navegación por teclado, tema y formato responsive del panel. */
test('ADMIN navega y revisa perfiles en escritorio y móvil sin datos reales', async ({ page }) => {
  const tokenCsrf = randomBytes(32).toString('base64url');
  const estado = {
    perfiles: [] as PerfilConexionAdminContrato[],
    resultadosPrueba: 0,
    solicitudesCredenciales: [] as unknown[],
  };
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('portal-soporte-theme', 'light'));
  await page.route('**/api/v1/auth/me', respuestaJson({ user: administradorVisual }));
  await page.route('**/api/v1/auth/csrf', respuestaJson({ token: tokenCsrf }));
  await page.route('**/api/v1/me/preferences', async (ruta) => {
    if (ruta.request().method() === 'GET') {
      await respuestaJson({ theme: 'light' })(ruta);
      return;
    }
    await respuestaJson({ theme: 'dark' })(ruta);
  });
  await page.route('**/api/v1/admin/clients**', (ruta) => responderCatalogos(ruta, estado));

  await page.goto('/settings/clients');
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  const tarjeta = page.getByRole('article', { name: clienteVisual.nombre });
  await expect(tarjeta).toBeVisible();
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.screenshot({
    path: join(tmpdir(), 'portal-soporte-ps005-2-clientes-desktop.png'),
    animations: 'disabled',
  });
  await tarjeta.getByText('Editar y administrar ambientes SAP').click();
  await expect(tarjeta.getByRole('heading', { name: 'Ambientes SAP' })).toBeVisible();
  await expect(tarjeta.getByText('Ambiente SAP sintético')).toBeVisible();
  await tarjeta.getByRole('heading', { name: 'Ambientes SAP' }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(tmpdir(), 'portal-soporte-ps005-2-ambientes-sap-desktop.png'),
    animations: 'disabled',
    fullPage: true,
  });
  await tarjeta.getByText('Conexiones MySQL', { exact: true }).click();
  await expect(tarjeta.getByLabel('Nombre del perfil')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(tarjeta.getByLabel('Nombre del perfil')).toBeFocused();

  const secretoSintetico = 'clave-visual-sintetica-no-real';
  await tarjeta.getByLabel('Nombre del perfil').fill('Perfil creado visual sintético');
  await tarjeta.getByLabel('ID de destino autorizado').fill('destino-visual');
  await tarjeta.getByLabel('Base MySQL').fill('base_visual');
  await tarjeta.getByLabel('Usuario MySQL').fill('usuario_visual');
  await tarjeta.getByLabel('Contraseña MySQL').fill(secretoSintetico);
  await tarjeta
    .getByLabel('CA TLS (opcional)')
    .fill('-----BEGIN CERTIFICATE-----\nCA-SINTETICA\n-----END CERTIFICATE-----');
  await tarjeta
    .getByLabel('Certificado cliente TLS (opcional)')
    .fill('-----BEGIN CERTIFICATE-----\nCERT-SINTETICO\n-----END CERTIFICATE-----');
  await tarjeta
    .getByLabel('Llave TLS cliente (opcional)')
    .fill('-----BEGIN PRIVATE KEY-----\nLLAVE-SINTETICA\n-----END PRIVATE KEY-----');
  await tarjeta.getByRole('button', { name: 'Guardar perfil' }).click();
  const perfil = tarjeta.locator('.fila-perfil-conexion');
  await expect(
    perfil.getByRole('heading', { name: 'Perfil creado visual sintético' }),
  ).toBeVisible();
  await expect(tarjeta.getByRole('status')).toContainText('credenciales no se muestran nuevamente');
  const formularioAlta = tarjeta.locator('form.formulario-perfil-conexion').first();
  await expect(formularioAlta.getByLabel('Contraseña MySQL')).toHaveValue('');
  expect(await page.locator('body').innerText()).not.toContain(secretoSintetico);
  expect(JSON.stringify(estado.solicitudesCredenciales[0])).toContain(secretoSintetico);

  await perfil.getByRole('button', { name: 'Probar conexión' }).click();
  await expect(perfil.getByRole('status')).toContainText('Conexión verificada.');
  await perfil.getByRole('button', { name: 'Probar conexión' }).click();
  await expect(perfil.getByRole('status')).toContainText('No se pudo validar el certificado TLS.');

  await perfil.getByText('Editar perfil y sustituir credenciales').click();
  await perfil.getByLabel('Nombre del perfil').fill('Perfil editado visual sintético');
  await perfil.getByRole('button', { name: 'Guardar configuración' }).click();
  await expect(
    perfil.getByRole('heading', { name: 'Perfil editado visual sintético' }),
  ).toBeVisible();
  await perfil.getByLabel('Usuario MySQL').fill('usuario_reemplazo_visual');
  await perfil.getByLabel('Contraseña MySQL').fill('reemplazo-visual-sintetico');
  await perfil
    .getByLabel('CA TLS (opcional)')
    .fill('-----BEGIN CERTIFICATE-----\nCA-ROTADA\n-----END CERTIFICATE-----');
  await perfil
    .getByLabel('Certificado cliente TLS (opcional)')
    .fill('-----BEGIN CERTIFICATE-----\nCERT-ROTADO\n-----END CERTIFICATE-----');
  await perfil
    .getByLabel('Llave TLS cliente (opcional)')
    .fill('-----BEGIN PRIVATE KEY-----\nLLAVE-ROTADA\n-----END PRIVATE KEY-----');
  await perfil.getByRole('button', { name: 'Sustituir credenciales' }).click();
  await expect(
    tarjeta.getByRole('status').filter({ hasText: 'Credenciales cifradas y sustituidas.' }),
  ).toBeVisible();
  await expect(perfil.getByLabel('Contraseña MySQL')).toHaveValue('');
  expect(JSON.stringify(estado.solicitudesCredenciales.at(-1))).toContain(
    'reemplazo-visual-sintetico',
  );
  expect(await page.locator('body').innerText()).not.toContain('reemplazo-visual-sintetico');

  await tarjeta.getByLabel('Ruta de conexión').selectOption('MYSQL_SSH');
  await expect(tarjeta.getByLabel('ID de gateway SSH autorizado')).toBeVisible();
  await expect(tarjeta.getByLabel('Llave privada SSH (PEM/OpenSSH o PPK v2 RSA)')).toBeVisible();

  await page.screenshot({
    path: join(tmpdir(), 'portal-soporte-ps005-2-panel-cliente-claro-desktop.png'),
    animations: 'disabled',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Cambiar a tema oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(tmpdir(), 'portal-soporte-ps005-2-panel-cliente-oscuro-movil.png'),
    animations: 'disabled',
    fullPage: true,
  });

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  );
});
