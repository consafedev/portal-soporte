'use client';

import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';
import type {
  AmbienteSapClienteAdminContrato,
  ClienteAdminContrato,
} from '@portal-soporte/contracts/clients';
import {
  actualizarAmbienteSapAdmin,
  actualizarClienteAdmin,
  crearAmbienteSapAdmin,
  crearClienteAdmin,
  ErrorApiClientes,
  listarAmbientesSapAdmin,
  listarClientesAdmin,
} from '../../lib/client-admin-api';
import { AdministracionAccesoCliente } from './client-access-management';
import { AdministracionPerfilesConexion } from './connection-profile-management';

/** Presenta el catálogo de clientes y ambientes SAP con operaciones protegidas por ADMIN. */
export function AdministracionClientes(): JSX.Element {
  const [clientes, setClientes] = useState<readonly ClienteAdminContrato[]>([]);
  const [nombre, setNombre] = useState('');
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Consulta la lista sin permitir caché de navegador o resultados tras desmontar. */
  const cargarClientes = useCallback((): (() => void) => {
    let vigente = true;

    /** Actualiza el listado mientras la página permanezca activa. */
    async function cargar(): Promise<void> {
      try {
        const resultado = await listarClientesAdmin();
        if (vigente) {
          setClientes(resultado);
          setError(null);
        }
      } catch (rechazo: unknown) {
        if (vigente) {
          setError(mensajeError(rechazo));
        }
      } finally {
        if (vigente) {
          setCargando(false);
        }
      }
    }

    void cargar();

    return () => {
      vigente = false;
    };
  }, []);

  useEffect(cargarClientes, [cargarClientes]);

  /** Crea el cliente y confirma solo cuando el API validó y persistió el registro. */
  async function crearCliente(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setEnviando(true);
    setMensaje(null);
    setError(null);
    try {
      await crearClienteAdmin({ nombre });
      setNombre('');
      await recargar();
      setMensaje('Cliente registrado.');
    } catch (rechazo: unknown) {
      setError(mensajeError(rechazo));
    } finally {
      setEnviando(false);
    }
  }

  /** Refresca el listado después de una operación confirmada en el servidor. */
  async function recargar(): Promise<void> {
    setClientes(await listarClientesAdmin());
  }

  /** Publica el error localizado de una operación de recarga manual. */
  async function recargarConAviso(): Promise<void> {
    setCargando(true);
    setMensaje(null);
    setError(null);
    try {
      await recargar();
    } catch (rechazo: unknown) {
      setError(mensajeError(rechazo));
    } finally {
      setCargando(false);
    }
  }

  /** Inicia una recarga solicitada por la persona sin propagar promesas al evento DOM. */
  function manejarRecarga(): void {
    void recargarConAviso();
  }

  /** Renderiza una ficha de cliente y mantiene el listado actualizado tras sus cambios. */
  function renderizarCliente(cliente: ClienteAdminContrato): JSX.Element {
    return (
      <TarjetaCliente
        key={cliente.id}
        cliente={cliente}
        recargar={recargar}
        notificar={setMensaje}
        reportarError={setError}
      />
    );
  }

  return (
    <div className="pagina-contenido pagina-clientes">
      <header className="titulo-pagina">
        <p className="sobrelinea">Administración</p>
        <h1>Clientes</h1>
        <p className="texto-secundario">
          Registra clientes y ambientes SAP para preparar sus módulos autorizados.
        </p>
      </header>

      <section className="panel-contenido" aria-labelledby="nuevo-cliente-titulo">
        <div>
          <h2 id="nuevo-cliente-titulo">Registrar cliente</h2>
          <p className="texto-secundario">
            Solo guarda el nombre visible; no solicita credenciales.
          </p>
        </div>
        <form className="formulario formulario-cliente" onSubmit={crearCliente}>
          <div className="campo">
            <label htmlFor="client-display-name">Nombre del cliente</label>
            <input
              id="client-display-name"
              autoComplete="organization"
              maxLength={120}
              minLength={2}
              required
              value={nombre}
              onChange={(evento) => setNombre(evento.currentTarget.value)}
            />
          </div>
          <button className="boton-primario" type="submit" disabled={enviando} aria-busy={enviando}>
            {enviando ? 'Guardando…' : 'Guardar cliente'}
          </button>
        </form>
      </section>

      {error !== null ? (
        <p className="aviso-error" role="alert">
          {error}
        </p>
      ) : null}
      {mensaje !== null ? (
        <p className="aviso-exito" role="status">
          {mensaje}
        </p>
      ) : null}

      <section className="listado-clientes" aria-labelledby="lista-clientes-titulo">
        <div className="encabezado-listado">
          <div>
            <p className="sobrelinea">Catálogo de soporte</p>
            <h2 id="lista-clientes-titulo">Clientes registrados</h2>
          </div>
          <button
            className="boton-secundario"
            type="button"
            onClick={manejarRecarga}
            disabled={cargando}
          >
            Actualizar lista
          </button>
        </div>
        {cargando ? (
          <p className="texto-secundario" role="status">
            Cargando clientes…
          </p>
        ) : null}
        {!cargando && clientes.length === 0 ? (
          <p className="estado-vacio" role="status">
            Aún no hay clientes registrados.
          </p>
        ) : null}
        <div className="lista-clientes">{clientes.map(renderizarCliente)}</div>
      </section>

      <p className="nota-conectividad" role="note">
        Las pruebas son de solo lectura: ejecutan SELECT 1. El servidor valida la seguridad de cada
        destino y la custodia de credenciales.
      </p>
    </div>
  );
}

