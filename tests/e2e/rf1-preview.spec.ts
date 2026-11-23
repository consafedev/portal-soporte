import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray, or } from 'drizzle-orm';
import { expect, test, type Page, type Route } from '@playwright/test';
import { Argon2PasswordHasher } from '../../apps/api/src/auth/argon2-password-hasher.js';
import { cargarConfiguracionConexionPrueba } from '../../apps/api/src/runtime-config.js';
import { crearClienteBaseDatosAuth, type BaseDatosAuth } from '../../apps/api/src/db/client.js';
import {
  auditEvents,
  authThrottleWindows,
  clientCapabilities,
  clientSapEnvironments,
  clientUserAssignments,
  clients,
  recoveryTokens,
  sessions,
  users,
} from '../../apps/api/src/db/schema.js';
import type {
  ResultadoArchivoVistaPreviaRf1Contrato,
  SeleccionSociedadArchivoRf1Contrato,
} from '../../packages/contracts/src/clients.js';

/** Cuenta sintética con credenciales generadas solo para la ejecución de Playwright. */
interface CuentaPreviewE2e {
  /** UUID persistido que la prueba usa para acotar sus relaciones. */
  readonly id: string;
  /** Usuario aleatorio para el login del navegador. */
  readonly username: string;
  /** Contraseña efímera mantenida en memoria hasta cerrar la prueba. */
  readonly password: string;
}

/** Solicitud observada por la ruta simulada sin conservar el contenido XML. */
interface ObservacionPreview {
  /** Método HTTP recibido por el navegador. */
  readonly metodo: string;
  /** Indica si el request se codificó como multipart. */
  readonly multipart: boolean;
  /** Indica presencia de protección CSRF sin retener el token. */
  readonly csrfPresente: boolean;
  /** Número de archivos sintéticos hallado en el cuerpo en memoria. */
  readonly archivos: number;
  /** Indica que el perfil y estatus aprobados llegaron como query. */
  readonly contextoPresente: boolean;
  /** Selecciones sintéticas observadas sin conservar XML, cookies ni CSRF. */
  readonly seleccionesSociedad: readonly SeleccionSociedadArchivoRf1Contrato[];
}

const idCliente = randomUUID();
const idClienteSinCapacidad = randomUUID();
const idAmbiente = randomUUID();
const idPerfil = randomUUID();
const nombreCliente = `Cliente preview ${randomUUID().slice(0, 8)}`;
const nombreClienteSinCapacidad = `Cliente sin lectura ${randomUUID().slice(0, 8)}`;
let baseDatos: BaseDatosAuth | null = null;
let baseDatosMigrador: BaseDatosAuth | null = null;
let cuentaAdmin: CuentaPreviewE2e | null = null;
let cuentaSupport: CuentaPreviewE2e | null = null;
let cuentaSinAsignacion: CuentaPreviewE2e | null = null;

/**
 * Prepara cuentas, cliente, ambiente y permisos dentro de PostgreSQL aislado.
 * @returns Promesa que resuelve cuando todos los fixtures sintéticos están listos.
 * @throws Error si falta configuración o PostgreSQL rechaza una inserción de pruebas.
 * @effects Escribe exclusivamente en el esquema portal de `portal_soporte_test`.
 */
