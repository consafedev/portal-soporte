import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, type Route } from '@playwright/test';
import type { RespuestaUsuarioPublico } from '../../../packages/contracts/src/auth.js';
import type {
  AmbienteSapClienteAdminContrato,
  ClienteAdminContrato,
  PerfilConexionAdminContrato,
  ResultadoArchivoVistaPreviaRf1Contrato,
} from '../../../packages/contracts/src/clients.js';

const CLIENT_ID = '550e8400-e29b-41d4-a716-446655440020';
const PERFIL_ID = '550e8400-e29b-41d4-a716-446655440030';

const ADMIN_VISUAL: RespuestaUsuarioPublico = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  username: 'admin_visual_sintetico',
  displayName: 'Administración sintética',
  role: 'ADMIN',
};

const CLIENTE_VISUAL: ClienteAdminContrato = {
  id: CLIENT_ID,
  nombre: 'Cliente visual sintético',
  estado: 'ACTIVE',
  createdAt: '2026-11-21T00:00:00.000Z',
  updatedAt: '2026-11-21T00:00:00.000Z',
};

const CLIENTE_ACCESIBLE_VISUAL = {
  id: CLIENT_ID,
  nombre: CLIENTE_VISUAL.nombre,
  estado: 'ACTIVE',
};

const AMBIENTE_VISUAL: AmbienteSapClienteAdminContrato = {
  id: '550e8400-e29b-41d4-a716-446655440040',
  clientId: CLIENT_ID,
  codigo: 'QA-01',
  nombre: 'Ambiente SAP sintético',
  estado: 'ACTIVE',
  createdAt: '2026-11-21T00:00:00.000Z',
  updatedAt: '2026-11-21T00:00:00.000Z',
};

const PERFIL_VISUAL: PerfilConexionAdminContrato = {
  id: PERFIL_ID,
  clientId: CLIENT_ID,
  nombre: 'Perfil visual sintético',
  tipo: 'MYSQL_TCP',
  entorno: 'TEST',
  destinoMySqlId: 'destino-visual-interno',
  gatewaySshId: null,
  baseDatos: 'base_visual_interna',
  estado: 'ACTIVE',
  createdAt: '2026-11-21T00:00:00.000Z',
  updatedAt: '2026-11-21T00:00:00.000Z',
};

const RESULTADO_VISUAL: ResultadoArchivoVistaPreviaRf1Contrato = {
  status: 'READY',
  factura: {
    uuid: 'A3B1C9D7-E5F3-4A61-8B20-1234567890AB',
    rfcEmisor: 'AAA010101AAA',
    rfcReceptor: 'BBB010101BBB',
    fecha: '2026-11-21T12:00:00',
    subtotal: '100.00',
    descuento: '0.00',
    moneda: 'MXN',
    total: '116.00',
    referencia: 'VISUAL-1',
    tipoComprobante: 'I',
    importeIvaFAC: '16.00',
    retencionIsr: '0.00',
    retencionIva: '0.00',
    retencionIeps: '0.00',
  },
  resolution: { sociedad: '1000', ambienteSap: 'QA-01', idProveedor: 'SUP-42' },
  estatus: 'PAGADA',
};

const RESULTADO_PENDIENTE_VISUAL: ResultadoArchivoVistaPreviaRf1Contrato = {
  status: 'NEEDS_SELECTION',
  errorCode: 'RF1_SOCIETY_SELECTION_REQUIRED',
  factura: RESULTADO_VISUAL.factura,
  sociedadesDisponibles: [
    { sociedad: '1000', ambienteSap: 'ERP-QA' },
    { sociedad: '2000', ambienteSap: 'ERP-DEV' },
  ],
};

const RESULTADO_SELECCIONADO_VISUAL: ResultadoArchivoVistaPreviaRf1Contrato = {
  ...RESULTADO_VISUAL,
  resolution: { sociedad: '2000', ambienteSap: 'ERP-DEV', idProveedor: 'SUP-42' },
};

/** Responde datos sintéticos a una ruta visual y evita cualquier conexión externa. */
function responderJson(cuerpo: unknown): (ruta: Route) => Promise<void> {
  /** Completa la solicitud con el DTO sintético esperado por el navegador. */
  return async (ruta: Route): Promise<void> => {
    await ruta.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(cuerpo),
    });
  };
}