/** Propiedades de una ficha administrativa de cliente. */
interface PropiedadesTarjetaCliente {
  /** Cliente permitido por el contrato del API. */
  readonly cliente: ClienteAdminContrato;
  /** Recarga el catálogo después de una mutación exitosa. */
  readonly recargar: () => Promise<void>;
  /** Publica una confirmación breve y no sensible. */
  readonly notificar: (mensaje: string | null) => void;
  /** Publica un error localizado. */
  readonly reportarError: (mensaje: string | null) => void;
}

/** Muestra edición, baja lógica y ambientes del cliente en un bloque desplegable accesible. */
function TarjetaCliente({
  cliente,
  recargar,
  notificar,
  reportarError,
}: PropiedadesTarjetaCliente): JSX.Element {
  const [nombre, setNombre] = useState(cliente.nombre);
  const [ambientes, setAmbientes] = useState<readonly AmbienteSapClienteAdminContrato[] | null>(
    null,
  );
  const [abierto, setAbierto] = useState(false);
  const [cargandoAmbientes, setCargandoAmbientes] = useState(false);
  const [nombreAmbiente, setNombreAmbiente] = useState('');
  const [codigoAmbiente, setCodigoAmbiente] = useState('');
  const [guardando, setGuardando] = useState(false);

  /** Carga ambientes únicamente cuando el bloque de ese cliente se abre. */
  const cargarAmbientes = useCallback((): (() => void) | void => {
    if (!abierto) {
      return;
    }
    let vigente = true;

    /** Actualiza el listado de ambientes si la ficha continúa abierta. */
    async function cargar(): Promise<void> {
      setCargandoAmbientes(true);
      try {
        const resultado = await listarAmbientesSapAdmin(cliente.id);
        if (vigente) {
          setAmbientes(resultado);
        }
      } catch (rechazo: unknown) {
        if (vigente) {
          reportarError(mensajeError(rechazo));
        }
      } finally {
        if (vigente) {
          setCargandoAmbientes(false);
        }
      }
    }

    void cargar();

    return () => {
      vigente = false;
    };
  }, [abierto, cliente.id, reportarError]);

  useEffect(cargarAmbientes, [cargarAmbientes]);

  /** Actualiza el nombre del cliente sin cambiar su estado o referencias. */
  async function guardarNombre(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setGuardando(true);
    reportarError(null);
    notificar(null);
    try {
      await actualizarClienteAdmin(cliente.id, { nombre });
      await recargar();
      notificar('Cambios del cliente guardados.');
    } catch (rechazo: unknown) {
      reportarError(mensajeError(rechazo));
    } finally {
      setGuardando(false);
    }
  }

  /** Cambia entre ACTIVE y DISABLED conservando la fila y su historial. */
  async function alternarEstado(): Promise<void> {
    setGuardando(true);
    reportarError(null);
    notificar(null);
    try {
      const estado = cliente.estado === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
      await actualizarClienteAdmin(cliente.id, { estado });
      await recargar();
      notificar(estado === 'ACTIVE' ? 'Cliente reactivado.' : 'Cliente desactivado.');
    } catch (rechazo: unknown) {
      reportarError(mensajeError(rechazo));
    } finally {
      setGuardando(false);
    }
  }

  /** Registra un ambiente SAP y recarga la colección del cliente actual. */
  async function crearAmbiente(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setGuardando(true);
    reportarError(null);
    notificar(null);
    try {
      await crearAmbienteSapAdmin(cliente.id, { codigo: codigoAmbiente, nombre: nombreAmbiente });
      setCodigoAmbiente('');
      setNombreAmbiente('');
      setAmbientes(await listarAmbientesSapAdmin(cliente.id));
      notificar('Ambiente SAP registrado.');
    } catch (rechazo: unknown) {
      reportarError(mensajeError(rechazo));
    } finally {
      setGuardando(false);
    }
  }

  /** Actualiza nombre o código del ambiente sin modificar el cliente propietario. */
  async function editarAmbiente(
    ambiente: AmbienteSapClienteAdminContrato,
    cambios: { readonly codigo?: string; readonly nombre?: string },
  ): Promise<void> {
    setGuardando(true);
    reportarError(null);
    notificar(null);
    try {
      await actualizarAmbienteSapAdmin(cliente.id, ambiente.id, cambios);
      setAmbientes(await listarAmbientesSapAdmin(cliente.id));
      notificar('Ambiente SAP actualizado.');
    } catch (rechazo: unknown) {
      reportarError(mensajeError(rechazo));
    } finally {
      setGuardando(false);
    }
  }

  /** Activa o desactiva un ambiente SAP conservando el identificador. */
  async function alternarAmbiente(ambiente: AmbienteSapClienteAdminContrato): Promise<void> {
    setGuardando(true);
    reportarError(null);
    notificar(null);
    try {
      await actualizarAmbienteSapAdmin(cliente.id, ambiente.id, {
        estado: ambiente.estado === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
      });
      setAmbientes(await listarAmbientesSapAdmin(cliente.id));
      notificar('Estado del ambiente actualizado.');
    } catch (rechazo: unknown) {
      reportarError(mensajeError(rechazo));
    } finally {
      setGuardando(false);
    }
  }

  /** Renderiza el editor de un ambiente SAP y sus acciones de estado. */
  function renderizarAmbiente(ambiente: AmbienteSapClienteAdminContrato): JSX.Element {
    return (
      <FilaAmbienteSap
        key={ambiente.id}
        ambiente={ambiente}
        deshabilitado={guardando}
        guardar={editarAmbiente}
        alternar={alternarAmbiente}
      />
    );
  }

  return (
    <article className="tarjeta-cliente" aria-labelledby={`cliente-${cliente.id}`}>
      <header className="cabecera-cliente">
        <div>
          <h3 id={`cliente-${cliente.id}`}>{cliente.nombre}</h3>
          <p className="texto-secundario">
            {cliente.estado === 'ACTIVE' ? 'Activo' : 'Desactivado'} · Actualizado{' '}
            {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(
              new Date(cliente.updatedAt),
            )}
          </p>
        </div>
        <button
          className="boton-secundario"
          type="button"
          onClick={() => void alternarEstado()}
          disabled={guardando}
        >
          {cliente.estado === 'ACTIVE' ? 'Desactivar' : 'Reactivar'}
        </button>
      </header>

      <details
        className="detalle-cliente"
        onToggle={(evento) => setAbierto(evento.currentTarget.open)}
      >
        <summary>Editar y administrar ambientes SAP</summary>
        <div className="detalle-cliente-contenido">
          <form className="formulario formulario-cliente" onSubmit={guardarNombre}>
            <div className="campo">
              <label htmlFor={`cliente-nombre-${cliente.id}`}>Nombre del cliente</label>
              <input
                id={`cliente-nombre-${cliente.id}`}
                maxLength={120}
                minLength={2}
                required
                value={nombre}
                onChange={(evento) => setNombre(evento.currentTarget.value)}
              />
            </div>
            <button className="boton-secundario" type="submit" disabled={guardando}>
              Guardar nombre
            </button>
          </form>

          <section className="seccion-ambientes" aria-labelledby={`ambientes-${cliente.id}`}>
            <div>
              <h4 id={`ambientes-${cliente.id}`}>Ambientes SAP</h4>
              <p className="texto-secundario">
                Identificadores de SAP; no representan por sí mismos producción o pruebas del
                Portal.
              </p>
            </div>
            <form className="formulario formulario-ambiente" onSubmit={crearAmbiente}>
              <div className="campo">
                <label htmlFor={`codigo-sap-${cliente.id}`}>Código</label>
                <input
                  id={`codigo-sap-${cliente.id}`}
                  autoCapitalize="characters"
                  maxLength={32}
                  minLength={1}
                  pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
                  required
                  value={codigoAmbiente}
                  onChange={(evento) => setCodigoAmbiente(evento.currentTarget.value)}
                />
              </div>
              <div className="campo">
                <label htmlFor={`nombre-sap-${cliente.id}`}>Nombre</label>
                <input
                  id={`nombre-sap-${cliente.id}`}
                  maxLength={120}
                  minLength={2}
                  required
                  value={nombreAmbiente}
                  onChange={(evento) => setNombreAmbiente(evento.currentTarget.value)}
                />
              </div>
              <button className="boton-primario" type="submit" disabled={guardando}>
                Agregar ambiente
              </button>
            </form>
            {cargandoAmbientes ? (
              <p className="texto-secundario" role="status">
                Cargando ambientes…
              </p>
            ) : null}
            {!cargandoAmbientes && (ambientes?.length ?? 0) === 0 ? (
              <p className="estado-vacio">No hay ambientes SAP registrados.</p>
            ) : null}
            <div className="lista-ambientes">{ambientes?.map(renderizarAmbiente)}</div>
          </section>
          <AdministracionPerfilesConexion
            clientId={cliente.id}
            clienteActivo={cliente.estado === 'ACTIVE'}
          />
          {abierto ? (
            <AdministracionAccesoCliente
              clientId={cliente.id}
              clienteActivo={cliente.estado === 'ACTIVE'}
              onError={reportarError}
              onSaved={notificar}
            />
          ) : null}
        </div>
      </details>
    </article>
  );
}