test.beforeAll(async () => {
  const configuracionApp = cargarConfiguracionConexionPrueba(
    { ...process.env, NODE_ENV: 'test' },
    'portal_test_app',
  );
  baseDatos = crearClienteBaseDatosAuth({
    ...process.env,
    NODE_ENV: 'test',
    TEST_DATABASE_ROLE: 'portal_test_app',
    DATABASE_URL: configuracionApp.DATABASE_URL,
  });
  const configuracionMigrador = cargarConfiguracionConexionPrueba(
    { ...process.env, NODE_ENV: 'test', TEST_DATABASE_ROLE: 'portal_test_migrator' },
    'portal_test_migrator',
  );
  baseDatosMigrador = crearClienteBaseDatosAuth({
    ...process.env,
    NODE_ENV: 'test',
    TEST_DATABASE_ROLE: 'portal_test_migrator',
    DATABASE_URL: configuracionMigrador.DATABASE_URL,
  });

  const hasheador = new Argon2PasswordHasher();
  cuentaAdmin = await crearCuentaSintetica(baseDatos, hasheador, 'ADMIN');
  cuentaSupport = await crearCuentaSintetica(baseDatos, hasheador, 'SUPPORT');
  cuentaSinAsignacion = await crearCuentaSintetica(baseDatos, hasheador, 'SUPPORT');
  await baseDatos.insert(clients).values({
    id: idCliente,
    displayName: nombreCliente,
    status: 'ACTIVE',
    createdByUserId: cuentaAdmin.id,
  });
  await baseDatos.insert(clients).values({
    id: idClienteSinCapacidad,
    displayName: nombreClienteSinCapacidad,
    status: 'ACTIVE',
    createdByUserId: cuentaAdmin.id,
  });
  await baseDatos.insert(clientSapEnvironments).values({
    id: idAmbiente,
    clientId: idCliente,
    code: 'QA-01',
    displayName: 'Ambiente SAP de prueba',
    status: 'ACTIVE',
  });
  const ahora = new Date();
  await baseDatos.insert(clientUserAssignments).values({
    id: randomUUID(),
    clientId: idCliente,
    userId: cuentaSupport.id,
    grantedByUserId: cuentaAdmin.id,
    grantedAt: ahora,
  });
  await baseDatos.insert(clientCapabilities).values({
    clientId: idCliente,
    capabilityId: 'rf-1:read',
    enabled: true,
    changedByUserId: cuentaAdmin.id,
    changedAt: ahora,
  });
  await baseDatos.insert(clientCapabilities).values({
    clientId: idCliente,
    capabilityId: 'rf-1:execute',
    enabled: false,
    changedByUserId: cuentaAdmin.id,
    changedAt: ahora,
  });
});

/**
 * Elimina exclusivamente relaciones y cuentas sintéticas creadas por este archivo.
 * @returns Promesa que termina después de cerrar las conexiones de prueba.
 * @throws Error si la limpieza acotada encuentra una restricción inesperada.
 * @effects No limpia filas por nombre amplio ni recursos fuera de los UUID propios.
 */
test.afterAll(async () => {
  if (baseDatosMigrador !== null) {
    const idsUsuarios = [cuentaAdmin?.id, cuentaSupport?.id, cuentaSinAsignacion?.id].filter(
      (id): id is string => id !== undefined,
    );
    await baseDatosMigrador
      .delete(clientUserAssignments)
      .where(eq(clientUserAssignments.clientId, idCliente));
    await baseDatosMigrador
      .delete(clientCapabilities)
      .where(eq(clientCapabilities.clientId, idCliente));
    await baseDatosMigrador
      .delete(clientSapEnvironments)
      .where(eq(clientSapEnvironments.clientId, idCliente));
    await baseDatosMigrador
      .delete(clients)
      .where(inArray(clients.id, [idCliente, idClienteSinCapacidad]));

    if (idsUsuarios.length > 0) {
      await baseDatosMigrador
        .delete(recoveryTokens)
        .where(inArray(recoveryTokens.userId, idsUsuarios));
      await baseDatosMigrador.delete(sessions).where(inArray(sessions.userId, idsUsuarios));
      await baseDatosMigrador
        .delete(auditEvents)
        .where(
          or(
            inArray(auditEvents.actorUserId, idsUsuarios),
            inArray(auditEvents.targetUserId, idsUsuarios),
          ),
        );
      const hashesIntentos = calcularHashesLimitador([
        cuentaAdmin?.username,
        cuentaSupport?.username,
        cuentaSinAsignacion?.username,
      ]);
      if (hashesIntentos.length > 0) {
        await baseDatosMigrador
          .delete(authThrottleWindows)
          .where(inArray(authThrottleWindows.keyHash, hashesIntentos));
      }
      await baseDatosMigrador.delete(users).where(inArray(users.id, idsUsuarios));
    }
  }

  await baseDatosMigrador?.$client.end({ timeout: 5 });
  await baseDatos?.$client.end({ timeout: 5 });
  baseDatosMigrador = null;
  baseDatos = null;
});

