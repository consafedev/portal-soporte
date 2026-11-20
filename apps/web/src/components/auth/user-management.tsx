'use client';

import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
  type JSX,
} from 'react';
import type {
  RespuestaUsuarioAdmin,
  RolUsuario,
  SolicitudAltaUsuarioAdmin,
  SolicitudModificacionUsuarioAdmin,
} from '@portal-soporte/contracts/auth';
import {
  actualizarUsuarioAdmin,
  crearUsuarioAdmin,
  ErrorApiAuth,
  listarUsuariosAdmin,
  restablecerContrasenaAdmin,
  revocarSesionesAdmin,
} from '../../lib/auth-api';

/**
 * Presenta la administración mínima de cuentas disponible únicamente para ADMIN.
 *
 * @returns Formularios y fichas con estado, verificación y operaciones administrativas.
 */
export function AdministracionUsuarios(): JSX.Element {
  const [usuarios, setUsuarios] = useState<readonly RespuestaUsuarioAdmin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<RolUsuario>('SUPPORT');
  const [initialPassword, setInitialPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Carga los DTOs administrativos sin guardar respuestas en caché del navegador.
   *
   * @returns Promesa que actualiza la lista o publica un error localizado.
   */
  const recargarUsuarios = useCallback(async (): Promise<void> => {
    setCargando(true);
    try {
      setUsuarios(await listarUsuariosAdmin());
      setError(null);
    } catch (rechazo: unknown) {
      setError(
        rechazo instanceof ErrorApiAuth
          ? rechazo.message
          : 'No fue posible cargar las cuentas. Inténtalo de nuevo.',
      );
    } finally {
      setCargando(false);
    }
  }, []);

  /** Carga las cuentas al montar y descarta resultados si la pantalla ya se desmontó. */
  const cargarUsuariosIniciales = useCallback((): (() => void) => {
    let vigente = true;
    /** Obtiene la primera lista sin conservar efectos de una pantalla desmontada. */
    async function cargar(): Promise<void> {
      try {
        const resultado = await listarUsuariosAdmin();
        if (vigente) {
          setUsuarios(resultado);
          setError(null);
        }
      } catch (rechazo: unknown) {
        if (vigente) {
          setError(
            rechazo instanceof ErrorApiAuth
              ? rechazo.message
              : 'No fue posible cargar las cuentas. Inténtalo de nuevo.',
          );
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

  useEffect(cargarUsuariosIniciales, [cargarUsuariosIniciales]);

  /**
   * Crea una cuenta individual con una credencial inicial definida por ADMIN.
   *
   * @param evento - Envío del formulario de invitación.
   * @returns Promesa que actualiza la lista o publica un error controlado.
   */
  async function crear(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setEnviando(true);
    setAviso(null);
    setError(null);
    if (initialPassword !== passwordConfirmation) {
      setError('Las contraseñas iniciales no coinciden.');
      setEnviando(false);
      return;
    }
    const solicitud: SolicitudAltaUsuarioAdmin = {
      username,
      email,
      displayName,
      role,
      initialPassword,
    };
    try {
      const resultado = await crearUsuarioAdmin(solicitud);
      setUsername('');
      setEmail('');
      setDisplayName('');
      setRole('SUPPORT');
      setInitialPassword('');
      setPasswordConfirmation('');
      await recargarUsuarios();
      if ('credentialStatus' in resultado) {
        setAviso('Cuenta creada. Comparte la contraseña inicial por un canal seguro.');
      } else if (resultado.invitationStatus === 'ACCEPTED') {
        setAviso('La cuenta se creó y el enlace de activación se envió.');
      } else if (resultado.invitationStatus === 'RATE_LIMITED') {
        setError('La cuenta se creó, pero el enlace se limitó.');
      } else {
        setError(
          'La cuenta se creó, pero no se pudo entregar el enlace. Puedes volver a intentarlo desde su ficha.',
        );
      }
    } catch (rechazo: unknown) {
      setError(
        rechazo instanceof ErrorApiAuth
          ? rechazo.message
          : 'No fue posible crear la cuenta. Inténtalo de nuevo.',
      );
    } finally {
      setEnviando(false);
    }
  }

  /** Actualiza el username de la próxima cuenta invitada. */
  function manejarCambioUsername(evento: ChangeEvent<HTMLInputElement>): void {
    setUsername(evento.currentTarget.value);
  }

  /** Actualiza el nombre visible de la próxima cuenta invitada. */
  function manejarCambioNombreVisible(evento: ChangeEvent<HTMLInputElement>): void {
    setDisplayName(evento.currentTarget.value);
  }

  /** Actualiza el correo al que se enviará la invitación verificada. */
  function manejarCambioCorreo(evento: ChangeEvent<HTMLInputElement>): void {
    setEmail(evento.currentTarget.value);
  }

  /** Actualiza la contraseña inicial sin conservarla fuera del estado de esta pantalla. */
  function manejarCambioContrasenaInicial(evento: ChangeEvent<HTMLInputElement>): void {
    setInitialPassword(evento.currentTarget.value);
  }

  /** Actualiza la confirmación local sin enviarla al servidor. */
  function manejarConfirmacionContrasena(evento: ChangeEvent<HTMLInputElement>): void {
    setPasswordConfirmation(evento.currentTarget.value);
  }

  /** Conserva únicamente uno de los dos roles que admite el contrato de identidad. */
  function manejarCambioRol(evento: ChangeEvent<HTMLSelectElement>): void {
    const rolSeleccionado = evento.currentTarget.value;
    if (rolSeleccionado === 'ADMIN' || rolSeleccionado === 'SUPPORT') {
      setRole(rolSeleccionado);
    }
  }

  /** Actualiza la lista a pedido sin propagar la promesa al evento del navegador. */
  function manejarRecarga(): void {
    void recargarUsuarios();
  }

  /** Construye la ficha de presentación para un DTO administrativo ya validado. */
  function renderizarTarjetaUsuario(usuario: RespuestaUsuarioAdmin): JSX.Element {
    return (
      <TarjetaUsuario
        key={`${usuario.id}-${usuario.displayName}-${usuario.role}-${usuario.email}-${usuario.status}`}
        usuario={usuario}
        actualizarLista={recargarUsuarios}
        notificar={setAviso}
        reportarError={setError}
      />
    );
  }

  return (
    <div className="pagina-contenido">
      <header className="titulo-pagina">
        <p className="sobrelinea">Administración</p>
        <h1>Usuarios</h1>
        <p className="texto-secundario">
          Las altas se gestionan directamente por administración. El correo de referencia no se
          verifica ni recibe notificaciones.
        </p>
      </header>
      <section className="panel-contenido" aria-labelledby="crear-usuario-titulo">
        <h2 id="crear-usuario-titulo">Crear una cuenta</h2>
        <form className="formulario formulario-invitacion" onSubmit={crear}>
          <div className="campo">
            <label htmlFor="new-username">Nombre de usuario</label>
            <input
              id="new-username"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              minLength={3}
              maxLength={64}
              pattern="[A-Za-z0-9._-]+"
              required
              value={username}
              onChange={manejarCambioUsername}
            />
          </div>
          <div className="campo">
            <label htmlFor="new-display-name">Nombre visible</label>
            <input
              id="new-display-name"
              maxLength={120}
              required
              value={displayName}
              onChange={manejarCambioNombreVisible}
            />
          </div>
          <div className="campo">
            <label htmlFor="new-user-email">Correo de referencia</label>
            <input
              id="new-user-email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              value={email}
              onChange={manejarCambioCorreo}
            />
          </div>
          <div className="campo">
            <label htmlFor="new-user-role">Rol</label>
            <select id="new-user-role" value={role} onChange={manejarCambioRol}>
              <option value="SUPPORT">Soporte</option>
              <option value="ADMIN">Administración</option>
            </select>
          </div>
          <div className="campo">
            <label htmlFor="new-user-password">Contraseña inicial</label>
            <input
              id="new-user-password"
              type="password"
              autoComplete="new-password"
              minLength={15}
              maxLength={256}
              required
              value={initialPassword}
              onChange={manejarCambioContrasenaInicial}
              aria-describedby="new-user-password-help"
            />
            <p id="new-user-password-help" className="texto-secundario">
              Usa al menos 15 caracteres y comparte la contraseña con la persona por un canal
              seguro.
            </p>
          </div>
          <div className="campo">
            <label htmlFor="new-user-password-confirmation">Confirmar contraseña inicial</label>
            <input
              id="new-user-password-confirmation"
              type="password"
              autoComplete="new-password"
              minLength={15}
              maxLength={256}
              required
              value={passwordConfirmation}
              onChange={manejarConfirmacionContrasena}
            />
          </div>
          <button className="boton-primario" type="submit" disabled={enviando} aria-busy={enviando}>
            {enviando ? 'Creando cuenta…' : 'Crear cuenta'}
          </button>
        </form>
      </section>
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
      <section className="listado-usuarios" aria-labelledby="lista-usuarios-titulo">
        <div className="encabezado-listado">
          <div>
            <p className="sobrelinea">Acceso al portal</p>
            <h2 id="lista-usuarios-titulo">Cuentas</h2>
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
            Cargando cuentas…
          </p>
        ) : null}
        {!cargando && usuarios.length === 0 ? (
          <p className="texto-secundario">No hay cuentas para mostrar.</p>
        ) : null}
        <div className="lista-tarjetas">{usuarios.map(renderizarTarjetaUsuario)}</div>
      </section>
    </div>
  );
}

/** Propiedades de la ficha que expone controles administrativos para una cuenta concreta. */
interface PropiedadesTarjetaUsuario {
  /** DTO permitido por el contrato administrativo del API. */
  readonly usuario: RespuestaUsuarioAdmin;
  /** Recarga la lista tras un cambio confirmado por el servidor. */
  readonly actualizarLista: () => Promise<void>;
  /** Publica confirmación breve y no sensible después de una operación. */
  readonly notificar: (mensaje: string) => void;
  /** Publica un error estable para corregir o reintentar la operación. */
  readonly reportarError: (mensaje: string | null) => void;
}

/**
 * Presenta datos permitidos y acciones que el API vuelve a autorizar en servidor.
 *
 * @param propiedades - DTO de la cuenta y acciones de actualización del listado.
 * @param propiedades.usuario - Campos administrativos permitidos por el contrato.
 * @param propiedades.actualizarLista - Recarga datos después de una mutación confirmada.
 * @param propiedades.notificar - Publica una confirmación que no contiene datos sensibles.
 * @param propiedades.reportarError - Publica un error localizado y estable del API.
 * @returns Ficha accesible con controles de cuenta, correo, sesiones y estado.
 */
function TarjetaUsuario({
  usuario,
  actualizarLista,
  notificar,
  reportarError,
}: PropiedadesTarjetaUsuario): JSX.Element {
  const [nombre, setNombre] = useState(usuario.displayName);
  const [rol, setRol] = useState<RolUsuario>(usuario.role);
  const [contrasenaNueva, setContrasenaNueva] = useState('');
  const [confirmacionContrasena, setConfirmacionContrasena] = useState('');
  const [cargando, setCargando] = useState(false);

  /**
   * Guarda nombre y rol; la API comprueba el último administrador activo.
   *
   * @param evento - Envío del formulario de nombre y rol.
   * @returns Promesa resuelta cuando finaliza la actualización o su error controlado.
   */
  async function guardarCambios(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    const cambios: SolicitudModificacionUsuarioAdmin = { displayName: nombre, role: rol };
    await ejecutarOperacion(
      async () => actualizarUsuarioAdmin(usuario.id, cambios),
      'Los datos de la cuenta se actualizaron.',
    );
  }

  /** Asigna una credencial nueva y comunica que las sesiones vigentes se revocaron. */
  async function guardarContrasena(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (contrasenaNueva !== confirmacionContrasena) {
      reportarError('Las contraseñas no coinciden.');
      return;
    }

    setCargando(true);
    reportarError(null);
    try {
      await restablecerContrasenaAdmin(usuario.id, { newPassword: contrasenaNueva });
      setContrasenaNueva('');
      setConfirmacionContrasena('');
      notificar('La contraseña se actualizó y las sesiones anteriores se revocaron.');
      await actualizarLista();
    } catch (rechazo: unknown) {
      reportarError(
        rechazo instanceof ErrorApiAuth
          ? rechazo.message
          : 'No fue posible actualizar la contraseña. Inténtalo de nuevo.',
      );
    } finally {
      setCargando(false);
    }
  }

  /**
   * Cambia el estado de una cuenta y pide confirmación antes de desactivarla.
   *
   * @returns Promesa que termina después de confirmar, actualizar o cancelar la acción.
   */
  async function cambiarEstado(): Promise<void> {
    const esInvitacionPendiente = usuario.status === 'PENDING_ACTIVATION';
    const esInvitacionReactivable = usuario.status === 'DISABLED' && !usuario.hasPassword;
    const esCuentaReactivable = usuario.status === 'DISABLED' && usuario.hasPassword;
    if (esInvitacionPendiente && !window.confirm('¿Cancelar esta invitación y anular su enlace?')) {
      return;
    }
    if (esInvitacionReactivable) return;
    if (esCuentaReactivable && !window.confirm(`¿Reactivar la cuenta de ${usuario.username}?`)) {
      return;
    }
    if (
      !esInvitacionPendiente &&
      !esInvitacionReactivable &&
      !esCuentaReactivable &&
      usuario.status === 'ACTIVE' &&
      !window.confirm(`¿Desactivar la cuenta de ${usuario.username}?`)
    ) {
      return;
    }
    const nuevoEstado = esInvitacionPendiente
      ? 'DISABLED'
      : usuario.status === 'ACTIVE'
        ? 'DISABLED'
        : 'ACTIVE';
    const confirmacion = esInvitacionPendiente
      ? 'La invitación se canceló y su enlace quedó invalidado.'
      : nuevoEstado === 'ACTIVE'
        ? 'La cuenta quedó activa.'
        : 'La cuenta quedó desactivada.';
    await ejecutarOperacion(async () => {
      const actualizada = await actualizarUsuarioAdmin(usuario.id, { status: nuevoEstado });
      return actualizada;
    }, confirmacion);
  }

  /**
   * Revoca todas las sesiones del usuario sin exponer cookies o identificadores.
   *
   * @returns Promesa resuelta tras mostrar el resultado de la revocación.
   */
  async function revocarSesiones(): Promise<void> {
    await ejecutarOperacion(
      async () => revocarSesionesAdmin(usuario.id),
      'Las sesiones vigentes de esta cuenta se revocaron.',
    );
  }

  /**
   * Unifica carga, confirmación y error para una mutación administrativa.
   *
   * @typeParam T - Resultado privado de la operación, que no se presenta directamente.
   * @param operacion - Mutación ya autorizada por contrato para el API.
   * @param confirmacion - Mensaje público localizado que no revela secretos ni detalles internos.
   * @returns Promesa resuelta después de actualizar la lista o publicar un error controlado.
   */
  async function ejecutarOperacion<T>(
    operacion: () => Promise<T>,
    confirmacion: string,
  ): Promise<void> {
    setCargando(true);
    reportarError(null);
    try {
      await operacion();
      notificar(confirmacion);
      await actualizarLista();
    } catch (rechazo: unknown) {
      reportarError(
        rechazo instanceof ErrorApiAuth
          ? rechazo.message
          : 'No fue posible completar la operación. Inténtalo de nuevo.',
      );
    } finally {
      setCargando(false);
    }
  }

  /** Actualiza el nombre visible local antes de enviar el formulario de cambios. */
  function manejarCambioNombre(evento: ChangeEvent<HTMLInputElement>): void {
    setNombre(evento.currentTarget.value);
  }

  /** Conserva solo los roles válidos disponibles en el contrato del portal. */
  function manejarCambioRol(evento: ChangeEvent<HTMLSelectElement>): void {
    const rolSeleccionado = evento.currentTarget.value;
    if (rolSeleccionado === 'ADMIN' || rolSeleccionado === 'SUPPORT') {
      setRol(rolSeleccionado);
    }
  }

  /** Actualiza la nueva contraseña solo en memoria del formulario administrativo. */
  function manejarContrasenaNueva(evento: ChangeEvent<HTMLInputElement>): void {
    setContrasenaNueva(evento.currentTarget.value);
  }

  /** Actualiza la confirmación local sin transmitirla al backend. */
  function manejarConfirmacionContrasena(evento: ChangeEvent<HTMLInputElement>): void {
    setConfirmacionContrasena(evento.currentTarget.value);
  }

  /** Solicita la revocación de sesiones sin bloquear el evento de botón. */
  function manejarRevocacion(): void {
    void revocarSesiones();
  }

  /** Inicia el cambio de estado tras aplicar la confirmación de desactivación. */
  function manejarCambioEstado(): void {
    void cambiarEstado();
  }

  return (
    <article className="tarjeta-usuario" aria-labelledby={`usuario-${usuario.id}`}>
      <header className="encabezado-usuario">
        <div>
          <h3 id={`usuario-${usuario.id}`}>{usuario.displayName}</h3>
          <p className="texto-secundario">@{usuario.username}</p>
        </div>
        <span className={`etiqueta-estado estado-${usuario.status.toLowerCase()}`}>
          {etiquetaEstado(usuario.status)}
        </span>
      </header>
      <dl className="datos-usuario">
        <div>
          <dt>Correo</dt>
          <dd>{usuario.email}</dd>
        </div>
        <div>
          <dt>Verificación</dt>
          <dd>{usuario.emailVerifiedAt === null ? 'Pendiente' : 'Verificado'}</dd>
        </div>
        <div>
          <dt>Rol actual</dt>
          <dd>{usuario.role === 'ADMIN' ? 'Administración' : 'Soporte'}</dd>
        </div>
      </dl>
      <details className="acciones-usuario">
        <summary>Administrar esta cuenta</summary>
        <div className="grupo-acciones">
          <form className="formulario formulario-tarjeta" onSubmit={guardarCambios}>
            <div className="campo">
              <label htmlFor={`nombre-${usuario.id}`}>Nombre visible</label>
              <input
                id={`nombre-${usuario.id}`}
                maxLength={120}
                required
                value={nombre}
                onChange={manejarCambioNombre}
              />
            </div>
            <div className="campo">
              <label htmlFor={`rol-${usuario.id}`}>Rol</label>
              <select id={`rol-${usuario.id}`} value={rol} onChange={manejarCambioRol}>
                <option value="SUPPORT">Soporte</option>
                <option value="ADMIN">Administración</option>
              </select>
            </div>
            <button className="boton-secundario" type="submit" disabled={cargando}>
              Guardar nombre y rol
            </button>
          </form>
          <form className="formulario formulario-tarjeta" onSubmit={guardarContrasena}>
            <div className="campo">
              <label htmlFor={`password-${usuario.id}`}>Contraseña nueva</label>
              <input
                id={`password-${usuario.id}`}
                type="password"
                autoComplete="new-password"
                minLength={15}
                maxLength={256}
                required
                value={contrasenaNueva}
                onChange={manejarContrasenaNueva}
              />
            </div>
            <div className="campo">
              <label htmlFor={`password-confirm-${usuario.id}`}>Confirmar contraseña nueva</label>
              <input
                id={`password-confirm-${usuario.id}`}
                type="password"
                autoComplete="new-password"
                minLength={15}
                maxLength={256}
                required
                value={confirmacionContrasena}
                onChange={manejarConfirmacionContrasena}
              />
            </div>
            <p className="texto-secundario">
              Comparte la contraseña por un canal seguro. Las sesiones vigentes se cerrarán.
            </p>
            <button className="boton-secundario" type="submit" disabled={cargando}>
              Asignar contraseña nueva
            </button>
          </form>
          <div className="fila-acciones">
            <button
              className="boton-secundario"
              type="button"
              onClick={manejarRevocacion}
              disabled={cargando}
            >
              Revocar sesiones
            </button>
            {usuario.status === 'PENDING_ACTIVATION' ? (
              <button
                className="boton-secundario boton-peligro"
                type="button"
                onClick={manejarCambioEstado}
                disabled={cargando}
              >
                Cancelar invitación
              </button>
            ) : usuario.status === 'DISABLED' && !usuario.hasPassword ? (
              <button
                className="boton-secundario"
                type="button"
                title="La reactivación de invitaciones requiere SMTP."
                disabled
              >
                Reactivación requiere SMTP
              </button>
            ) : (
              <button
                className="boton-secundario boton-peligro"
                type="button"
                onClick={manejarCambioEstado}
                disabled={cargando}
              >
                {usuario.status === 'ACTIVE' ? 'Desactivar cuenta' : 'Activar cuenta'}
              </button>
            )}
          </div>
        </div>
      </details>
    </article>
  );
}

/**
 * Convierte estados persistidos en etiquetas breves para las fichas de cuenta.
 *
 * @param estado - Estado de la cuenta recibido mediante el contrato del API.
 * @returns Etiqueta en español que no revela información técnica interna.
 */
function etiquetaEstado(estado: RespuestaUsuarioAdmin['status']): string {
  if (estado === 'PENDING_ACTIVATION') {
    return 'Pendiente';
  }
  return estado === 'ACTIVE' ? 'Activa' : 'Desactivada';
}