/** Propiedades de edición para una fila de ambiente SAP. */
interface PropiedadesFilaAmbienteSap {
  /** Ambiente cuyo código, nombre y estado fueron validados por el API. */
  readonly ambiente: AmbienteSapClienteAdminContrato;
  /** Evita mutaciones simultáneas desde el bloque del cliente. */
  readonly deshabilitado: boolean;
  /** Persiste el nombre o el código editado. */
  readonly guardar: (
    ambiente: AmbienteSapClienteAdminContrato,
    cambios: { readonly codigo?: string; readonly nombre?: string },
  ) => Promise<void>;
  /** Alterna el estado lógico del ambiente. */
  readonly alternar: (ambiente: AmbienteSapClienteAdminContrato) => Promise<void>;
}

/** Presenta una fila de ambiente con edición explícita y baja lógica reversible. */
function FilaAmbienteSap({
  ambiente,
  deshabilitado,
  guardar,
  alternar,
}: PropiedadesFilaAmbienteSap): JSX.Element {
  const [codigo, setCodigo] = useState(ambiente.codigo);
  const [nombre, setNombre] = useState(ambiente.nombre);

  /** Guarda el código y nombre actuales solo después del envío explícito del formulario. */
  async function enviarEdicion(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    await guardar(ambiente, { codigo, nombre });
  }

  /** Inicia la alternancia de estado sin exponer una promesa al manejador DOM. */
  function manejarAlternancia(): void {
    void alternar(ambiente);
  }

  return (
    <article className="fila-ambiente">
      <div>
        <strong>{ambiente.codigo}</strong>
        <span>{ambiente.nombre}</span>
        <span className="etiqueta-estado">
          {ambiente.estado === 'ACTIVE' ? 'Activo' : 'Desactivado'}
        </span>
      </div>
      <details>
        <summary>Editar</summary>
        <form className="formulario formulario-editar-ambiente" onSubmit={enviarEdicion}>
          <div className="campo">
            <label htmlFor={`codigo-${ambiente.id}`}>Código SAP</label>
            <input
              id={`codigo-${ambiente.id}`}
              maxLength={32}
              minLength={1}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
              required
              value={codigo}
              onChange={(evento) => setCodigo(evento.currentTarget.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor={`nombre-${ambiente.id}`}>Nombre</label>
            <input
              id={`nombre-${ambiente.id}`}
              maxLength={120}
              minLength={2}
              required
              value={nombre}
              onChange={(evento) => setNombre(evento.currentTarget.value)}
            />
          </div>
          <button className="boton-secundario" type="submit" disabled={deshabilitado}>
            Guardar ambiente
          </button>
        </form>
      </details>
      <button
        className="boton-secundario"
        type="button"
        onClick={manejarAlternancia}
        disabled={deshabilitado}
      >
        {ambiente.estado === 'ACTIVE' ? 'Desactivar' : 'Reactivar'}
      </button>
    </article>
  );
}

/** Convierte errores públicos en mensajes breves y descarta cualquier detalle de transporte. */
function mensajeError(error: unknown): string {
  if (error instanceof ErrorApiClientes) {
    return error.message;
  }

  return 'No fue posible completar la operación. Inténtalo de nuevo.';
}