/**
 * Verifica vista previa sintética SUPPORT con estados listos, bloqueados y pendientes.
 * @param fixtures - Página autenticada y navegador para solicitudes de red controladas.
 * @returns Promesa que finaliza tras comprobar el contrato multipart y los estados por archivo.
 * @throws Error de Playwright si la página, el límite, la respuesta o la autorización no coinciden.
 * @effects Autentica SUPPORT con PostgreSQL real de prueba y simula solo perfil/preview MySQL.
 */
test('SUPPORT autorizado carga XML y ve resultados de preview sin inserción', async ({ page }) => {
  const observaciones: ObservacionPreview[] = [];
  await instalarPerfilSimulado(page, '/api/v1/clients');
  await instalarRespuestaPreview(page, resultadosMixtos(), observaciones, [
    resultadosSeleccionados(),
  ]);
  await iniciarSesion(page, cuentaSupport);
  await page.getByRole('link', { name: 'Insertar Facturas en BD' }).click();
  await expect(page.getByRole('heading', { name: 'Insertar Facturas en BD' })).toBeVisible();
  await expect(
    page.getByText(
      'La vista previa es de solo lectura; cualquier inserción requiere confirmación explícita y permisos vigentes.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel('Cliente').selectOption(idCliente);
  await expect(page.getByText('Ambiente SAP de prueba', { exact: true })).toBeVisible();
  await page.getByLabel('Perfil de conexión').selectOption(idPerfil);
  await expect(page.getByText('Entorno operativo: Pruebas', { exact: true })).toBeVisible();

  await page
    .getByLabel('Archivos CFDI XML')
    .setInputFiles([
      archivoXml('factura-lista.xml'),
      archivoXml('factura-sociedades.xml'),
      archivoXml('factura-duplicada.xml'),
      archivoXml('factura-malformada.xml'),
    ]);
  await expect(page.getByText('4 archivos listos para analizar.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Analizar vista previa' }).click();

  const resultados = page.getByRole('table', {
    name: 'Resultados de vista previa de Insertar Facturas en BD',
  });
  await expect(resultados).toBeVisible();
  await expect(resultados.getByText('factura-lista.xml')).toBeVisible();
  await expect(resultados.getByText('Vista previa completa')).toBeVisible();
  await expect(resultados.getByText('SUP-42')).toBeVisible();
  await expect(resultados.getByText('factura-duplicada.xml')).toBeVisible();
  await expect(resultados.getByText('UUID duplicado')).toBeVisible();
  await expect(resultados.getByText('factura-malformada.xml')).toBeVisible();
  await expect(resultados.getByText('XML mal formado')).toBeVisible();
  await expect(resultados.getByText('La sociedad requiere una selección explícita.')).toBeVisible();
  await page
    .getByLabel('Sociedad y ambiente SAP para archivo 2: factura-sociedades.xml')
    .selectOption({ label: '2000 · ERP-DEV' });
  await expect(page.getByRole('button', { name: 'Validar selecciones de sociedad' })).toBeEnabled();
  await page.getByRole('button', { name: 'Validar selecciones de sociedad' }).click();
  await expect(resultados.getByText(/2000 · ERP-DEV · SUP-42/u)).toBeVisible();
  await expect(resultados.getByText('Vista previa completa')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /confirmar inserción/i })).toHaveCount(0);

  expect(observaciones).toEqual([
    {
      metodo: 'POST',
      multipart: true,
      csrfPresente: true,
      archivos: 4,
      contextoPresente: true,
      seleccionesSociedad: [],
    },
    {
      metodo: 'POST',
      multipart: true,
      csrfPresente: true,
      archivos: 4,
      contextoPresente: true,
      seleccionesSociedad: [{ indiceArchivo: 1, sociedad: '2000', ambienteSap: 'ERP-DEV' }],
    },
  ]);
});

