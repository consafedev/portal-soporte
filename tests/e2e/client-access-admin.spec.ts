import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray, or } from 'drizzle-orm';
import { expect, test, type Page } from '@playwright/test';
import { Argon2PasswordHasher } from '../../apps/api/src/auth/argon2-password-hasher.js';
import { cargarConfiguracionConexionPrueba } from '../../apps/api/src/runtime-config.js';
import { crearClienteBaseDatosAuth, type BaseDatosAuth } from '../../apps/api/src/db/client.js';
import {
  auditEvents,
  authThrottleWindows,
  clientCapabilities,
  clientUserAssignments,
  clients,
  recoveryTokens,
  sessions,
  users,
} from '../../apps/api/src/db/schema.js';

/** Cuenta sintética que el navegador puede usar sin revelar credenciales reales. */
interface CuentaE2e {
  /** Identificador persistido para validar límites del backend. */
  readonly id: string;
  /** Nombre de usuario aleatorio limitado a esta ejecución. */
  readonly usuario: string;
  /** Contraseña efímera retenida únicamente en memoria. */
  readonly contrasena: string;
}

let baseDatos: BaseDatosAuth | null = null;
let baseDatosMigrador: BaseDatosAuth | null = null;
let administrador: CuentaE2e;
let soporte: CuentaE2e;
let idCliente: string;
let nombreCliente: string;

/**
 * Crea ADMIN, SUPPORT y cliente sintéticos dentro de PostgreSQL de pruebas aislado.
 * @returns Promesa que resuelve cuando los fixtures están listos para Playwright.
 * @throws Error si la configuración o una inserción en la base de prueba falla.
 * @effects Escribe solo en el esquema portal de `portal_soporte_test` con roles de prueba.
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
  administrador = await crearCuentaSintetica(baseDatos, hasheador, 'ADMIN');
  soporte = await crearCuentaSintetica(baseDatos, hasheador, 'SUPPORT');
  idCliente = randomUUID();
  nombreCliente = `Cliente de acceso ${randomUUID().slice(0, 8)}`;
  await baseDatos.insert(clients).values({
    id: idCliente,
    displayName: nombreCliente,
    status: 'ACTIVE',
    createdByUserId: administrador.id,
  });
});

/**
 * Retira solo filas creadas por esta suite y cierra sus clientes PostgreSQL.
 * @returns Promesa que resuelve tras limpiar y cerrar las conexiones de prueba.
 * @throws Error si la base de prueba rechaza la limpieza acotada a los IDs sintéticos.
 * @effects No elimina recursos que no fueron creados por este archivo E2E.
 */
