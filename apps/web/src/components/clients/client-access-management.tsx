'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import type { RespuestaUsuarioAdmin } from '@portal-soporte/contracts/auth';
import type { AccesoClienteAdminContrato } from '@portal-soporte/contracts/clients';
import {
  concederAccesoCliente,
  establecerCapacidadCliente,
  listarAsignacionesCliente,
  revocarAccesoCliente,
} from '../../lib/client-access-api';
import { ErrorApiClientes } from '../../lib/client-admin-api';
import { listarUsuariosAdmin, ErrorApiAuth } from '../../lib/auth-api';

/** Propiedades de administración de asignaciones y capacidades para un cliente. */
export interface ClienteAccesoAdminProps {
  /** Identificador estable del cliente que limita las operaciones administrativas. */
  readonly clientId: string;
  /** Indica si el catálogo permite operar módulos para este cliente. */
  readonly clienteActivo: boolean;
  /** Publica errores breves en el estado visible de la página contenedora. */
  readonly onError: (mensaje: string | null) => void;
  /** Confirma la operación después de que el servidor guardó y devolvió el estado vigente. */
  readonly onSaved: (mensaje: string) => void;
}

/**
 * Administra usuarios SUPPORT y capacidades RF-1 sin mostrar datos de conexión.
 * @param propiedades - Cliente objetivo, estado y callbacks de la página contenedora.
 * @param propiedades.clientId - Identificador que limita lecturas y mutaciones de acceso.
 * @param propiedades.clienteActivo - Estado que controla si la interfaz permite configurar acceso.
 * @param propiedades.onError - Callback para comunicar errores públicos sin detalles de red.
 * @param propiedades.onSaved - Callback que anuncia una operación confirmada por el servidor.
 * @returns Sección accesible de asignaciones SUPPORT y capacidades independientes RF-1.
 * @throws Los fallos de transporte se capturan y se muestran como errores controlados.
 * @effects Consulta y modifica únicamente el cliente de la propiedad mediante API same-origin.
 */
