import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ejecutarRf1, previsualizarRf1 } from '../../apps/web/src/lib/rf1-preview-api.js';

const CLIENT_ID = '35b77fcb-0bf8-4d88-8b81-187dd30d5101';
const PROFILE_ID = '756d0604-b994-433b-b103-1e881ea908e7';
const CSRF = 'a'.repeat(43);
const XML_SINTETICO = '<c:Comprobante Id="UUID-SINTETICO" />';
const fetchMock = vi.fn<typeof fetch>();

/** Construye una respuesta JSON local para observar solo el contrato del cliente web. */
function crearRespuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  });
}

/** Prepara una respuesta CSRF sintética que cumple el esquema real de autenticación. */
function crearRespuestaCsrf(): Response {
  return crearRespuestaJson({ token: CSRF });
}

/** Crea un archivo exclusivamente sintético para verificar la carga multipart del navegador. */
function crearArchivoSintetico(nombre: string): File {
  return new File([XML_SINTETICO], nombre, { type: 'application/xml' });
}

describe('cliente HTTP same-origin para vista previa RF-1', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envía archivos multipart con CSRF sin caché ni destino externo', async () => {
    const archivoUno = crearArchivoSintetico('factura-sintetica-uno.xml');
    const archivoDos = crearArchivoSintetico('factura-sintetica-dos.xml');
    const resultado = {
      resultados: [{ status: 'BLOCKED', errorCode: 'XML_MALFORMED' }],
      executionAvailable: false,
      confirmationToken: null,
    };
    fetchMock
      .mockResolvedValueOnce(crearRespuestaCsrf())
      .mockResolvedValueOnce(crearRespuestaJson(resultado));

    await expect(
      previsualizarRf1(CLIENT_ID, PROFILE_ID, 'PAGADA', [archivoUno, archivoDos]),
    ).resolves.toEqual(resultado);

    const [ruta, opciones] = fetchMock.mock.calls[1] ?? [];
    expect(ruta).toBe(
      `/api/v1/clients/${CLIENT_ID}/modules/rf-1/preview?profileId=${PROFILE_ID}&estatus=PAGADA`,
    );
    expect(opciones).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'x-csrf-token': CSRF },
    });
    expect(opciones?.headers).not.toHaveProperty('content-type');
    expect(opciones?.body).toBeInstanceOf(FormData);
    const formulario = opciones?.body as FormData;
    expect([...formulario.keys()]).toEqual(['files', 'files']);
    expect(formulario.getAll('files')).toEqual([archivoUno, archivoDos]);
    expect(String(ruta)).not.toContain('filename');
  });

  it('envía la selección explícita por índice sin alterar los archivos del lote', async () => {
    const archivo = crearArchivoSintetico('factura-sociedades.xml');
    const selecciones = [{ indiceArchivo: 0, sociedad: '2000', ambienteSap: 'ERP-DEV' }];
    fetchMock.mockResolvedValueOnce(crearRespuestaCsrf()).mockResolvedValueOnce(
      crearRespuestaJson({
        resultados: [{ status: 'READY' }],
        executionAvailable: false,
        confirmationToken: null,
      }),
    );

    await previsualizarRf1(CLIENT_ID, PROFILE_ID, 'PAGADA', [archivo], selecciones);

    const formulario = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect([...formulario.keys()]).toEqual(['files', 'seleccionesSociedad']);
    expect(formulario.getAll('files')).toEqual([archivo]);
    expect(formulario.get('seleccionesSociedad')).toBe(JSON.stringify(selecciones));
  });

  it('envía la confirmación opaca en multipart con CSRF y sin caché', async () => {
    const archivo = crearArchivoSintetico('factura-confirmada.xml');
    const confirmacion = 'b'.repeat(43);
    const resultados = [{ status: 'INSERTADA_VERIFICADA' }];
    fetchMock
      .mockResolvedValueOnce(crearRespuestaCsrf())
      .mockResolvedValueOnce(crearRespuestaJson(resultados));

    await expect(
      ejecutarRf1(CLIENT_ID, PROFILE_ID, 'PAGADA', [archivo], confirmacion),
    ).resolves.toEqual(resultados);

    const [ruta, opciones] = fetchMock.mock.calls[1] ?? [];
    expect(ruta).toBe(
      `/api/v1/clients/${CLIENT_ID}/modules/rf-1/execute?profileId=${PROFILE_ID}&estatus=PAGADA`,
    );
    expect(opciones).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'x-csrf-token': CSRF },
    });
    const formulario = opciones?.body as FormData;
    expect([...formulario.keys()]).toEqual(['files', 'confirmationToken']);
    expect(formulario.get('confirmationToken')).toBe(confirmacion);
  });

  it('rechaza una respuesta fuera del contrato sin devolver sus campos extra', async () => {
    fetchMock.mockResolvedValueOnce(crearRespuestaCsrf()).mockResolvedValueOnce(
      crearRespuestaJson({
        resultados: [{ status: 'BLOCKED', errorCode: 'XML_MALFORMED', xmlOriginal: XML_SINTETICO }],
        executionAvailable: false,
        confirmationToken: null,
      }),
    );

    await expect(
      previsualizarRf1(CLIENT_ID, PROFILE_ID, 'CONTABILIZADO', [
        crearArchivoSintetico('prueba.xml'),
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('no expone XML, nombre de archivo ni detalle arbitrario ante un error HTTP', async () => {
    const xmlPrivado = '<Comprobante UUID="UUID_NO_PUBLICABLE" />';
    fetchMock
      .mockResolvedValueOnce(crearRespuestaCsrf())
      .mockResolvedValueOnce(
        crearRespuestaJson(
          { code: 'INTERNAL_ERROR', message: `${xmlPrivado} error en secreto.xml` },
          500,
        ),
      );

    await expect(
      previsualizarRf1(CLIENT_ID, PROFILE_ID, 'PAGADA', [crearArchivoSintetico('secreto.xml')]),
    ).rejects.toMatchObject({
      status: 500,
      message: expect.not.stringContaining('UUID_NO_PUBLICABLE'),
    });
  });

  it('detiene el envío si no puede obtener CSRF', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fallo_de_red_sintetico'));

    await expect(
      previsualizarRf1(CLIENT_ID, PROFILE_ID, 'PAGADA', [crearArchivoSintetico('prueba.xml')]),
    ).rejects.toMatchObject({ code: 'CSRF_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