/** Verifica layout, teclado, tema y movimiento reducido con catálogos y resultados sintéticos. */
test('ADMIN selecciona sociedad por teclado en escritorio/móvil y ambos temas', async ({
  page,
}) => {
  const tokenCsrf = randomBytes(32).toString('base64url');
  let tema = 'light';
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('portal-soporte-theme', 'light'));
  await page.route('**/api/v1/auth/me', responderJson({ user: ADMIN_VISUAL }));
  await page.route('**/api/v1/auth/csrf', responderJson({ token: tokenCsrf }));
  await page.route('**/api/v1/me/preferences', async (ruta) => {
    if (ruta.request().method() === 'PATCH') {
      const cuerpo = ruta.request().postDataJSON() as { theme: string };
      tema = cuerpo.theme;
    }
    await responderJson({ theme: tema })(ruta);
  });
  await page.route('**/api/v1/clients', responderJson([CLIENTE_ACCESIBLE_VISUAL]));
  await page.route(
    `**/api/v1/admin/clients/${CLIENT_ID}/sap-environments`,
    responderJson([AMBIENTE_VISUAL]),
  );
  await page.route(
    `**/api/v1/admin/clients/${CLIENT_ID}/connection-profiles`,
    responderJson([PERFIL_VISUAL]),
  );
  let solicitudesPreview = 0;
  await page.route(`**/api/v1/clients/${CLIENT_ID}/modules/rf-1/preview?*`, async (ruta) => {
    solicitudesPreview += 1;
    await responderJson([
      solicitudesPreview === 1 ? RESULTADO_PENDIENTE_VISUAL : RESULTADO_SELECCIONADO_VISUAL,
    ])(ruta);
  });

  await page.goto('/modules/rf-1');
  await expect(page.getByRole('heading', { name: 'Vista previa de facturas' })).toBeVisible();
  await expect(page.getByLabel('Cliente')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cambiar a tema oscuro' })).toBeVisible();
  const cliente = page.getByLabel('Cliente');
  await cliente.focus();
  await cliente.press('ArrowDown');
  await cliente.press('Enter');
  const perfil = page.getByLabel('Perfil de conexión');
  await expect(perfil).toBeEnabled();
  await perfil.focus();
  await perfil.press('ArrowDown');
  await perfil.press('Enter');
  await expect(page.getByText('Entorno operativo: Pruebas', { exact: true })).toBeVisible();
  await page.getByLabel('Archivos CFDI XML').setInputFiles({
    name: 'sintetico.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from('<cfdi/>', 'utf8'),
  });
  const analizar = page.getByRole('button', { name: 'Analizar vista previa' });
  await analizar.focus();
  await expect(analizar).toBeFocused();
  await page.keyboard.press('Enter');
  const tablaResultados = page.getByRole('table', { name: 'Resultados de vista previa RF-1' });
  await expect(tablaResultados).toContainText('La sociedad requiere una selección explícita.');
  const selectorSociedad = page.getByLabel('Sociedad y ambiente SAP para archivo 1: sintetico.xml');
  await selectorSociedad.focus();
  await selectorSociedad.press('ArrowDown');
  await selectorSociedad.press('ArrowDown');
  await selectorSociedad.press('Enter');
  await expect(selectorSociedad).toHaveValue('["2000","ERP-DEV"]');
  const validarSeleccion = page.getByRole('button', { name: 'Validar selecciones de sociedad' });
  await expect(validarSeleccion).toBeEnabled();
  await page.screenshot({
    path: join(tmpdir(), 'portal-soporte-rf1-escritorio-claro.png'),
    fullPage: true,
    animations: 'disabled',
  });
  expect(await page.locator('body').innerText()).not.toContain('destino-visual-interno');
  expect(await page.locator('body').innerText()).not.toContain('base_visual_interna');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  );

  await page.getByRole('button', { name: 'Cambiar a tema oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const ordenMovil = await page.evaluate(() => {
    const barraTema = document.querySelector('.control-tema-global')?.getBoundingClientRect();
    const barraNavegacion = document.querySelector('.barra-lateral')?.getBoundingClientRect();
    return {
      temaInferior: barraTema?.bottom ?? -1,
      navegacionSuperior: barraNavegacion?.top ?? -1,
    };
  });
  expect(ordenMovil.temaInferior).toBeLessThanOrEqual(ordenMovil.navegacionSuperior);
  await expect(selectorSociedad).toBeVisible();
  await expect(selectorSociedad).toHaveValue('["2000","ERP-DEV"]');
  await page.screenshot({
    path: join(tmpdir(), 'portal-soporte-rf1-movil-oscuro.png'),
    fullPage: true,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    await page.evaluate(() => {
      const tabla = document.querySelector('.contenedor-tabla-rf1');
      return tabla !== null && tabla.scrollWidth <= tabla.clientWidth;
    }),
  ).toBe(true);
  await expect(analizar).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cambiar a tema claro' })).toBeVisible();

  await validarSeleccion.focus();
  await page.keyboard.press('Enter');
  await expect(tablaResultados).toContainText('2000 · ERP-DEV · SUP-42');
  expect(solicitudesPreview).toBe(2);
});
