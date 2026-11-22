'use client';

import { useEffect, useState, type ChangeEvent, type JSX } from 'react';
import type {
  ClienteAdminContrato,
  ClienteAccesibleContrato,
  EstatusVistaPreviaRf1Contrato,
  ResultadoArchivoVistaPreviaRf1Contrato,
} from '@portal-soporte/contracts/clients';
import {
  ErrorApiClientes,
  listarAmbientesSapAdmin,
  listarClientesAdmin,
  listarPerfilesConexionAdmin,
} from '../../lib/client-admin-api';
import {
  listarAmbientesSapCliente,
  listarClientesAutorizados,
  listarPerfilesConexionCliente,
} from '../../lib/client-access-api';
import { previsualizarRf1 } from '../../lib/rf1-preview-api';
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
  /** Datos de preview retornados por el contrato del servidor. */
  readonly resultado: ResultadoArchivoVistaPreviaRf1Contrato;
}

/** Presenta lectura RF-1 por archivos, sin persistir XML ni habilitar inserciones. */
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
  const [cargandoClientes, setCargandoClientes] = useState(true);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [analizando, setAnalizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /** Carga únicamente el catálogo que corresponde al rol ya confirmado por el marco. */
  useEffect(() => {
    let vigente = true;

    /** Solicita la lista del lado servidor y filtra estados inactivos en la presentación. */
    async function cargarClientes(): Promise<void> {
      try {
        const respuesta: readonly ClienteAdminContrato[] | readonly ClienteAccesibleContrato[] =
          esAdmin ? await listarClientesAdmin() : await listarClientesAutorizados();
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
  }, [esAdmin]);

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
    setAviso(null);
    setError(null);
    setCargandoDetalle(siguienteClienteId.length > 0);
  }

  /** Envía solo el lote seleccionado a la ruta de preview protegida con CSRF. */
  async function analizarArchivos(): Promise<void> {
    if (clienteId.length === 0 || perfilId.length === 0 || archivos.length === 0) {
      return;
    }

    setAnalizando(true);
    setError(null);
    setAviso(null);
    setResultados([]);
    try {
      const respuesta = await previsualizarRf1(clienteId, perfilId, estatus, archivos);
      setResultados(
        respuesta.map((resultado, indice) => ({
          nombreArchivo: archivos[indice]?.name ?? `Archivo ${indice + 1}`,
          resultado,
        })),
      );
    } catch (rechazo: unknown) {
      setError(mensajeError(rechazo));
    } finally {
      setAnalizando(false);
    }
  }

  /** Inicia el análisis desde el botón accesible sin dejar rechazos sin manejar. */
  function manejarAnalisis(): void {
    void analizarArchivos();
  }

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
        Solo vista previa; no se modifica la base.
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
              <select id="rf1-cliente" value={clienteId} onChange={manejarCambioCliente}>
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
                    disabled={cargandoDetalle || perfiles.length === 0}
                    onChange={(evento) => {
                      setPerfilId(evento.currentTarget.value);
                      setResultados([]);
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
                    }}
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
                    cargandoDetalle || analizando || perfilId.length === 0 || archivos.length === 0
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

      {resultados.length > 0 ? <TablaResultados resultados={resultados} /> : null}
    </div>
  );
}

/** Presenta resultados resumidos por archivo sin representar el XML ni secretos. */
function TablaResultados({
  resultados,
}: {
  readonly resultados: readonly ResultadoConArchivo[];
}): JSX.Element {
  return (
    <section className="seccion-resultados-rf1" aria-labelledby="rf1-resultados-titulo">
      <h2 id="rf1-resultados-titulo">Resultados</h2>
      <div className="contenedor-tabla-rf1">
        <table aria-label="Resultados de vista previa RF-1">
          <thead>
            <tr>
              <th scope="col">Archivo</th>
              <th scope="col">Estado</th>
              <th scope="col">Resumen</th>
            </tr>
          </thead>
          <tbody>
            {resultados.map(({ nombreArchivo, resultado }, indice) => (
              <tr key={`${nombreArchivo}-${indice}`}>
                <th scope="row">{nombreArchivo}</th>
                <td>{etiquetaEstado(resultado)}</td>
                <td>
                  <ResumenResultado resultado={resultado} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Renderiza el mensaje de estado y los datos permitidos por el resultado del API. */
function ResumenResultado({
  resultado,
}: {
  readonly resultado: ResultadoArchivoVistaPreviaRf1Contrato;
}): JSX.Element {
  if (resultado.status === 'NEEDS_SELECTION') {
    return (
      <div>
        <p>La sociedad requiere una selección explícita.</p>
        {resultado.sociedadesDisponibles?.map((sociedad) => (
          <p key={`${sociedad.sociedad}-${sociedad.ambienteSap}`}>
            {sociedad.sociedad} · {sociedad.ambienteSap}
          </p>
        ))}
        <p className="texto-secundario">
          La selección no se envió al servidor; esta fila permanece pendiente.
        </p>
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