export function AdministracionAccesoCliente({
  clientId,
  clienteActivo,
  onError,
  onSaved,
}: ClienteAccesoAdminProps): JSX.Element {
  const [usuarios, setUsuarios] = useState<readonly RespuestaUsuarioAdmin[]>([]);
  const [resumen, setResumen] = useState<AccesoClienteAdminContrato | null>(null);
  const [usuarioSeleccionado, setUsuarioSeleccionado] = useState('');
  const [capacidadOptimista, setCapacidadOptimista] = useState<boolean | null>(null);
  const [capacidadEjecucionOptimista, setCapacidadEjecucionOptimista] = useState<boolean | null>(
    null,
  );
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  /**
   * Consulta en paralelo el catálogo administrativo y el resumen redactado del cliente.
   * @returns Datos públicos actuales de usuarios y permisos.
   * @throws Errores controlados por los clientes API cuando sesión o respuesta no son válidas.
   * @effects Realiza solicitudes same-origin de solo lectura.
   */
  const cargarDatos = useCallback(async (): Promise<void> => {
    const [cuentasAdmin, accesos] = await Promise.all([
      listarUsuariosAdmin(),
      listarAsignacionesCliente(clientId),
    ]);
    setUsuarios(cuentasAdmin);
    setResumen(accesos);
  }, [clientId]);

  useEffect(() => {
    let vigente = true;

    /**
     * Carga el resumen del cliente y evita actualizar estado tras desmontar.
     * @returns Promesa que termina cuando responde el catálogo administrativo.
     * @throws No propaga los fallos; conserva un mensaje local seguro.
     * @effects Actualiza estado visual únicamente mientras el componente siga montado.
     */
    async function cargar(): Promise<void> {
      setCargando(true);
      setErrorLocal(null);
      try {
        await cargarDatos();
      } catch (rechazo: unknown) {
        if (vigente) {
          setErrorLocal(traducirErrorAcceso(rechazo));
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
  }, [cargarDatos]);

  const asignacionesActivas =
    resumen?.asignaciones.filter((asignacion) => asignacion.revokedAt === null) ?? [];
  const cuentasDisponibles = usuarios.filter(
    (usuario) =>
      usuario.role === 'SUPPORT' &&
      usuario.status === 'ACTIVE' &&
      !asignacionesActivas.some((asignacion) => asignacion.userId === usuario.id),
  );
  const capacidadConfirmada =
    resumen?.capacidades.find((capacidad) => capacidad.capabilityId === 'rf-1:read')?.enabled ??
    false;
  const capacidadLectura = capacidadOptimista ?? capacidadConfirmada;
  const capacidadEjecucionConfirmada =
    resumen?.capacidades.find((capacidad) => capacidad.capabilityId === 'rf-1:execute')?.enabled ??
    false;
  const capacidadEjecucion = capacidadEjecucionOptimista ?? capacidadEjecucionConfirmada;

  /**
   * Persiste una mutación, vuelve a leer el estado y solo entonces anuncia éxito.
   * @param operacion - Solicitud de escritura protegida con CSRF al API same-origin.
   * @param mensajeGuardado - Mensaje breve que se presenta tras confirmar el estado persistido.
   * @returns Promesa que termina al confirmar estado o publicar un error controlado.
   * @throws No propaga errores de API o red; los presenta en la pantalla.
   * @effects Actualiza las asignaciones visibles y notifica al componente contenedor.
   */
  async function guardarOperacion(
    operacion: () => Promise<void>,
    mensajeGuardado: string,
  ): Promise<void> {
    setGuardando(true);
    setErrorLocal(null);
    onError(null);
    try {
      await operacion();
      await cargarDatos();
      setUsuarioSeleccionado('');
      onSaved(mensajeGuardado);
    } catch (rechazo: unknown) {
      const mensaje = traducirErrorAcceso(rechazo);
      setErrorLocal(mensaje);
      onError(mensaje);
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Concede la asignación vigente elegida y vuelve a leer el estado del backend.
   * @returns No retorna valor; envía la operación al cliente API.
   * @throws No propaga errores; el helper los muestra en el estado accesible.
   * @effects Puede crear una asignación persistente para el SUPPORT seleccionado.
   */
  function manejarAsignacion(): void {
    if (usuarioSeleccionado === '') {
      setErrorLocal('Selecciona una cuenta SUPPORT activa.');
      return;
    }
    void guardarOperacion(
      () => concederAccesoCliente(clientId, usuarioSeleccionado),
      'El acceso SUPPORT se asignó correctamente.',
    );
  }

  /**
   * Revoca una asignación identificada sin cambiar el resto del acceso al portal.
   * @param userId - UUID de la cuenta SUPPORT que el backend vuelve a validar.
   * @returns No retorna valor; programa la revocación protegida por CSRF.
   * @throws No propaga errores; el helper muestra el mensaje controlado.
   * @effects La revocación afecta solicitudes posteriores de esa cuenta para este cliente.
   */
  function manejarRevocacion(userId: string): void {
    void guardarOperacion(
      () => revocarAccesoCliente(clientId, userId),
      'El acceso SUPPORT se revocó correctamente.',
    );
  }

  /**
   * Guarda una capacidad allowlisted y deja el gate global bajo control del servidor.
   * @param capacidad - Permiso RF-1 que ADMIN administra en el cliente seleccionado.
   * @param enabled - Estado persistente solicitado.
   * @returns No retorna valor; inicia una operación de lectura/escritura controlada.
   * @throws No propaga errores; el estado vuelve a la capacidad persistida y anuncia el fallo.
   * @effects Muestra feedback inmediato y después confirma contra el servidor.
   */
  function manejarCapacidad(capacidad: 'rf-1:read' | 'rf-1:execute', enabled: boolean): void {
    const actualizarOptimista =
      capacidad === 'rf-1:read' ? setCapacidadOptimista : setCapacidadEjecucionOptimista;
    actualizarOptimista(enabled);
    void guardarOperacion(
      () => establecerCapacidadCliente(clientId, capacidad, enabled),
      capacidad === 'rf-1:read'
        ? 'La capacidad de lectura se actualizó.'
        : 'La capacidad de ejecución por cliente se actualizó.',
    ).finally(() => actualizarOptimista(null));
  }

  /**
   * Renderiza una asignación vigente con identidad pública y acción de revocación.
   * @param asignacion - Datos redactados del usuario y su vigencia.
   * @returns Fila accesible con nombre, username y acción de revocación.
   * @throws No lanza errores de red ni de persistencia.
   * @effects No incorpora correo, credenciales ni información del destino de conexión.
   */
  function renderizarAsignacion(
    asignacion: AccesoClienteAdminContrato['asignaciones'][number],
  ): JSX.Element {
    const cuenta = usuarios.find((usuario) => usuario.id === asignacion.userId);
    return (
      <li className="fila-acceso-cliente" key={asignacion.userId}>
        <div>
          <strong>{asignacion.displayName}</strong>
          {cuenta === undefined ? null : (
            <span className="texto-secundario">@{cuenta.username}</span>
          )}
          <span className="etiqueta-estado">
            {asignacion.userActive ? 'Acceso vigente' : 'Cuenta desactivada'}
          </span>
        </div>
        <button
          className="boton-secundario"
          type="button"
          onClick={() => manejarRevocacion(asignacion.userId)}
          disabled={guardando}
        >
          Revocar acceso
        </button>
      </li>
    );
  }

  return (
    <section
      className="seccion-acceso-cliente"
      aria-labelledby={`acceso-cliente-${clientId}`}
      aria-busy={cargando || guardando}
    >
      <div>
        <h4 id={`acceso-cliente-${clientId}`}>Acceso de usuarios y capacidades</h4>
        <p className="texto-secundario">
          Administra las capacidades de lectura e inserción por separado.
        </p>
      </div>

      {cargando ? (
        <p className="texto-secundario" role="status">
          Cargando asignaciones…
        </p>
      ) : null}
      {errorLocal !== null ? (
        <p className="aviso-error" role="alert">
          {errorLocal}
        </p>
      ) : null}

      {!cargando && resumen !== null ? (
        <>
          <form
            className="formulario formulario-asignacion-cliente"
            onSubmit={(evento) => {
              evento.preventDefault();
              manejarAsignacion();
            }}
          >
            <div className="campo">
              <label htmlFor={`cuenta-support-${clientId}`}>Cuenta SUPPORT</label>
              <select
                id={`cuenta-support-${clientId}`}
                required
                value={usuarioSeleccionado}
                onChange={(evento) => setUsuarioSeleccionado(evento.currentTarget.value)}
                disabled={guardando || cuentasDisponibles.length === 0}
              >
                <option value="">Selecciona una cuenta activa</option>
                {cuentasDisponibles.map((cuenta) => (
                  <option value={cuenta.id} key={cuenta.id}>
                    {cuenta.displayName} (@{cuenta.username})
                  </option>
                ))}
              </select>
              {cuentasDisponibles.length === 0 ? (
                <span className="ayuda-campo">No hay cuentas SUPPORT activas sin asignación.</span>
              ) : null}
            </div>
            <button
              className="boton-secundario"
              type="submit"
              disabled={guardando || cuentasDisponibles.length === 0 || !clienteActivo}
            >
              {guardando ? 'Guardando…' : 'Asignar acceso'}
            </button>
          </form>

          {asignacionesActivas.length === 0 ? (
            <p className="estado-vacio" role="status">
              No hay cuentas SUPPORT con acceso vigente.
            </p>
          ) : (
            <ul className="lista-accesos-cliente" aria-label="Cuentas SUPPORT autorizadas">
              {asignacionesActivas.map(renderizarAsignacion)}
            </ul>
          )}

          <fieldset className="grupo-capacidades-rf1">
            <legend>Capacidades de Insertar Facturas en BD</legend>
            <label className="capacidad-rf1">
              <input
                type="checkbox"
                checked={capacidadLectura}
                onChange={(evento) => manejarCapacidad('rf-1:read', evento.currentTarget.checked)}
                disabled={guardando || !clienteActivo}
                aria-label="Permitir vista previa de facturas"
              />
              <span>
                <strong>Permitir vista previa de facturas</strong>
                <span className="texto-secundario">
                  Permite cargar XML y consultar datos autorizados sin insertar facturas.
                </span>
              </span>
            </label>
            <label className="capacidad-rf1">
              <input
                type="checkbox"
                checked={capacidadEjecucion}
                onChange={(evento) =>
                  manejarCapacidad('rf-1:execute', evento.currentTarget.checked)
                }
                disabled={guardando || !clienteActivo}
                aria-label="Permitir inserción de facturas"
              />
              <span>
                <strong>Permitir inserción de facturas</strong>
                <span className="texto-secundario">
                  Permiso por cliente; la compuerta global del servidor se habilita por separado.
                </span>
              </span>
            </label>
          </fieldset>
          {!clienteActivo ? (
            <p className="ayuda-campo">Activa el cliente antes de configurar su capacidad.</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/**
 * Traduce fallos de API a mensajes públicos sin conservar respuesta ni detalles remotos.
 * @param error - Rechazo de transporte o error controlado por un cliente API.
 * @returns Mensaje público sin cuerpo, URL, datos de conexión ni credencial.
 * @throws No lanza; usa un mensaje de reserva para valores desconocidos.
 */
function traducirErrorAcceso(error: unknown): string {
  if (error instanceof ErrorApiClientes || error instanceof ErrorApiAuth) {
    return error.message;
  }
  return 'No fue posible actualizar el acceso del cliente. Inténtalo de nuevo.';
}