/**
 * Verifica que ADMIN usa su catálogo y que la presentación no expone metadatos internos.
 * @param fixtures - Página Playwright para el flujo ADMIN sintético.
 * @returns Promesa que resuelve al comprobar entorno, perfil y datos de preview.
 * @throws Error de Playwright si el catálogo o la presentación no son válidos.
 * @effects La petición de preview se simula; identidad y clientes vienen de PostgreSQL aislado.
 */
test('ADMIN selecciona un cliente activo y obtiene una fila lista para revisión', async ({
  page,
}) => {
  const observaciones: ObservacionPreview[] = [];
  await instalarPerfilSimulado(page, '/api/v1/admin/clients');
  await instalarRespuestaPreview(page, [resultadoListo()], observaciones);
  await iniciarSesion(page, cuentaAdmin);
  await page.getByRole('link', { name: 'Insertar Facturas en BD' }).click();
  await expect(
    page.getByLabel('Cliente').getByRole('option', { name: nombreCliente, exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByLabel('Cliente').getByRole('option', {
      name: nombreClienteSinCapacidad,
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByLabel('Cliente').selectOption(idCliente);
  await page.getByLabel('Perfil de conexión').selectOption(idPerfil);
  await expect(page.getByText('Entorno operativo: Pruebas', { exact: true })).toBeVisible();
  await page.getByLabel('Archivos CFDI XML').setInputFiles(archivoXml('solo-preview.xml'));
  await page.getByRole('button', { name: 'Analizar vista previa' }).click();
  await expect(
    page.getByRole('table', { name: 'Resultados de vista previa de Insertar Facturas en BD' }),
  ).toContainText('SUP-42');
  await expect(
    page.getByText(
      'La vista previa es de solo lectura; cualquier inserción requiere confirmación explícita y permisos vigentes.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirmar inserción de 1 factura' }),
  ).toBeDisabled();
  await expect(page.getByText(/compuerta global del servidor/u)).toBeVisible();
  await expect(page.getByText('destino-sintetico-interno', { exact: true })).toHaveCount(0);
  await expect(page.getByText('base_sintetica_interna', { exact: true })).toHaveCount(0);
  expect(observaciones).toHaveLength(1);
});

/**
 * Comprueba que SUPPORT sin asignación no ve clientes y el backend deniega el perfil/preview.
 * @param fixtures - Página autenticada con cuenta SUPPORT sintética sin asignación.
 * @returns Promesa que termina al verificar el vacío y las dos respuestas 403 reales.
 * @throws Error de Playwright si el API deja consultar un perfil o una vista previa ajenos.
 * @effects El POST de preview llega al Fastify real y se deniega antes de abrir un conector.
 */
test('SUPPORT sin asignación queda vacío y recibe 403 del backend', async ({ page }) => {
  await iniciarSesion(page, cuentaSinAsignacion);
  await page.getByRole('link', { name: 'Insertar Facturas en BD' }).click();
  await expect(page.getByRole('heading', { name: 'Insertar Facturas en BD' })).toBeVisible();
  await expect(
    page.getByText('No tienes clientes asignados con la vista previa habilitada.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Archivos CFDI XML')).toHaveCount(0);

  const respuestas = await page.evaluate(
    async ({ clientId, profileId }) => {
      const csrfResponse = await fetch('/api/v1/auth/csrf', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const csrf = (await csrfResponse.json()) as { token: string };
      const perfiles = await fetch(`/api/v1/clients/${clientId}/connection-profiles`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const datos = new FormData();
      datos.append('files', new File(['<cfdi/>'], 'sintetico.xml', { type: 'application/xml' }));
      const preview = await fetch(
        `/api/v1/clients/${clientId}/modules/rf-1/preview?${new URLSearchParams({ profileId, estatus: 'PAGADA' })}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'x-csrf-token': csrf.token },
          body: datos,
        },
      );
      const error = (await preview.json()) as { code?: string };
      return { perfiles: perfiles.status, preview: preview.status, codigo: error.code ?? null };
    },
    { clientId: idCliente, profileId: idPerfil },
  );

  expect(respuestas).toEqual({
    perfiles: 403,
    preview: 403,
    codigo: 'CLIENT_ACCESS_DENIED',
  });
});

/** Bloquea cantidad y tamaños fuera de política antes de enviar una petición al API. */
test('la carga limita número de archivos y tamaños individual y agregado', async ({ page }) => {
  await instalarPerfilSimulado(page, '/api/v1/clients');
  await iniciarSesion(page, cuentaSupport);
  await page.getByRole('link', { name: 'Insertar Facturas en BD' }).click();
  await page.getByLabel('Cliente').selectOption(idCliente);
  await page.getByLabel('Perfil de conexión').selectOption(idPerfil);
  const selector = page.getByLabel('Archivos CFDI XML');

  await selector.setInputFiles(
    Array.from({ length: 101 }, (_valor, indice) => archivoXml(`lote-${indice}.xml`)),
  );
  await expect(
    page.getByText('Selecciona como máximo 100 archivos XML.', { exact: true }),
  ).toBeVisible();

  await selector.setInputFiles({
    name: 'archivo-grande.xml',
    mimeType: 'application/xml',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(
    page.getByText('Cada archivo debe medir como máximo 5 MiB.', { exact: true }),
  ).toBeVisible();

  await selector.setInputFiles(
    Array.from({ length: 26 }, (_valor, indice) => ({
      name: `agregado-${indice}.xml`,
      mimeType: 'application/xml',
      buffer: Buffer.alloc(1024 * 1024),
    })),
  );
  await expect(
    page.getByText('El tamaño total no puede superar 25 MiB.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analizar vista previa' })).toBeDisabled();
});

/** Crea una cuenta activa aleatoria y guarda únicamente su hash Argon2id. */
async function crearCuentaSintetica(
  baseDatosPrueba: BaseDatosAuth,
  hasheador: Argon2PasswordHasher,
  rol: 'ADMIN' | 'SUPPORT',
): Promise<CuentaPreviewE2e> {
  const id = randomUUID();
  const username = `e2e_${rol.toLowerCase()}_preview_${randomUUID().replaceAll('-', '')}`;
  const email = `${username}@example.test`;
  const password = randomBytes(32).toString('base64url');
  const ahora = new Date();
  await baseDatosPrueba.insert(users).values({
    id,
    username,
    usernameNormalized: username.toLowerCase(),
    displayName: `Cuenta sintética ${rol}`,
    email,
    emailNormalized: email.toLowerCase(),
    emailVerifiedAt: ahora,
    passwordHash: await hasheador.hash(password),
    role: rol,
    status: 'ACTIVE',
    createdAt: ahora,
    updatedAt: ahora,
  });
  return { id, username, password };
}

/** Autentica una cuenta de la fixture y espera la ruta privada del dashboard. */
async function iniciarSesion(pagina: Page, cuenta: CuentaPreviewE2e | null): Promise<void> {
  if (cuenta === null) {
    throw new Error('La fixture de cuenta E2E no está disponible.');
  }
  await pagina.goto('/login');
  await pagina.getByLabel('Nombre de usuario').fill(cuenta.username);
  await pagina.getByLabel('Contraseña').fill(cuenta.password);
  await pagina.getByRole('button', { name: 'Continuar' }).click();
  await expect(pagina).toHaveURL(/\/dashboard$/u);
}

/** Instala un perfil de conexión redactado para los endpoints de cada rol. */
async function instalarPerfilSimulado(pagina: Page, prefijo: string): Promise<void> {
  const perfil =
    prefijo === '/api/v1/admin/clients'
      ? {
          id: idPerfil,
          clientId: idCliente,
          nombre: 'Conexión de laboratorio',
          tipo: 'MYSQL_TCP',
          entorno: 'TEST',
          destinoMySql: { hostname: 'mysql.preview.test', port: 3306 },
          gatewaySsh: null,
          baseDatos: 'base_sintetica_interna',
          estado: 'ACTIVE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      : {
          id: idPerfil,
          clientId: idCliente,
          nombre: 'Conexión de laboratorio',
          tipo: 'MYSQL_TCP',
          entorno: 'TEST',
          estado: 'ACTIVE',
        };
  await pagina.route(`**${prefijo}/${idCliente}/connection-profiles`, async (ruta) => {
    await ruta.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([perfil]),
    });
  });
}

/** Intercepta HTTP de preview y registra elecciones sintéticas sin XML ni tokens.
 * @param pagina - Página Playwright del flujo RF-1.
 * @param resultados - Respuesta controlada para la primera petición.
 * @param observaciones - Salida de metadatos seguros comprobados por el caso E2E.
 * @param respuestasAdicionales - Respuestas secuenciales para revalidar elecciones.
 * @returns Promesa resuelta cuando queda instalada la ruta de red.
 */
async function instalarRespuestaPreview(
  pagina: Page,
  resultados: readonly ResultadoArchivoVistaPreviaRf1Contrato[],
  observaciones: ObservacionPreview[],
  respuestasAdicionales: readonly (readonly ResultadoArchivoVistaPreviaRf1Contrato[])[] = [],
): Promise<void> {
  const respuestas = [resultados, ...respuestasAdicionales];
  let indiceRespuesta = 0;
  await pagina.route(
    `**/api/v1/clients/${idCliente}/modules/rf-1/preview?*`,
    async (ruta: Route) => {
      const solicitud = ruta.request();
      const headers = await solicitud.allHeaders();
      const url = new URL(solicitud.url());
      const cuerpo = solicitud.postDataBuffer() ?? Buffer.alloc(0);
      const seleccionesSociedad = leerSeleccionesMultipart(cuerpo);
      const archivos = [
        'factura-lista.xml',
        'factura-sociedades.xml',
        'factura-duplicada.xml',
        'factura-malformada.xml',
        'solo-preview.xml',
      ].filter((nombre) => cuerpo.includes(Buffer.from(nombre, 'utf8'))).length;
      observaciones.push({
        metodo: solicitud.method(),
        multipart: (headers['content-type'] ?? '').includes('multipart/form-data'),
        csrfPresente: typeof headers['x-csrf-token'] === 'string',
        archivos,
        contextoPresente:
          url.searchParams.get('profileId') === idPerfil &&
          (url.searchParams.get('estatus') === 'PAGADA' ||
            url.searchParams.get('estatus') === 'CONTABILIZADO'),
        seleccionesSociedad,
      });
      await ruta.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          resultados: respuestas[indiceRespuesta++] ?? respuestas.at(-1),
          executionAvailable: false,
          confirmationToken: null,
        }),
      });
    },
  );
}

/** Lee solo la selección sintética del multipart observado por E2E.
 * @param cuerpo - Buffer efímero creado exclusivamente por el navegador de prueba.
 * @returns Selecciones tipadas sin almacenar el XML del cuerpo.
 * @throws Error si el campo sintético no contiene JSON válido.
 */
function leerSeleccionesMultipart(cuerpo: Buffer): ObservacionPreview['seleccionesSociedad'] {
  const marcaCampo = Buffer.from('name="seleccionesSociedad"', 'utf8');
  const inicioCampo = cuerpo.indexOf(marcaCampo);
  if (inicioCampo < 0) {
    return [];
  }
  const separador = Buffer.from('\r\n\r\n', 'utf8');
  const inicioJson = cuerpo.indexOf(separador, inicioCampo) + separador.byteLength;
  const finJson = cuerpo.indexOf(Buffer.from('\r\n', 'utf8'), inicioJson);
  if (inicioJson < separador.byteLength || finJson < inicioJson) {
    throw new Error('El multipart sintético no contiene una selección válida.');
  }
  return JSON.parse(
    cuerpo.subarray(inicioJson, finJson).toString('utf8'),
  ) as ObservacionPreview['seleccionesSociedad'];
}

/** Produce un CFDI de ingreso sintético solo para el cuerpo efímero del navegador. */
function archivoXml(name: string): { name: string; mimeType: string; buffer: Buffer } {
  return {
    name,
    mimeType: 'application/xml',
    buffer: Buffer.from('<cfdi:Comprobante Version="4.0" TipoDeComprobante="I"/>', 'utf8'),
  };
}

/** Devuelve el resultado READY usado para verificar que la tabla representa una sola lectura. */
function resultadoListo(): ResultadoArchivoVistaPreviaRf1Contrato {
  return {
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
      referencia: 'SERIE-1',
      tipoComprobante: 'I',
      importeIvaFAC: '16.00',
      retencionIsr: '0.00',
      retencionIva: '0.00',
      retencionIeps: '0.00',
    },
    resolution: { sociedad: '1000', ambienteSap: 'ERP-QA', idProveedor: 'SUP-42' },
    estatus: 'PAGADA',
  };
}

/** Combina una fila lista y bloqueos sintéticos para validar el resultado parcial por archivo. */
function resultadosMixtos(): readonly ResultadoArchivoVistaPreviaRf1Contrato[] {
  const factura = resultadoListo().factura;
  if (factura === undefined) {
    throw new Error('La fixture requiere campos fiscales sintéticos.');
  }
  return [
    resultadoListo(),
    {
      status: 'NEEDS_SELECTION',
      errorCode: 'RF1_SOCIETY_SELECTION_REQUIRED',
      factura,
      sociedadesDisponibles: [
        { sociedad: '1000', ambienteSap: 'ERP-QA' },
        { sociedad: '2000', ambienteSap: 'ERP-DEV' },
      ],
    },
    { status: 'BLOCKED', errorCode: 'RF1_DUPLICATE_UUID', factura },
    { status: 'BLOCKED', errorCode: 'XML_MALFORMED' },
  ];
}

/** Devuelve la respuesta tras revalidar la sociedad sintética elegida.
 * @returns Resultados de preview que resuelven solo la fila seleccionada.
 * @throws Error si falta la factura sintética pendiente.
 */
function resultadosSeleccionados(): readonly ResultadoArchivoVistaPreviaRf1Contrato[] {
  const resultados = resultadosMixtos();
  const factura = resultados[1]?.factura;
  if (factura === undefined) {
    throw new Error('La fixture requiere una factura sintética pendiente de selección.');
  }
  return [
    resultados[0]!,
    {
      status: 'READY',
      factura,
      resolution: { sociedad: '2000', ambienteSap: 'ERP-DEV', idProveedor: 'SUP-42' },
      estatus: 'PAGADA',
    },
    resultados[2]!,
    resultados[3]!,
  ];
}

/** Deriva los hashes HMAC necesarios para retirar intentos de login sintéticos de esta suite. */
function calcularHashesLimitador(identificadores: readonly (string | undefined)[]): string[] {
  const claveConfigurada = process.env['PORTAL_TEST_AUTH_HMAC_KEY'];
  if (claveConfigurada === undefined) {
    throw new Error('Falta la clave efímera del limitador E2E.');
  }
  const claveHmac = Buffer.from(claveConfigurada, 'base64url');
  if (claveHmac.length < 32) {
    throw new Error('La clave efímera del limitador E2E no cumple la longitud mínima.');
  }
  const hashes = new Set<string>();
  for (const identificador of identificadores) {
    if (identificador === undefined) {
      continue;
    }
    const username = identificador.toLowerCase();
    for (const [scope, value] of [
      ['LOGIN_ACCOUNT', username],
      ['LOGIN_NETWORK', ''],
    ] as const) {
      const ip = '127.0.0.1';
      const material = `${scope}\0${value.length}:${value}\0${ip.length}:${ip}`;
      hashes.add(createHmac('sha256', claveHmac).update(material, 'utf8').digest('hex'));
    }
  }
  return [...hashes];
}