test.afterAll(async () => {
  if (baseDatosMigrador !== null) {
    const idsUsuarios = [administrador?.id, soporte?.id].filter(
      (id): id is string => id !== undefined,
    );
    if (idCliente !== undefined) {
      await baseDatosMigrador
        .delete(clientUserAssignments)
        .where(eq(clientUserAssignments.clientId, idCliente));
      await baseDatosMigrador
        .delete(clientCapabilities)
        .where(eq(clientCapabilities.clientId, idCliente));
      await baseDatosMigrador.delete(clients).where(eq(clients.id, idCliente));
    }
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
      const hashesIntentos = calcularHashesLimitador([administrador?.usuario, soporte?.usuario]);
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
 * Comprueba que ADMIN asigne/revoque SUPPORT y habilite solo lectura de RF-1.
 * @param fixtures - Página Playwright y contexto de navegador usados por el flujo.
 * @returns Promesa que resuelve cuando UI, API, auditoría y revocación inmediata coinciden.
 * @throws Error de Playwright ante una respuesta, estado o capacidad incorrecta.
 * @effects Usa exclusivamente identidades y cliente sintéticos en PostgreSQL aislado.
 */
test('ADMIN administra asignaciones y capacidad de vista previa sin mostrar secretos', async ({
  page,
  browser,
}) => {
  await iniciarSesion(page, administrador);
  await page.goto('/settings/clients');
  const tarjeta = page.getByRole('article', { name: nombreCliente });
  await expect(tarjeta).toBeVisible();
  await tarjeta.getByText('Editar y administrar ambientes SAP').click();

  const seccionAcceso = tarjeta.getByRole('region', {
    name: 'Acceso de usuarios y capacidades',
  });
  await expect(seccionAcceso).toBeVisible();
  const seleccionSoporte = seccionAcceso.getByLabel('Cuenta SUPPORT');
  await expect(seleccionSoporte).toBeVisible();
  await seleccionSoporte.selectOption(soporte.id);
  await seccionAcceso.getByRole('button', { name: 'Asignar acceso' }).click();
  await expect(seccionAcceso.getByText(`@${soporte.usuario}`, { exact: true })).toBeVisible();
  await expect(seccionAcceso.getByText('Acceso vigente', { exact: true })).toBeVisible();

  const capacidadLectura = seccionAcceso.getByRole('checkbox', {
    name: 'Permitir vista previa RF-1',
  });
  await expect(capacidadLectura).not.toBeChecked();
  await capacidadLectura.check();
  await expect(capacidadLectura).toBeChecked();
  await expect(page.locator('.aviso-exito')).toContainText('La capacidad de lectura se actualizó.');

  const capacidadEjecucion = seccionAcceso.getByRole('checkbox', {
    name: 'Permitir inserción RF-1',
  });
  await expect(capacidadEjecucion).not.toBeChecked();
  await capacidadEjecucion.check();
  await expect(capacidadEjecucion).toBeChecked();
  await expect(page.locator('.aviso-exito')).toContainText(
    'La capacidad de ejecución por cliente se actualizó.',
  );

  const respuesta = await page.evaluate(async (clientId) => {
    const consulta = await fetch(`/api/v1/admin/clients/${clientId}/access`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return (await consulta.json()) as {
      asignaciones: readonly { userId: string; revokedAt: string | null }[];
      capacidades: readonly { capabilityId: string; enabled: boolean }[];
    };
  }, idCliente);
  expect(
    respuesta.asignaciones.some((fila) => fila.userId === soporte.id && fila.revokedAt === null),
  ).toBe(true);
  expect(
    respuesta.capacidades.some((fila) => fila.capabilityId === 'rf-1:read' && fila.enabled),
  ).toBe(true);
  expect(
    respuesta.capacidades.some((fila) => fila.capabilityId === 'rf-1:execute' && fila.enabled),
  ).toBe(true);
  const respuestaRedactada = await page.evaluate(async (clientId) => {
    const consulta = await fetch(`/api/v1/admin/clients/${clientId}/access`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return await consulta.text();
  }, idCliente);
  expect(respuestaRedactada).not.toMatch(/secretEnvelope|privateKey|password|credential/iu);

  const contextoSoporte = await browser.newContext();
  try {
    const paginaSoporte = await contextoSoporte.newPage();
    await iniciarSesion(paginaSoporte, soporte);
    const accesoSoporte = await paginaSoporte.evaluate(async (clientId) => {
      const clientesResponse = await fetch('/api/v1/clients', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const perfilesResponse = await fetch(`/api/v1/clients/${clientId}/connection-profiles`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const ambientesResponse = await fetch(`/api/v1/clients/${clientId}/sap-environments`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const clientes = (await clientesResponse.json()) as readonly { id: string }[];
      return {
        clienteAsignado: clientes.some((cliente) => cliente.id === clientId),
        perfilesStatus: perfilesResponse.status,
        ambientesStatus: ambientesResponse.status,
      };
    }, idCliente);
    expect(accesoSoporte).toEqual({
      clienteAsignado: true,
      perfilesStatus: 200,
      ambientesStatus: 200,
    });

    await seccionAcceso.getByRole('button', { name: 'Revocar acceso' }).click();
    await expect(
      seccionAcceso.getByText('No hay cuentas SUPPORT con acceso vigente.'),
    ).toBeVisible();
    const estadoRevocado = await paginaSoporte.evaluate(async (clientId) => {
      const clientesResponse = await fetch('/api/v1/clients', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const perfilesResponse = await fetch(`/api/v1/clients/${clientId}/connection-profiles`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const clientes = (await clientesResponse.json()) as readonly { id: string }[];
      return {
        clienteAsignado: clientes.some((cliente) => cliente.id === clientId),
        perfilesStatus: perfilesResponse.status,
      };
    }, idCliente);
    expect(estadoRevocado).toEqual({ clienteAsignado: false, perfilesStatus: 403 });
  } finally {
    await contextoSoporte.close();
  }

  if (baseDatosMigrador === null) {
    throw new Error('La auditoría E2E requiere el rol migrador de PostgreSQL de pruebas.');
  }
  const eventos = await baseDatosMigrador
    .select({ accion: auditEvents.action, resultado: auditEvents.outcome })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.actorUserId, administrador.id),
        inArray(auditEvents.action, [
          'CLIENT_ACCESS_GRANTED',
          'CLIENT_ACCESS_REVOKED',
          'CLIENT_CAPABILITY_UPDATED',
        ]),
      ),
    );
  expect(new Set(eventos.map((evento) => evento.accion))).toEqual(
    new Set(['CLIENT_ACCESS_GRANTED', 'CLIENT_ACCESS_REVOKED', 'CLIENT_CAPABILITY_UPDATED']),
  );
  expect(eventos.every((evento) => evento.resultado === 'SUCCESS')).toBe(true);
});

/**
 * Comprueba que SUPPORT recibe 403 del backend en rutas de acceso administrativo.
 * @param fixtures - Página Playwright autenticada con identidad SUPPORT sintética.
 * @returns Promesa que termina al verificar 403 y la pantalla de denegación.
 * @throws Error de Playwright si una ruta administrativa permite la solicitud.
 * @effects Envía consultas y escrituras protegidas solo a la base aislada de pruebas.
 */
test('SUPPORT solo consulta clientes autorizados y recibe 403 al gestionar accesos', async ({
  page,
}) => {
  await iniciarSesion(page, soporte);
  const resultado = await page.evaluate(
    async ({ clientId, userId }) => {
      const respuestaCsrf = await fetch('/api/v1/auth/csrf', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const csrf = (await respuestaCsrf.json()) as { token: string };
      const operaciones: readonly { metodo: string; ruta: string; cuerpo?: string }[] = [
        { metodo: 'GET', ruta: `/api/v1/admin/clients/${clientId}/access` },
        {
          metodo: 'PUT',
          ruta: `/api/v1/admin/clients/${clientId}/access/users/${userId}`,
        },
        {
          metodo: 'DELETE',
          ruta: `/api/v1/admin/clients/${clientId}/access/users/${userId}`,
        },
        {
          metodo: 'PUT',
          ruta: `/api/v1/admin/clients/${clientId}/capabilities/rf-1%3Aread`,
          cuerpo: JSON.stringify({ enabled: true }),
        },
        { metodo: 'GET', ruta: '/api/v1/admin/clients' },
      ];
      const estados: number[] = [];
      for (const operacion of operaciones) {
        const encabezados: Record<string, string> = { 'x-csrf-token': csrf.token };
        if (operacion.cuerpo !== undefined) {
          encabezados['content-type'] = 'application/json';
        }
        const respuesta = await fetch(operacion.ruta, {
          method: operacion.metodo,
          credentials: 'same-origin',
          cache: 'no-store',
          headers: encabezados,
          ...(operacion.cuerpo === undefined ? {} : { body: operacion.cuerpo }),
        });
        estados.push(respuesta.status);
      }
      const clientes = await fetch('/api/v1/clients', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      return { estados, estadoClientesAutorizados: clientes.status };
    },
    { clientId: idCliente, userId: soporte.id },
  );

  expect(resultado.estados).toEqual([403, 403, 403, 403, 403]);
  expect(resultado.estadoClientesAutorizados).toBe(200);
  await page.goto('/settings/clients');
  await expect(
    page.getByRole('heading', { name: 'No tienes permiso para esta pantalla' }),
  ).toBeVisible();
});

/**
 * Inserta una cuenta de rol conocido y genera una contraseña aleatoria no persistente.
 * @param baseDatosPrueba Cliente de aplicación de PostgreSQL de pruebas.
 * @param hasheador Implementación Argon2id usada para guardar exclusivamente el hash.
 * @param rol Rol sintético permitido para el flujo E2E.
 * @returns Identidad, usuario y contraseña retenida en memoria para el navegador.
 * @throws Error si Argon2id o PostgreSQL fallan durante la creación.
 * @effects Inserta una cuenta activa sintética en `portal.users`.
 */
async function crearCuentaSintetica(
  baseDatosPrueba: BaseDatosAuth,
  hasheador: Argon2PasswordHasher,
  rol: 'ADMIN' | 'SUPPORT',
): Promise<CuentaE2e> {
  const id = randomUUID();
  const usuario = `e2e_${rol.toLowerCase()}_access_${randomUUID().replaceAll('-', '')}`;
  const correo = `${usuario}@example.test`;
  const contrasena = randomBytes(32).toString('base64url');
  const ahora = new Date();
  await baseDatosPrueba.insert(users).values({
    id,
    username: usuario,
    usernameNormalized: usuario.toLowerCase(),
    displayName: `Cuenta sintética ${rol}`,
    email: correo,
    emailNormalized: correo.toLowerCase(),
    emailVerifiedAt: ahora,
    passwordHash: await hasheador.hash(contrasena),
    role: rol,
    status: 'ACTIVE',
    createdAt: ahora,
    updatedAt: ahora,
  });
  return { id, usuario, contrasena };
}

/**
 * Autentica una cuenta E2E y espera la navegación protegida del dashboard.
 * @param pagina Página Chromium usada en el flujo.
 * @param cuenta Cuenta sintética con credencial efímera.
 * @returns Promesa que resuelve cuando la ruta protegida muestra la identidad.
 * @throws Error de Playwright si login o navegación no se completan.
 * @effects Envía la credencial solo al endpoint de autenticación del servidor local.
 */
async function iniciarSesion(pagina: Page, cuenta: CuentaE2e): Promise<void> {
  await pagina.goto('/login');
  await pagina.getByLabel('Nombre de usuario').fill(cuenta.usuario);
  await pagina.getByLabel('Contraseña').fill(cuenta.contrasena);
  await pagina.getByRole('button', { name: 'Continuar' }).click();
  await expect(pagina).toHaveURL(/\/dashboard$/u);
  await expect(
    pagina.getByRole('heading', { name: /^Hola, Cuenta sintética (ADMIN|SUPPORT)$/u }),
  ).toBeVisible();
}

/**
 * Deriva hashes HMAC de limitación para limpiar intentos de login de esta suite.
 * @param identificadores Usuarios sintéticos observados en el navegador.
 * @returns Hashes SHA-256 hexadecimales compatibles con las filas del limitador.
 * @throws Error si falta la clave HMAC efímera o no tiene la longitud requerida.
 * @effects No devuelve usuarios originales ni persiste la clave temporal.
 */
function calcularHashesLimitador(identificadores: readonly (string | undefined)[]): string[] {
  const claveConfigurada = process.env['PORTAL_TEST_AUTH_HMAC_KEY'];
  if (claveConfigurada === undefined) {
    throw new Error('Falta la clave efímera del limitador E2E.');
  }
  const claveHmac = Buffer.from(claveConfigurada, 'base64url');
  if (claveHmac.length < 32) {
    throw new Error('La clave efímera del limitador E2E no cumple la longitud mínima.');
  }
  const claves = new Set<string>();
  for (const identificador of identificadores) {
    if (identificador === undefined) {
      continue;
    }
    const normalizado = identificador.toLowerCase();
    for (const [alcance, valor] of [
      ['LOGIN_ACCOUNT', normalizado],
      ['LOGIN_NETWORK', ''],
    ] as const) {
      const direccionIp = '127.0.0.1';
      const material = `${alcance}\0${valor.length}:${valor}\0${direccionIp.length}:${direccionIp}`;
      claves.add(createHmac('sha256', claveHmac).update(material, 'utf8').digest('hex'));
    }
  }
  return [...claves];
}
