'use client';

import {
  useEffect,
  useState,
  type ChangeEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type {
  EstatusVistaPreviaRf1Contrato,
  ResultadoArchivoVistaPreviaRf1Contrato,
  ResultadoInsercionRf1Contrato,
  SeleccionSociedadArchivoRf1Contrato,
} from '@portal-soporte/contracts/clients';
import {
  ErrorApiClientes,
  listarAmbientesSapAdmin,
  listarPerfilesConexionAdmin,
} from '../../lib/client-admin-api';
import {
  listarAmbientesSapCliente,
  listarClientesAutorizados,
  listarPerfilesConexionCliente,
} from '../../lib/client-access-api';
import { ejecutarRf1, previsualizarRf1 } from '../../lib/rf1-preview-api';
import { useUsuarioAutenticado } from '../auth/auth-user-context';

const MAXIMO_ARCHIVOS = 100;
const MAXIMO_BYTES_ARCHIVO = 5 * 1024 * 1024;
const MAXIMO_BYTES_LOTE = 25 * 1024 * 1024;

/** Cliente activo común a las respuestas ADMIN y SUPPORT. */
interface ClienteSeleccionable {
  /** Identificador que el backend vuelve a validar en cada petición. */
  readonly id: string;
  /** Nombre visible redactado del cliente. */
  readonly nombre: string;
}

/** Perfil redactado que la pantalla puede seleccionar sin conocer destinos internos. */
interface PerfilSeleccionable {
  /** Identificador que el backend vuelve a validar junto con su cliente. */
  readonly id: string;
  /** Nombre que asignó ADMIN al perfil. */
  readonly nombre: string;
  /** Entorno funcional declarado para el cliente. */
  readonly entorno: 'PRODUCTION' | 'TEST';
}

/** Relaciona un nombre de archivo local con el resultado fiscal redactado. */
interface ResultadoConArchivo {
  /** Nombre presentado localmente; nunca se persiste ni se envía en auditoría. */
  readonly nombreArchivo: string;
  /** Índice cero basado que conserva la relación con el archivo original en memoria. */
  readonly indiceArchivo: number;
  /** Datos de preview retornados por el contrato del servidor. */
  readonly resultado: ResultadoArchivoVistaPreviaRf1Contrato;
}

/** Resultado de inserción vinculado al archivo local sin persistir su nombre. */
interface ResultadoInsercionConArchivo {
  /** Nombre local presentado únicamente en esta sesión de navegador. */
  readonly nombreArchivo: string;
  /** Resultado acotado que devuelve el motor transaccional RF-1. */
  readonly resultado: ResultadoInsercionRf1Contrato;
}

/** Par elegido dentro del catálogo autorizado, ligado en estado local al índice del archivo. */
type ParSociedadRf1 = Pick<SeleccionSociedadArchivoRf1Contrato, 'sociedad' | 'ambienteSap'>;

/** Presenta vista previa RF-1 y confirmación de inserción detrás de permisos y gate backend.
 * @returns Vista accesible para seleccionar cliente, perfil, XML y pares del catálogo autorizado.
 * @effects Conserva archivos y elecciones solo en memoria; el servidor decide si permite confirmar.
 */
export function VistaPreviaRf1(): JSX.Element {
  const usuario = useUsuarioAutenticado();
  const esAdmin = usuario.role === 'ADMIN';
  const [clientes, setClientes] = useState<readonly ClienteSeleccionable[]>([]);
  const [clienteId, setClienteId] = useState('');
  const [ambientes, setAmbientes] = useState<
    readonly { id: string; nombre: string; codigo: string }[]
  >([]);
  const [perfiles, setPerfiles] = useState<readonly PerfilSeleccionable[]>([]);
  const [perfilId, setPerfilId] = useState('');
  const [estatus, setEstatus] = useState<EstatusVistaPreviaRf1Contrato>('PAGADA');
  const [archivos, setArchivos] = useState<readonly File[]>([]);
  const [resultados, setResultados] = useState<readonly ResultadoConArchivo[]>([]);
  const [tokenConfirmacion, setTokenConfirmacion] = useState<string | null>(null);
  const [ejecucionDisponible, setEjecucionDisponible] = useState(false);
  const [resultadosInsercion, setResultadosInsercion] = useState<
    readonly ResultadoInsercionConArchivo[]
  >([]);
  const [seleccionesSociedad, setSeleccionesSociedad] = useState<
    Readonly<Record<number, ParSociedadRf1>>
  >({});
  const [cargandoClientes, setCargandoClientes] = useState(true);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [analizando, setAnalizando] = useState(false);
  const [insertando, setInsertando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /** Carga únicamente el catálogo que corresponde al rol ya confirmado por el marco. */
  useEffect(() => {
    let vigente = true;

    /** Solicita la lista del lado servidor y filtra estados inactivos en la presentación. */
    async function cargarClientes(): Promise<void> {
      try {
        const respuesta = await listarClientesAutorizados();
        if (vigente) {
          setClientes(
            respuesta
              .filter((cliente) => cliente.estado === 'ACTIVE')
              .map(({ id, nombre }) => ({ id, nombre })),
          );
          setError(null);
        }
      } catch (rechazo: unknown) {
        if (vigente) {
          setError(mensajeError(rechazo));
        }
      } finally {
        if (vigente) {
          setCargandoClientes(false);
        }
      }
    }

    void cargarClientes();
    return () => {
      vigente = false;
    };
  }, []);

  /** Consulta ambientes y perfiles del cliente seleccionado y descarta respuestas obsoletas. */
  useEffect(() => {
    let vigente = true;

    if (clienteId.length === 0) {
      return () => {
        vigente = false;
      };
    }

    /** Recupera metadatos pertenecientes al cliente, con autorización vigente en backend. */
    async function cargarDetalleCliente(): Promise<void> {
      setCargandoDetalle(true);
      setError(null);
      try {
        const [respuestaAmbientes, respuestaPerfiles] = await Promise.all([
          esAdmin ? listarAmbientesSapAdmin(clienteId) : listarAmbientesSapCliente(clienteId),
          esAdmin
            ? listarPerfilesConexionAdmin(clienteId)
            : listarPerfilesConexionCliente(clienteId),
        ]);
        if (vigente) {
          setAmbientes(
            respuestaAmbientes
              .filter((ambiente) => ambiente.estado === 'ACTIVE')
              .map(({ id, nombre, codigo }) => ({ id, nombre, codigo })),
          );
          setPerfiles(
            respuestaPerfiles
              .filter((perfil) => perfil.estado === 'ACTIVE')
              .map(({ id, nombre, entorno }) => ({ id, nombre, entorno })),
          );
        }
      } catch (rechazo: unknown) {
        if (vigente) {
          setError(mensajeError(rechazo));
        }
      } finally {
        if (vigente) {
          setCargandoDetalle(false);
        }
      }
    }

    void cargarDetalleCliente();
    return () => {
      vigente = false;
    };
  }, [clienteId, esAdmin]);

  /** Valida los archivos seleccionados en memoria antes de habilitar una subida. */
  function seleccionarArchivos(evento: ChangeEvent<HTMLInputElement>): void {
    const seleccion = Array.from(evento.currentTarget.files ?? []);
    setArchivos([]);
    setResultados([]);
    invalidarConfirmacionInsercion();
    setSeleccionesSociedad({});
    setAviso(null);
    setError(null);

    const errorValidacion = validarArchivos(seleccion);
    if (errorValidacion !== null) {
      setError(errorValidacion);
      evento.currentTarget.value = '';
      return;
    }

    setArchivos(seleccion);
    setAviso(
      `${seleccion.length} ${seleccion.length === 1 ? 'archivo listo' : 'archivos listos'} para analizar.`,
    );
  }

  /** Cambia de cliente y elimina del formulario cualquier dato del cliente anterior. */
  function manejarCambioCliente(evento: ChangeEvent<HTMLSelectElement>): void {
    const siguienteClienteId = evento.currentTarget.value;
    setClienteId(siguienteClienteId);
    setAmbientes([]);
    setPerfiles([]);
    setPerfilId('');
    setArchivos([]);
    setResultados([]);
    invalidarConfirmacionInsercion();
    setSeleccionesSociedad({});
    setAviso(null);
    setError(null);
    setCargandoDetalle(siguienteClienteId.length > 0);
  }

  /**
   * Envía el lote protegido con CSRF y conserva el resultado anterior mientras revalida.
   * @param selecciones - Pares elegidos por índice para que el servidor los vuelva a validar.
   * @returns Promesa resuelta al recibir y validar el contrato de vista previa.
   * @effects Conserva XML en memoria y no habilita escrituras.
   */
  async function analizarArchivos(
    selecciones: readonly SeleccionSociedadArchivoRf1Contrato[] = [],
  ): Promise<void> {
    if (clienteId.length === 0 || perfilId.length === 0 || archivos.length === 0) {
      return;
    }

    setAnalizando(true);
    invalidarConfirmacionInsercion();
    setError(null);
    setAviso(null);
    if (selecciones.length === 0) {
      setResultados([]);
      setSeleccionesSociedad({});
    }
    try {
      const respuesta = await previsualizarRf1(clienteId, perfilId, estatus, archivos, selecciones);
      setTokenConfirmacion(respuesta.confirmationToken);
      setEjecucionDisponible(respuesta.executionAvailable);
      setResultados(
        respuesta.resultados.map((resultado, indice) => ({
          nombreArchivo: archivos[indice]?.name ?? `Archivo ${indice + 1}`,
          indiceArchivo: indice,
          resultado,
        })),
      );
    } catch (rechazo: unknown) {
      setError(mensajeError(rechazo));
    } finally {
      setAnalizando(false);
    }
  }

  /** Borra ticket y resultados de cualquier lote anterior antes de cambiar contexto o entrada. */
  function invalidarConfirmacionInsercion(): void {
    setTokenConfirmacion(null);
    setEjecucionDisponible(false);
    setResultadosInsercion([]);
  }

  /** Inicia el análisis desde el botón accesible sin dejar rechazos sin manejar. */
  function manejarAnalisis(): void {
    void analizarArchivos();
  }

  /** Actualiza un par del catálogo recibido sin convertir datos del navegador en autoridad.
   * @param indiceArchivo - Posición del XML dentro del lote actualmente cargado.
   * @param sociedad - Par ofrecido por la respuesta o `undefined` para limpiar la selección.
   * @effects Actualiza únicamente estado efímero de la página.
   */
  function cambiarSeleccionSociedad(
    indiceArchivo: number,
    sociedad: ParSociedadRf1 | undefined,
  ): void {
    invalidarConfirmacionInsercion();
    setSeleccionesSociedad((actuales) => {
      const siguientes = { ...actuales };
      if (sociedad === undefined) {
        delete siguientes[indiceArchivo];
      } else {
        siguientes[indiceArchivo] = sociedad;
      }
      return siguientes;
    });
  }

  /** Reenvía el mismo lote con todas las selecciones pendientes.
   * @effects La operación permanece en modo de lectura y el servidor revalida cada par.
   */
  function manejarValidacionSociedad(): void {
    if (!seleccionesCompletas) {
      return;
    }
    const selecciones = indicesSociedadPendientes.map((indiceArchivo) => ({
      indiceArchivo,
      ...seleccionesSociedad[indiceArchivo]!,
    }));
    void analizarArchivos(selecciones);
  }

  /**
   * Ejecuta solamente un lote READY con confirmación opaca y CSRF de la sesión actual.
   * @returns Promesa que concluye después de presentar un resultado por archivo.
   * @effects Envía los XML al endpoint específico solo con gate, token y autorización disponibles.
   */
  async function manejarInsercion(): Promise<void> {
    if (
      tokenConfirmacion === null ||
      !ejecucionDisponible ||
      !todosLosResultadosListos ||
      insertando
    ) {
      return;
    }
    setInsertando(true);
    setError(null);
    setAviso(null);
    try {
      const selecciones = Object.entries(seleccionesSociedad).map(([indice, sociedad]) => ({
        indiceArchivo: Number(indice),
        ...sociedad,
      }));
      const respuesta = await ejecutarRf1(
        clienteId,
        perfilId,
        estatus,
        archivos,
        tokenConfirmacion,
        selecciones,
      );
      setResultadosInsercion(
        respuesta.map((resultado, indice) => ({
          nombreArchivo: archivos[indice]?.name ?? `Archivo ${indice + 1}`,
          resultado,
        })),
      );
      setTokenConfirmacion(null);
      setEjecucionDisponible(false);
      setAviso(
        'La solicitud de inserción terminó. Revisa el resultado individual de cada archivo.',
      );
    } catch (rechazo: unknown) {
      invalidarConfirmacionInsercion();
      setError(mensajeError(rechazo));
    } finally {
      setInsertando(false);
    }
  }

  const indicesSociedadPendientes = resultados.flatMap(({ indiceArchivo, resultado }) =>
    resultado.status === 'NEEDS_SELECTION' ? [indiceArchivo] : [],
  );
  const seleccionesCompletas =
    indicesSociedadPendientes.length > 0 &&
    indicesSociedadPendientes.every(
      (indiceArchivo) => seleccionesSociedad[indiceArchivo] !== undefined,
    );
  const todosLosResultadosListos =
    resultados.length > 0 && resultados.every(({ resultado }) => resultado.status === 'READY');

  return (
    <div className="pagina-contenido pagina-rf1">
      <header className="titulo-pagina">
        <p className="sobrelinea">Módulo operativo</p>
        <h1>Vista previa de facturas</h1>
        <p className="texto-secundario">
          Revisa los datos CFDI y su resolución antes de cualquier operación posterior.
        </p>
      </header>

      <p className="aviso-informativo aviso-rf1" role="note">
        La vista previa es de solo lectura; cualquier inserción requiere confirmación explícita y
        permisos vigentes.
      </p>

      {error !== null ? (
        <p className="aviso-error" role="alert">
          {error}
        </p>
      ) : null}
      {aviso !== null ? (
        <p className="aviso-exito" role="status">
          {aviso}
        </p>
      ) : null}

      {cargandoClientes ? (
        <p role="status">Cargando clientes autorizados…</p>
      ) : clientes.length === 0 ? (
        <section className="estado-vacio" aria-labelledby="rf1-vacio-titulo">
          <h2 id="rf1-vacio-titulo">Sin clientes disponibles</h2>
          <p>
            {esAdmin
              ? 'No hay clientes activos para seleccionar.'
              : 'No tienes clientes asignados con la vista previa habilitada.'}
          </p>
        </section>
      ) : (
        <section className="panel-contenido panel-rf1" aria-labelledby="rf1-operacion-titulo">
          <h2 id="rf1-operacion-titulo">Preparar vista previa</h2>
          <div className="formulario-rf1">
            <div className="campo">
              <label htmlFor="rf1-cliente">Cliente</label>
              <select
                id="rf1-cliente"
                value={clienteId}
                onChange={manejarCambioCliente}
                disabled={insertando}
              >
                <option value="">Selecciona un cliente</option>
                {clientes.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.nombre}
                  </option>
                ))}
              </select>
            </div>

            {clienteId.length > 0 ? (
              <>
                <div className="resumen-rf1" aria-label="Ambientes SAP disponibles">
                  <h3>Ambientes SAP disponibles</h3>
                  {cargandoDetalle ? (
                    <p role="status">Cargando perfiles y ambientes…</p>
                  ) : ambientes.length > 0 ? (
                    <ul>
                      {ambientes.map((ambiente) => (
                        <li key={ambiente.id}>
                          <span>{ambiente.nombre}</span>
                          <span className="texto-secundario">{ambiente.codigo}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="texto-secundario">No hay ambientes SAP activos disponibles.</p>
                  )}
                </div>

                <div className="campo">
                  <label htmlFor="rf1-perfil">Perfil de conexión</label>
                  <select
                    id="rf1-perfil"
                    value={perfilId}
                    disabled={cargandoDetalle || insertando || perfiles.length === 0}
                    onChange={(evento) => {
                      setPerfilId(evento.currentTarget.value);
                      setResultados([]);
                      invalidarConfirmacionInsercion();
                      setSeleccionesSociedad({});
                    }}
                  >
                    <option value="">Selecciona un perfil autorizado</option>
                    {perfiles.map((perfil) => (
                      <option key={perfil.id} value={perfil.id}>
                        {perfil.nombre}
                      </option>
                    ))}
                  </select>
                  {perfilId.length > 0 ? (
                    <p className="texto-secundario">
                      Entorno operativo:{' '}
                      {perfiles.find((perfil) => perfil.id === perfilId)?.entorno === 'TEST'
                        ? 'Pruebas'
                        : 'Producción'}
                    </p>
                  ) : null}
                </div>

                <div className="campo">
                  <label htmlFor="rf1-estatus">Estatus para la vista previa</label>
                  <select
                    id="rf1-estatus"
                    value={estatus}
                    onChange={(evento) => {
                      setEstatus(evento.currentTarget.value as EstatusVistaPreviaRf1Contrato);
                      setResultados([]);
                      invalidarConfirmacionInsercion();
                      setSeleccionesSociedad({});
                    }}
                    disabled={insertando}
                  >
                    <option value="PAGADA">Pagada</option>
                    <option value="CONTABILIZADO">Contabilizada</option>
                  </select>
                </div>

                {perfilId.length > 0 ? (
                  <div className="campo">
                    <label htmlFor="rf1-archivos">Archivos CFDI XML</label>
                    <input
                      id="rf1-archivos"
                      type="file"
                      accept=".xml,application/xml,text/xml"
                      multiple
                      onChange={seleccionarArchivos}
                      disabled={insertando}
                    />
                    <p className="texto-secundario">
                      Hasta {MAXIMO_ARCHIVOS} archivos XML, {formatearBytes(MAXIMO_BYTES_ARCHIVO)}{' '}
                      por archivo y {formatearBytes(MAXIMO_BYTES_LOTE)} en total. Los archivos solo
                      se procesan durante esta solicitud.
                    </p>
                  </div>
                ) : null}

                {archivos.length > 0 ? (
                  <ul className="lista-archivos-rf1" aria-label="Archivos listos">
                    {archivos.map((archivo, indice) => (
                      <li key={`${archivo.name}-${indice}`}>
                        <span>{archivo.name}</span>
                        <span className="texto-secundario">{formatearBytes(archivo.size)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <button
                  className="boton-primario"
                  type="button"
                  disabled={
                    cargandoDetalle ||
                    analizando ||
                    insertando ||
                    perfilId.length === 0 ||
                    archivos.length === 0
                  }
                  onClick={manejarAnalisis}
                >
                  {analizando ? 'Analizando…' : 'Analizar vista previa'}
                </button>
              </>
            ) : null}
          </div>
        </section>
      )}

      {resultados.length > 0 ? (
        <>
          <TablaResultados
            resultados={resultados}
            seleccionesSociedad={seleccionesSociedad}
            onCambioSeleccion={cambiarSeleccionSociedad}
          />
          {indicesSociedadPendientes.length > 0 ? (
            <div>
              <p className="texto-secundario" role="status">
                El servidor comprobará nuevamente cada par en el catálogo del mismo cliente y
                perfil.
              </p>
              <button
                className="boton-secundario"
                type="button"
                disabled={analizando || !seleccionesCompletas}
                onClick={manejarValidacionSociedad}
              >
                {analizando ? 'Validando sociedad…' : 'Validar selecciones de sociedad'}
              </button>
            </div>
          ) : null}
          {todosLosResultadosListos ? (
            <section className="panel-confirmacion-rf1" aria-labelledby="rf1-confirmar-titulo">
              <h2 id="rf1-confirmar-titulo">Inserción de facturas</h2>
              <p>
                Se solicitará insertar {resultados.length}{' '}
                {resultados.length === 1 ? 'factura' : 'facturas'} como{' '}
                {estatus === 'PAGADA' ? 'PAGADA' : 'CONTABILIZADO'} en el perfil seleccionado.
                Revisa los resultados anteriores antes de confirmar.
              </p>
              {!ejecucionDisponible || tokenConfirmacion === null ? (
                <p className="texto-secundario" role="note">
                  La inserción está deshabilitada para este cliente o por la compuerta global del
                  servidor.
                </p>
              ) : null}
              <button
                className="boton-primario"
                type="button"
                disabled={!ejecucionDisponible || tokenConfirmacion === null || insertando}
                onClick={() => void manejarInsercion()}
              >
                {insertando
                  ? 'Insertando…'
                  : `Confirmar inserción de ${resultados.length} ${resultados.length === 1 ? 'factura' : 'facturas'}`}
              </button>
              {insertando ? (
                <p className="texto-secundario" role="status" aria-live="polite">
                  Procesando el lote en orden; cada factura recibe su propio resultado.
                </p>
              ) : null}
            </section>
          ) : null}
          {resultadosInsercion.length > 0 ? (
            <section aria-labelledby="rf1-resultados-insercion-titulo">
              <h2 id="rf1-resultados-insercion-titulo">Resultado de inserción</h2>
              <ul className="lista-resultados-insercion-rf1" role="status">
                {resultadosInsercion.map(({ nombreArchivo, resultado }, indice) => (
                  <li key={`${nombreArchivo}-${indice}`}>
                    <strong>{nombreArchivo}</strong>
                    <span>{etiquetaResultadoInsercion(resultado)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Presenta resultados y permite elegir solo pares societarios devueltos por el API.
 * @param resultados - Resultado redactado asociado con cada archivo del lote.
 * @param seleccionesSociedad - Selecciones locales aún no enviadas para revalidación.
 * @param onCambioSeleccion - Callback para guardar una opción del catálogo recibido.
 * @returns Tabla accesible con estado y datos seguros de la vista previa.
 */
function TablaResultados({
  resultados,
  seleccionesSociedad,
  onCambioSeleccion,
}: {
  readonly resultados: readonly ResultadoConArchivo[];
  /** Selecciones locales indexadas por el archivo original. */
  readonly seleccionesSociedad: Readonly<Record<number, ParSociedadRf1>>;
  /** Actualiza una opción que proviene de las sociedades devueltas por el servidor. */
  readonly onCambioSeleccion: (indiceArchivo: number, sociedad: ParSociedadRf1 | undefined) => void;
}): JSX.Element {
  return (
    <section className="seccion-resultados-rf1" aria-labelledby="rf1-resultados-titulo">
      <h2 id="rf1-resultados-titulo">Resultados</h2>
      <p className="ayuda-tabla-rf1">
        Desplaza la tabla horizontalmente para consultar todas las columnas.
      </p>
      <div
        className="contenedor-tabla-rf1"
        role="region"
        aria-label="Tabla de resultados RF-1, desplázate horizontalmente para ver todas las columnas"
        tabIndex={0}
        onKeyDown={manejarTecladoTablaResultados}
      >
        <table aria-label="Resultados de vista previa RF-1">
          <thead>
            <tr>
              <th scope="col">Archivo</th>
              <th scope="col">Estado</th>
              <th scope="col">Resumen</th>
            </tr>
          </thead>
          <tbody>
            {resultados.map(({ nombreArchivo, indiceArchivo, resultado }, indice) => (
              <tr key={`${nombreArchivo}-${indice}`}>
                <th scope="row">{nombreArchivo}</th>
                <td>{etiquetaEstado(resultado)}</td>
                <td>
                  <ResumenResultado
                    nombreArchivo={nombreArchivo}
                    indiceArchivo={indiceArchivo}
                    resultado={resultado}
                    seleccion={seleccionesSociedad[indiceArchivo]}
                    onCambioSeleccion={onCambioSeleccion}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Desplaza las columnas de la tabla cuando la región accesible recibe el foco.
 * @param evento - Tecla del navegador dentro de la región de resultados RF-1.
 * @returns Nada; ignora teclas ajenas a la navegación horizontal.
 * @effects Ajusta `scrollLeft` y cancela la acción predeterminada en teclas atendidas.
 */
function manejarTecladoTablaResultados(evento: ReactKeyboardEvent<HTMLDivElement>): void {
  const region = evento.currentTarget;
  const distancia = Math.max(80, Math.round(region.clientWidth * 0.8));

  switch (evento.key) {
    case 'ArrowRight':
      region.scrollLeft += distancia;
      evento.preventDefault();
      break;
    case 'ArrowLeft':
      region.scrollLeft -= distancia;
      evento.preventDefault();
      break;
    case 'Home':
      region.scrollLeft = 0;
      evento.preventDefault();
      break;
    case 'End':
      region.scrollLeft = region.scrollWidth;
      evento.preventDefault();
      break;
    default:
      break;
  }
}

/** Renderiza resultado y, si aplica, el selector nativo limitado al catálogo recibido.
 * @param nombreArchivo - Nombre local para identificar el archivo de esta fila.
 * @param indiceArchivo - Índice cero basado correlacionado con el lote HTTP.
 * @param resultado - Resultado redactado del backend.
 * @param seleccion - Par actualmente elegido por el operador.
 * @param onCambioSeleccion - Callback que actualiza estado efímero de selección.
 * @returns Contenido accesible de la celda sin secretos ni XML.
 */
function ResumenResultado({
  nombreArchivo,
  indiceArchivo,
  resultado,
  seleccion,
  onCambioSeleccion,
}: {
  /** Nombre local para que cada selector tenga una etiqueta distinguible. */
  readonly nombreArchivo: string;
  /** Índice cero basado del XML que coincide con el contrato HTTP. */
  readonly indiceArchivo: number;
  readonly resultado: ResultadoArchivoVistaPreviaRf1Contrato;
  /** Selección actualmente realizada en la memoria de la página. */
  readonly seleccion: ParSociedadRf1 | undefined;
  /** Guarda una opción presente en el catálogo recibido desde el backend. */
  readonly onCambioSeleccion: (indiceArchivo: number, sociedad: ParSociedadRf1 | undefined) => void;
}): JSX.Element {
  if (resultado.status === 'NEEDS_SELECTION') {
    const sociedades = resultado.sociedadesDisponibles ?? [];
    return (
      <div>
        <p>La sociedad requiere una selección explícita.</p>
        {sociedades.length > 0 ? (
          <div className="campo">
            <label htmlFor={`rf1-sociedad-${indiceArchivo}`}>
              Sociedad y ambiente SAP para archivo {indiceArchivo + 1}: {nombreArchivo}
            </label>
            <select
              id={`rf1-sociedad-${indiceArchivo}`}
              value={seleccion === undefined ? '' : crearClaveSociedad(seleccion)}
              onChange={(evento) => {
                const opcion = sociedades.find(
                  (sociedad) => crearClaveSociedad(sociedad) === evento.currentTarget.value,
                );
                onCambioSeleccion(
                  indiceArchivo,
                  opcion === undefined
                    ? undefined
                    : { sociedad: opcion.sociedad, ambienteSap: opcion.ambienteSap },
                );
              }}
            >
              <option value="">Selecciona sociedad y ambiente SAP</option>
              {sociedades.map((sociedad) => (
                <option key={crearClaveSociedad(sociedad)} value={crearClaveSociedad(sociedad)}>
                  {sociedad.sociedad} · {sociedad.ambienteSap}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="texto-secundario">El catálogo no devolvió opciones seleccionables.</p>
        )}
      </div>
    );
  }

  if (resultado.status === 'BLOCKED') {
    return <p>{mensajeErrorRf1(resultado.errorCode)}</p>;
  }

  return (
    <div>
      <p>UUID: {resultado.factura?.uuid}</p>
      <p>Emisor: {resultado.factura?.rfcEmisor}</p>
      <p>Receptor: {resultado.factura?.rfcReceptor}</p>
      <p>
        Total: {resultado.factura?.total} {resultado.factura?.moneda}
      </p>
      {resultado.resolution !== undefined ? (
        <p>
          {resultado.resolution.sociedad} · {resultado.resolution.ambienteSap} ·{' '}
          {resultado.resolution.idProveedor}
        </p>
      ) : null}
    </div>
  );
}

/** Genera una clave estable de interfaz para comparar el par sin concatenaciones ambiguas.
 * @param sociedad - Par procedente del catálogo del servidor.
 * @returns Clave serializada que conserva exactamente ambos valores.
 */
function crearClaveSociedad(sociedad: ParSociedadRf1): string {
  return JSON.stringify([sociedad.sociedad, sociedad.ambienteSap]);
}

/** Valida cantidad, extensión y tamaños sin abrir o copiar el contenido de los XML. */
function validarArchivos(archivos: readonly File[]): string | null {
  if (archivos.length === 0) {
    return null;
  }
  if (archivos.length > MAXIMO_ARCHIVOS) {
    return `Selecciona como máximo ${MAXIMO_ARCHIVOS} archivos XML.`;
  }
  if (archivos.some((archivo) => !archivo.name.toLowerCase().endsWith('.xml'))) {
    return 'Selecciona únicamente archivos con extensión .xml.';
  }
  if (archivos.some((archivo) => archivo.size > MAXIMO_BYTES_ARCHIVO)) {
    return `Cada archivo debe medir como máximo ${formatearBytes(MAXIMO_BYTES_ARCHIVO)}.`;
  }
  if (archivos.reduce((total, archivo) => total + archivo.size, 0) > MAXIMO_BYTES_LOTE) {
    return `El tamaño total no puede superar ${formatearBytes(MAXIMO_BYTES_LOTE)}.`;
  }
  return null;
}

/** Convierte bytes a una unidad legible para límites y archivos en interfaz. */
function formatearBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString('es-MX', { maximumFractionDigits: 0 })} MiB`;
}

/** Traduce errores RF-1 a texto visible sin conservar contenido del XML o drivers. */
function mensajeErrorRf1(codigo: string | undefined): string {
  switch (codigo) {
    case 'RF1_DUPLICATE_UUID':
      return 'UUID duplicado';
    case 'XML_MALFORMED':
      return 'XML mal formado';
    case 'RF1_SOCIETY_SELECTION_REQUIRED':
      return 'La sociedad requiere una selección explícita.';
    case 'RF1_CONTEXT_MISMATCH':
      return 'El contexto cambió. Analiza de nuevo el archivo para consultar opciones vigentes.';
    default:
      return 'El archivo no cumple las reglas de validación de RF-1.';
  }
}

/** Traduce errores HTTP a mensajes acotados y evita mostrar detalles remotos. */
function mensajeError(rechazo: unknown): string {
  if (rechazo instanceof ErrorApiClientes && rechazo.status === 403) {
    return 'Tu acceso o la capacidad RF-1 ya no está vigente. Actualiza la selección o solicita acceso a un administrador.';
  }
  if (rechazo instanceof ErrorApiClientes && rechazo.status === 401) {
    return 'Tu sesión terminó. Inicia sesión de nuevo.';
  }
  return 'No fue posible cargar o analizar la solicitud. Inténtalo de nuevo.';
}

/** Devuelve una etiqueta estable y comprensible para cada estado del contrato RF-1. */
function etiquetaEstado(resultado: ResultadoArchivoVistaPreviaRf1Contrato): string {
  if (resultado.status === 'READY') {
    return 'Vista previa completa';
  }
  if (resultado.status === 'NEEDS_SELECTION') {
    return 'Pendiente de selección';
  }
  return 'Bloqueada';
}

/**
 * Traduce cada resultado de escritura a una frase breve sin detalles de MySQL.
 * @param resultado Estado individual redactado que devolvió el backend.
 * @returns Etiqueta en español sin SQL, credenciales ni mensajes del driver.
 */
function etiquetaResultadoInsercion(resultado: ResultadoInsercionRf1Contrato): string {
  switch (resultado.status) {
    case 'INSERTADA_VERIFICADA':
      return 'Insertada y verificada';
    case 'YA_EXISTE':
      return 'El UUID ya existe; no se insertó';
    case 'ERROR_REVERTIDO':
      return 'Error; la transacción se revirtió';
    case 'INDETERMINADO':
      return 'Resultado indeterminado; requiere revisión antes de reintentar';
    case 'RECHAZADA':
      return resultado.errorCode === 'RF1_ACCESS_REVOKED'
        ? 'Acceso revocado; no se insertó'
        : 'Operación rechazada';
  }
}
