import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { RespuestaUsuarioPublico } from '../../../packages/contracts/src/auth.js';
import type {
  AccesoClienteAdminContrato,
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
  destinoMySql: { hostname: 'db.visual.test', port: 3306 },
  gatewaySsh: null,
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

const accesoClienteVisual: AccesoClienteAdminContrato = {
  asignaciones: [],
  capacidades: [
    {
      clientId: clienteVisual.id,
      capabilityId: 'rf-1:read',
      enabled: false,
      changedAt: null,
    },
    {
      clientId: clienteVisual.id,
      capabilityId: 'rf-1:execute',
      enabled: false,
      changedAt: null,
    },
  ],
};

/** Operación administrativa observada por el backend simulado del test visual. */
type OperacionCapturadaCredenciales = 'CREAR_PERFIL' | 'REEMPLAZAR_CREDENCIALES';

/** Metadatos no sensibles que identifican una solicitud sin depender de su orden. */
interface SolicitudCredencialesCapturada {
  readonly operacion: OperacionCapturadaCredenciales;
  readonly tipoPerfil: PerfilConexionAdminContrato['tipo'] | undefined;
  readonly nombrePerfil: string | undefined;
  readonly credenciales: unknown;
}

/** Metadatos de endpoint enviados al API, sin copiar el paquete de credenciales. */
interface SolicitudPerfilCapturada {
  /** Operación visible que originó el payload de metadatos. */
  readonly operacion: 'CREAR' | 'ACTUALIZAR';
  readonly nombre: string | undefined;
  readonly tipo: PerfilConexionAdminContrato['tipo'];
  readonly destinoMySql: unknown;
  readonly gatewaySsh: unknown;
  readonly incluyeIdsInternos: boolean;
}

/** Busca una solicitud por operación y perfil para evitar seleccionar un payload anterior. */
function buscarSolicitudCredenciales(
  solicitudes: readonly SolicitudCredencialesCapturada[],
  operacion: OperacionCapturadaCredenciales,
  tipoPerfil: PerfilConexionAdminContrato['tipo'],
  nombrePerfil: string,
): SolicitudCredencialesCapturada | undefined {
  return solicitudes.find(
    (solicitud) =>
      solicitud.operacion === operacion &&
      solicitud.tipoPerfil === tipoPerfil &&
      solicitud.nombrePerfil === nombrePerfil,
  );
}

/** Comprueba un secreto en memoria y devuelve solo un booleano para mantener diagnósticos limpios. */
function contieneSecreto(
  solicitud: SolicitudCredencialesCapturada | undefined,
  secreto: string,
): boolean {
  return contieneValorExacto(solicitud?.credenciales, secreto);
}

/** Comprueba que un objeto JSON simulado tiene campos consultables de forma segura. */
function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Busca un valor secreto por igualdad en un paquete JSON sin serializarlo ni mostrarlo. */
function contieneValorExacto(valor: unknown, valorBuscado: string): boolean {
  if (valor === valorBuscado) return true;
  if (Array.isArray(valor))
    return valor.some((elemento) => contieneValorExacto(elemento, valorBuscado));
  if (!esRegistro(valor)) return false;
  return Object.values(valor).some((elemento) => contieneValorExacto(elemento, valorBuscado));
}

/** Verifica que la autenticación SSH quedó en su campo contractual sin imprimirla. */
function contieneSecretoSsh(
  solicitud: SolicitudCredencialesCapturada | undefined,
  autenticacion: 'PASSWORD' | 'PRIVATE_KEY',
  secreto: string,
): boolean {
  if (solicitud === undefined || !esRegistro(solicitud.credenciales)) return false;
  const ssh = solicitud.credenciales['ssh'];
  if (!esRegistro(ssh)) return false;
  const campoSecreto = autenticacion === 'PASSWORD' ? 'password' : 'privateKey';
  return ssh['authentication'] === autenticacion && ssh[campoSecreto] === secreto;
}

/** Confirma que un secreto sintético aparece en una sola captura de backend. */
function secretoApareceSoloEnSolicitud(
  solicitudes: readonly SolicitudCredencialesCapturada[],
  solicitudEsperada: SolicitudCredencialesCapturada | undefined,
  secreto: string,
): boolean {
  if (
    solicitudEsperada === undefined ||
    solicitudEsperada.tipoPerfil !== 'MYSQL_SSH' ||
    !contieneSecreto(solicitudEsperada, secreto)
  ) {
    return false;
  }
  const solicitudesConSecreto = solicitudes.filter((solicitud) =>
    contieneSecreto(solicitud, secreto),
  );
  return solicitudesConSecreto.length === 1 && solicitudesConSecreto[0] === solicitudEsperada;
}

/** Comprueba que un secreto no aparece en texto ni valores de campos visibles de la interfaz. */
async function interfazContieneSecreto(page: Page, secreto: string): Promise<boolean> {
  const texto = await page.locator('body').innerText();
  const valoresCampos = await page
    .locator('input, textarea')
    .evaluateAll((elementos) =>
      elementos.map((elemento) =>
        elemento instanceof HTMLInputElement || elemento instanceof HTMLTextAreaElement
          ? elemento.value
          : '',
      ),
    );
  return texto.includes(secreto) || valoresCampos.some((valor) => valor.includes(secreto));
}

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
    solicitudesCredenciales: SolicitudCredencialesCapturada[];
    solicitudesPerfiles: SolicitudPerfilCapturada[];
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
    const tipoPerfil = solicitud['tipo'] === 'MYSQL_SSH' ? 'MYSQL_SSH' : 'MYSQL_TCP';
    const nombrePerfil = typeof solicitud['nombre'] === 'string' ? solicitud['nombre'] : undefined;
    estado.solicitudesPerfiles.push({
      operacion: 'CREAR',
      nombre: nombrePerfil,
      tipo: tipoPerfil,
      destinoMySql: solicitud['destinoMySql'],
      gatewaySsh: solicitud['gatewaySsh'],
      incluyeIdsInternos:
        Object.hasOwn(solicitud, 'destinoMySqlId') || Object.hasOwn(solicitud, 'gatewaySshId'),
    });
    estado.solicitudesCredenciales.push({
      operacion: 'CREAR_PERFIL',
      tipoPerfil,
      nombrePerfil,
      credenciales: solicitud['credenciales'],
    });
    const perfilCreado: PerfilConexionAdminContrato = {
      ...perfilVisual,
      id: `550e8400-e29b-41d4-a716-${String(446655440031 + estado.perfiles.length).padStart(12, '0')}`,
      nombre: String(solicitud['nombre']),
      tipo: solicitud['tipo'] === 'MYSQL_SSH' ? 'MYSQL_SSH' : 'MYSQL_TCP',
      entorno: solicitud['entorno'] === 'PRODUCTION' ? 'PRODUCTION' : 'TEST',
      destinoMySql: solicitud['destinoMySql'] as PerfilConexionAdminContrato['destinoMySql'],
      gatewaySsh:
        (solicitud['gatewaySsh'] as PerfilConexionAdminContrato['gatewaySsh'] | undefined) ?? null,
      baseDatos: String(solicitud['baseDatos']),
    };
    estado.perfiles.push(perfilCreado);
    await respuestaJson(perfilCreado, 201)(ruta);
    return;
  }
  if (url.pathname.endsWith('/credentials') && metodo === 'PUT') {
    const perfilId = /\/connection-profiles\/([0-9a-f-]+)\/credentials$/iu.exec(url.pathname)?.[1];
    const perfil = estado.perfiles.find((elemento) => elemento.id === perfilId);
    const solicitud = ruta.request().postDataJSON() as Record<string, unknown>;
    estado.solicitudesCredenciales.push({
      operacion: 'REEMPLAZAR_CREDENCIALES',
      tipoPerfil: perfil?.tipo,
      nombrePerfil: perfil?.nombre,
      credenciales: solicitud['credenciales'],
    });
    await respuestaJson(estado.perfiles.at(-1) ?? perfilVisual)(ruta);
    return;
  }
  if (/\/connection-profiles\/[0-9a-f-]+$/iu.test(url.pathname) && metodo === 'PATCH') {
    const cambios = ruta.request().postDataJSON() as Record<string, unknown>;
    const perfilId = /\/connection-profiles\/([0-9a-f-]+)$/iu.exec(url.pathname)?.[1];
    const indicePerfil = estado.perfiles.findIndex((elemento) => elemento.id === perfilId);
    const perfilBase =
      (indicePerfil >= 0 ? estado.perfiles[indicePerfil] : undefined) ?? perfilVisual;
    const nombreActualizado =
      typeof cambios['nombre'] === 'string' ? cambios['nombre'] : perfilBase.nombre;
    estado.solicitudesPerfiles.push({
      operacion: 'ACTUALIZAR',
      nombre: nombreActualizado,
      tipo: perfilBase.tipo,
      destinoMySql: cambios['destinoMySql'] ?? perfilBase.destinoMySql,
      gatewaySsh: cambios['gatewaySsh'] ?? perfilBase.gatewaySsh,
      incluyeIdsInternos:
        Object.hasOwn(cambios, 'destinoMySqlId') || Object.hasOwn(cambios, 'gatewaySshId'),
    });
    const perfilActualizado: PerfilConexionAdminContrato = {
      ...perfilBase,
      nombre: nombreActualizado,
      destinoMySql:
        (cambios['destinoMySql'] as PerfilConexionAdminContrato['destinoMySql'] | undefined) ??
        perfilBase.destinoMySql,
      gatewaySsh:
        (cambios['gatewaySsh'] as PerfilConexionAdminContrato['gatewaySsh'] | undefined) ??
        perfilBase.gatewaySsh,
      entorno:
        (cambios['entorno'] as PerfilConexionAdminContrato['entorno'] | undefined) ??
        perfilBase.entorno,
      baseDatos: (cambios['baseDatos'] as string | undefined) ?? perfilBase.baseDatos,
      updatedAt: '2026-11-21T00:01:00.000Z',
    };
    if (indicePerfil >= 0) estado.perfiles[indicePerfil] = perfilActualizado;
    await respuestaJson(perfilActualizado)(ruta);
    return;
  }
  if (url.pathname.endsWith('/test') && metodo === 'POST') {
    estado.resultadosPrueba += 1;
    await respuestaJson({
      code:
        estado.resultadosPrueba === 1
          ? 'CONNECTED'
          : estado.resultadosPrueba === 2
            ? 'MYSQL_TLS_FAILED'
            : 'DESTINATION_NOT_ALLOWED',
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
  if (/\/admin\/clients\/[0-9a-f-]+\/access$/iu.test(url.pathname) && metodo === 'GET') {
    await respuestaJson(accesoClienteVisual)(ruta);
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
    solicitudesCredenciales: [] as SolicitudCredencialesCapturada[],
    solicitudesPerfiles: [] as SolicitudPerfilCapturada[],
  };
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('portal-soporte-theme', 'light'));
  await page.route('**/api/v1/auth/me', respuestaJson({ user: administradorVisual }));
  await page.route('**/api/v1/auth/csrf', respuestaJson({ token: tokenCsrf }));
  await page.route('**/api/v1/admin/users**', respuestaJson([]));
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
  await expect(page.getByRole('note')).toContainText(
    'El servidor valida la seguridad de cada destino',
  );
  await expect(page.getByRole('note')).not.toContainText('destinos permitidos');
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
  await expect(
    tarjeta.getByText(/Registra aquí el destino MySQL que usas en tu cliente/u),
  ).toBeVisible();
  await expect(tarjeta.getByText(/endpoints aprobados por operaciones/u)).toHaveCount(0);
  await expect(tarjeta.getByText(/aprobado en el servidor/u)).toHaveCount(0);
  await expect(tarjeta.getByText(/destinos permitidos/u)).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(tarjeta.getByLabel('Nombre del perfil')).toBeFocused();
  const secretoSintetico = 'clave-visual-sintetica-no-real';
  await tarjeta.getByLabel('Nombre del perfil').fill('Perfil creado visual sintético');
  await tarjeta.getByLabel('MySQL Hostname').fill('db.visual.test');
  await tarjeta.getByLabel('MySQL Port').fill('3306');
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
  await expect(
    tarjeta.getByRole('status').filter({ hasText: 'credenciales no se muestran nuevamente' }),
  ).toBeVisible();
  const formularioAlta = tarjeta.locator('form.formulario-perfil-conexion').first();
  expect((await formularioAlta.getByLabel('Contraseña MySQL').inputValue()) === '').toBe(true);
  expect(await interfazContieneSecreto(page, secretoSintetico)).toBe(false);
  const solicitudMySql = buscarSolicitudCredenciales(
    estado.solicitudesCredenciales,
    'CREAR_PERFIL',
    'MYSQL_TCP',
    'Perfil creado visual sintético',
  );
  expect(contieneSecreto(solicitudMySql, secretoSintetico)).toBe(true);
  const perfilMySqlCapturado = estado.solicitudesPerfiles.find(
    (solicitud) =>
      solicitud.operacion === 'CREAR' && solicitud.nombre === 'Perfil creado visual sintético',
  );
  expect(perfilMySqlCapturado?.destinoMySql).toEqual({ hostname: 'db.visual.test', port: 3306 });
  expect(perfilMySqlCapturado?.incluyeIdsInternos).toBe(false);

  await perfil.getByRole('button', { name: 'Probar conexión' }).click();
  await expect(perfil.getByRole('status')).toContainText('Conexión verificada.');
  await perfil.getByRole('button', { name: 'Probar conexión' }).click();
  await expect(perfil.getByRole('status')).toContainText('No se pudo validar el certificado TLS.');
  await perfil.getByRole('button', { name: 'Probar conexión' }).click();
  await expect(perfil.getByRole('status')).toContainText(
    'El perfil no tiene un destino completo o no está disponible para esta operación.',
  );
  await expect(perfil.getByRole('status')).not.toContainText('configuración del servidor');

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
  expect((await perfil.getByLabel('Contraseña MySQL').inputValue()) === '').toBe(true);
  const solicitudReemplazoMySql = buscarSolicitudCredenciales(
    estado.solicitudesCredenciales,
    'REEMPLAZAR_CREDENCIALES',
    'MYSQL_TCP',
    'Perfil editado visual sintético',
  );
  expect(contieneSecreto(solicitudReemplazoMySql, 'reemplazo-visual-sintetico')).toBe(true);
  expect(await interfazContieneSecreto(page, 'reemplazo-visual-sintetico')).toBe(false);

  await tarjeta.getByLabel('Ruta de conexión').selectOption('MYSQL_SSH');
  await expect(tarjeta.getByLabel('SSH Hostname')).toBeVisible();
  await expect(tarjeta.getByLabel('SSH Port')).toBeVisible();
  await expect(tarjeta.getByLabel('Huella SHA-256 del servidor SSH')).toHaveAttribute(
    'required',
    '',
  );
  await expect(tarjeta.getByLabel('Huella SHA-256 del servidor SSH')).toHaveAttribute(
    'pattern',
    '^SHA256:[A-Za-z0-9+/]{43}$',
  );
  await expect(tarjeta.getByLabel('Método de autenticación SSH')).toBeVisible();
  await expect(
    tarjeta.getByLabel('Llave privada SSH (archivo PEM/OpenSSH o PPK v2 RSA)'),
  ).toHaveAttribute('type', 'file');
  const campoHuellaSsh = tarjeta.getByLabel('Huella SHA-256 del servidor SSH');
  await tarjeta.getByLabel('SSH Port').press('Tab');
  await expect(campoHuellaSsh).toBeFocused();

  const secretoSshSintetico = 'contraseña-ssh-visual-sintetica';
  const fingerprintSshVisual = `SHA256:${'A'.repeat(43)}`;
  await formularioAlta.getByLabel('Nombre del perfil').fill('SSH con contraseña sintética');
  await formularioAlta.getByLabel('SSH Hostname').fill('ssh.visual.test');
  await formularioAlta.getByLabel('SSH Port').fill('22');
  await formularioAlta.getByLabel('Huella SHA-256 del servidor SSH').fill(fingerprintSshVisual);
  await formularioAlta.getByLabel('MySQL Hostname').fill('db.visual.test');
  await formularioAlta.getByLabel('MySQL Port').fill('3306');
  await formularioAlta.getByLabel('Base MySQL').fill('base_visual');
  await formularioAlta.getByLabel('Usuario MySQL').fill('usuario_ssh_visual');
  await formularioAlta.getByLabel('Contraseña MySQL').fill('clave-mysql-visual-sintetica');
  await formularioAlta.getByLabel('Método de autenticación SSH').selectOption('PASSWORD');
  await formularioAlta.getByLabel('Usuario SSH').fill('ssh_visual');
  await formularioAlta.getByLabel('Contraseña SSH').fill(secretoSshSintetico);
  expect(
    await formularioAlta
      .locator(':invalid')
      .evaluateAll((elementos) => elementos.map((elemento) => (elemento as HTMLInputElement).id)),
  ).toEqual([]);
  await formularioAlta.getByRole('button', { name: 'Guardar perfil' }).click();
  expect(await formularioAlta.getByRole('alert').allTextContents()).toEqual([]);
  const nombrePerfilSshPassword = 'SSH con contraseña sintética';
  await expect
    .poll(
      () =>
        buscarSolicitudCredenciales(
          estado.solicitudesCredenciales,
          'CREAR_PERFIL',
          'MYSQL_SSH',
          nombrePerfilSshPassword,
        ) !== undefined,
    )
    .toBe(true);
  await expect(tarjeta.getByRole('heading', { name: nombrePerfilSshPassword })).toBeVisible();
  const solicitudSshPassword = buscarSolicitudCredenciales(
    estado.solicitudesCredenciales,
    'CREAR_PERFIL',
    'MYSQL_SSH',
    nombrePerfilSshPassword,
  );
  expect(contieneSecreto(solicitudSshPassword, secretoSshSintetico)).toBe(true);
  expect(contieneSecretoSsh(solicitudSshPassword, 'PASSWORD', secretoSshSintetico)).toBe(true);
  expect(
    secretoApareceSoloEnSolicitud(
      estado.solicitudesCredenciales,
      solicitudSshPassword,
      secretoSshSintetico,
    ),
  ).toBe(true);
  expect(await interfazContieneSecreto(page, secretoSshSintetico)).toBe(false);
  const perfilSshPasswordCapturado = estado.solicitudesPerfiles.find(
    (solicitud) => solicitud.operacion === 'CREAR' && solicitud.nombre === nombrePerfilSshPassword,
  );
  expect(perfilSshPasswordCapturado?.gatewaySsh).toEqual({
    hostname: 'ssh.visual.test',
    port: 22,
    fingerprint: fingerprintSshVisual,
  });
  await expect(formularioAlta.getByLabel('Método de autenticación SSH')).toHaveValue('PRIVATE_KEY');

  const articuloSshPassword = tarjeta.getByRole('article', { name: nombrePerfilSshPassword });
  await articuloSshPassword.getByText('Editar perfil y sustituir credenciales').click();
  const fingerprintSshActualizada = `SHA256:${'B'.repeat(43)}`;
  await articuloSshPassword
    .getByLabel('Huella SHA-256 del servidor SSH')
    .fill(fingerprintSshActualizada);
  await articuloSshPassword.getByRole('button', { name: 'Guardar configuración' }).click();
  await expect
    .poll(() =>
      estado.solicitudesPerfiles.some(
        (solicitud) =>
          solicitud.operacion === 'ACTUALIZAR' && solicitud.nombre === nombrePerfilSshPassword,
      ),
    )
    .toBe(true);
  const perfilSshEditado = estado.solicitudesPerfiles.find(
    (solicitud) =>
      solicitud.operacion === 'ACTUALIZAR' && solicitud.nombre === nombrePerfilSshPassword,
  );
  expect(perfilSshEditado?.gatewaySsh).toEqual({
    hostname: 'ssh.visual.test',
    port: 22,
    fingerprint: fingerprintSshActualizada,
  });
  expect(perfilSshEditado?.incluyeIdsInternos).toBe(false);

  const contenidoLlaveSintetica =
    '-----BEGIN OPENSSH PRIVATE KEY-----\nLLAVE-SINTETICA-NO-REAL\n-----END OPENSSH PRIVATE KEY-----';
  await formularioAlta.getByLabel('Nombre del perfil').fill('SSH con llave sintética');
  await formularioAlta.getByLabel('SSH Hostname').fill('ssh.visual.test');
  await formularioAlta.getByLabel('SSH Port').fill('22');
  await formularioAlta.getByLabel('Huella SHA-256 del servidor SSH').fill(fingerprintSshVisual);
  await formularioAlta.getByLabel('MySQL Hostname').fill('db.visual.test');
  await formularioAlta.getByLabel('MySQL Port').fill('3306');
  await formularioAlta.getByLabel('Base MySQL').fill('base_visual');
  await formularioAlta.getByLabel('Usuario MySQL').fill('usuario_ssh_visual');
  await formularioAlta.getByLabel('Contraseña MySQL').fill('clave-mysql-visual-sintetica');
  await formularioAlta.getByLabel('Usuario SSH').fill('ssh_visual');
  await formularioAlta
    .getByLabel('Llave privada SSH (archivo PEM/OpenSSH o PPK v2 RSA)')
    .setInputFiles({
      name: 'llave-visual.pem',
      mimeType: 'application/x-pem-file',
      buffer: Buffer.from(contenidoLlaveSintetica),
    });
  await expect(formularioAlta.getByRole('status')).toContainText('llave-visual.pem');
  expect(await interfazContieneSecreto(page, 'LLAVE-SINTETICA-NO-REAL')).toBe(false);
  await formularioAlta.getByRole('button', { name: 'Guardar perfil' }).click();
  await expect
    .poll(
      () =>
        buscarSolicitudCredenciales(
          estado.solicitudesCredenciales,
          'CREAR_PERFIL',
          'MYSQL_SSH',
          'SSH con llave sintética',
        ) !== undefined,
    )
    .toBe(true);
  await expect(tarjeta.getByRole('heading', { name: 'SSH con llave sintética' })).toBeVisible();
  const solicitudSshPrivateKey = buscarSolicitudCredenciales(
    estado.solicitudesCredenciales,
    'CREAR_PERFIL',
    'MYSQL_SSH',
    'SSH con llave sintética',
  );
  expect(contieneSecreto(solicitudSshPrivateKey, contenidoLlaveSintetica)).toBe(true);
  expect(contieneSecretoSsh(solicitudSshPrivateKey, 'PRIVATE_KEY', contenidoLlaveSintetica)).toBe(
    true,
  );
  expect(
    secretoApareceSoloEnSolicitud(
      estado.solicitudesCredenciales,
      solicitudSshPrivateKey,
      contenidoLlaveSintetica,
    ),
  ).toBe(true);
  expect(await interfazContieneSecreto(page, 'LLAVE-SINTETICA-NO-REAL')).toBe(false);

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
