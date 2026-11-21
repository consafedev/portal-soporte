'use client';

import { useState, type ChangeEvent, type FormEvent, type JSX } from 'react';
import { MarcoAutenticado } from './auth-shell';
import { FormularioPreferenciaTema } from '../theme/theme-preference-form';
import { cambiarContrasena, ErrorApiAuth, solicitarCambioCorreoPropio } from '../../lib/auth-api';

/** Configuración de disponibilidad del flujo de cambio de correo. */
export interface PropiedadesFormularioPerfil {
  /** Evita ofrecer verificación por correo cuando el runtime no tiene SMTP. */
  readonly correoHabilitado?: boolean;
}

/**
 * Presenta los cambios voluntarios de contraseña y correo con reautenticación.
 *
 * @param propiedades - Disponibilidad configurada para el flujo de cambio de correo.
 * @param propiedades.correoHabilitado - Indica si el runtime web tiene habilitado SMTP.
 * @returns Perfil protegido que explica revocación de sesiones y verificación de correo.
 */
export function FormularioPerfil({
  correoHabilitado = false,
}: PropiedadesFormularioPerfil = {}): JSX.Element {
  const [contrasenaActual, setContrasenaActual] = useState('');
  const [contrasenaNueva, setContrasenaNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [correoNuevo, setCorreoNuevo] = useState('');
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Cambia la contraseña propia después de validar la confirmación y longitud Unicode.
   *
   * @param evento - Envío del formulario de cambio voluntario.
   * @returns Promesa que se resuelve tras rotar la sesión o anunciar un error controlado.
   */
  async function guardarContrasena(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setMensaje(null);
    setError(null);
    if (contrasenaNueva !== confirmacion) {
      setError('Las contraseñas nuevas no coinciden.');
      return;
    }
    const longitud = Array.from(contrasenaNueva).length;
    if (longitud < 15 || longitud > 128) {
      setError('La contraseña debe tener entre 15 y 128 caracteres Unicode.');
      return;
    }

    setCargando(true);
    try {
      await cambiarContrasena({ currentPassword: contrasenaActual, newPassword: contrasenaNueva });
      setContrasenaActual('');
      setContrasenaNueva('');
      setConfirmacion('');
      setMensaje('La contraseña cambió y tus otras sesiones se cerraron.');
    } catch (rechazo: unknown) {
      setError(
        rechazo instanceof ErrorApiAuth
          ? rechazo.message
          : 'No fue posible cambiar la contraseña. Inténtalo de nuevo.',
      );
    } finally {
      setCargando(false);
    }
  }

  /**
   * Solicita verificación al correo nuevo tras comprobar la contraseña actual.
   *
   * @param evento - Envío del formulario de solicitud de cambio de correo.
   * @returns Promesa que se resuelve tras solicitar el enlace o anunciar un error controlado.
   */
  async function solicitarCambioCorreo(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setMensaje(null);
    setError(null);
    setCargando(true);
    try {
      await solicitarCambioCorreoPropio({
        currentPassword: contrasenaActual,
        newEmail: correoNuevo,
      });
      setCorreoNuevo('');
      setMensaje('Si el correo está disponible, recibirás un enlace para verificarlo.');
    } catch (rechazo: unknown) {
      setError(
        rechazo instanceof ErrorApiAuth
          ? rechazo.message
          : 'No fue posible solicitar el cambio de correo. Inténtalo de nuevo.',
      );
    } finally {
      setCargando(false);
    }
  }

  /** Actualiza la reautenticación temporal compartida por ambos formularios del perfil. */
  function manejarCambioContrasenaActual(evento: ChangeEvent<HTMLInputElement>): void {
    setContrasenaActual(evento.currentTarget.value);
  }

  /** Conserva la contraseña elegida solo mientras el formulario se encuentra abierto. */
  function manejarCambioContrasenaNueva(evento: ChangeEvent<HTMLInputElement>): void {
    setContrasenaNueva(evento.currentTarget.value);
  }

  /** Conserva la confirmación temporal necesaria para evitar errores de escritura. */
  function manejarCambioConfirmacion(evento: ChangeEvent<HTMLInputElement>): void {
    setConfirmacion(evento.currentTarget.value);
  }

  /** Actualiza el correo propuesto sin sustituir el correo verificado de la cuenta. */
  function manejarCambioCorreoNuevo(evento: ChangeEvent<HTMLInputElement>): void {
    setCorreoNuevo(evento.currentTarget.value);
  }

  return (
    <MarcoAutenticado>
      <div className="pagina-contenido">
        <header className="titulo-pagina">
          <p className="sobrelinea">Cuenta</p>
          <h1>Mi perfil</h1>
          <p className="texto-secundario">Mantén tus credenciales actualizadas y privadas.</p>
        </header>
        <FormularioPreferenciaTema />
        <div className="columnas-perfil">
          <section className="panel-contenido" aria-labelledby="contrasena-titulo">
            <h2 id="contrasena-titulo">Cambiar contraseña</h2>
            <p className="texto-secundario">
              Confirma tu contraseña actual. Al guardar, se cerrarán las demás sesiones.
            </p>
            <form className="formulario" onSubmit={guardarContrasena}>
              <div className="campo">
                <label htmlFor="current-password">Contraseña actual</label>
                <input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={contrasenaActual}
                  onChange={manejarCambioContrasenaActual}
                />
              </div>
              <div className="campo">
                <label htmlFor="new-password">Contraseña nueva</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={15}
                  maxLength={256}
                  required
                  value={contrasenaNueva}
                  onChange={manejarCambioContrasenaNueva}
                />
                <span className="ayuda-campo">15–128 caracteres Unicode.</span>
              </div>
              <div className="campo">
                <label htmlFor="confirm-password">Confirma la contraseña nueva</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={15}
                  maxLength={256}
                  required
                  value={confirmacion}
                  onChange={manejarCambioConfirmacion}
                />
              </div>
              <button
                className="boton-primario"
                type="submit"
                disabled={cargando}
                aria-busy={cargando}
              >
                {cargando ? 'Guardando…' : 'Guardar contraseña'}
              </button>
            </form>
          </section>
          {correoHabilitado ? (
            <section className="panel-contenido" aria-labelledby="correo-titulo">
              <h2 id="correo-titulo">Cambiar correo</h2>
              <p className="texto-secundario">
                Se requiere la contraseña actual. El correo no cambia hasta confirmar el enlace
                enviado al destino nuevo.
              </p>
              <form className="formulario" onSubmit={solicitarCambioCorreo}>
                <div className="campo">
                  <label htmlFor="email-current-password">Contraseña actual</label>
                  <input
                    id="email-current-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={contrasenaActual}
                    onChange={manejarCambioContrasenaActual}
                  />
                </div>
                <div className="campo">
                  <label htmlFor="new-email">Correo nuevo</label>
                  <input
                    id="new-email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    value={correoNuevo}
                    onChange={manejarCambioCorreoNuevo}
                  />
                </div>
                <button
                  className="boton-secundario"
                  type="submit"
                  disabled={cargando}
                  aria-busy={cargando}
                >
                  {cargando ? 'Enviando…' : 'Enviar verificación'}
                </button>
              </form>
            </section>
          ) : (
            <section className="panel-contenido" aria-labelledby="correo-titulo">
              <h2 id="correo-titulo">Correo</h2>
              <p className="aviso-informativo" role="status">
                El cambio de correo está deshabilitado porque el portal no tiene un servicio SMTP
                configurado. Una persona administradora puede restablecer credenciales sin correo.
              </p>
            </section>
          )}
        </div>
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
      </div>
    </MarcoAutenticado>
  );
}
