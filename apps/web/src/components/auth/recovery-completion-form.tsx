'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type JSX,
} from 'react';
import Link from 'next/link';
import { completarAcceso, completarCambioCorreo, ErrorApiAuth } from '../../lib/auth-api';
import {
  obtenerDescripcionFlujo,
  obtenerTituloFlujo,
  type FlujoEnlace,
} from '../../lib/recovery-link-copy';

/**
 * Consume el token desde el fragmento y lo elimina del historial antes de enviarlo.
 *
 * @returns Formulario de un solo uso que nunca incluye el token en consultas o contenido visible.
 */
export function FormularioCompletarEnlace(): JSX.Element {
  const fragmentoLeido = useRef<{
    readonly token: string | null;
    readonly flujo: FlujoEnlace | null;
  } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [flujo, setFlujo] = useState<FlujoEnlace | null>(null);
  const [listo, setListo] = useState(false);
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [cargando, setCargando] = useState(false);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Lee una sola vez el fragmento, lo limpia y publica el resultado tras el efecto. */
  const inicializarEnlace = useCallback(function inicializarEnlace(): () => void {
    if (fragmentoLeido.current === null) {
      const url = new URL(window.location.href);
      const parametros = new URLSearchParams(url.hash.slice(1));
      fragmentoLeido.current = {
        token: parametros.get('token'),
        flujo: resolverFlujoEnlace(parametros.get('flow')),
      };
      window.history.replaceState(null, '', window.location.pathname);
    }
    const enlace = fragmentoLeido.current;
    let vigente = true;
    /** Actualiza el formulario solo si el efecto permanece activo en React Strict Mode. */
    function publicarResultado(): void {
      if (!vigente) {
        return;
      }
      if (
        enlace.token !== null &&
        /^[A-Za-z0-9_-]{43}$/u.test(enlace.token) &&
        enlace.flujo !== null
      ) {
        setToken(enlace.token);
        setFlujo(enlace.flujo);
      }
      setListo(true);
    }

    queueMicrotask(publicarResultado);

    return () => {
      vigente = false;
    };
  }, []);

  useEffect(inicializarEnlace, [inicializarEnlace]);

  /**
   * Envía el token una vez por POST y limpia el estado sensible después de procesarlo.
   *
   * @param evento - Envío del formulario asociado al propósito ya validado.
   * @returns Promesa que termina tras completar el flujo o anunciar un error controlado.
   */
  async function completar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (token === null || flujo === null) {
      setError('El enlace no es válido o ya venció.');
      return;
    }
    if (flujo === 'activation' || flujo === 'recovery') {
      if (nueva !== confirmacion) {
        setError('Las contraseñas no coinciden.');
        return;
      }
      if (Array.from(nueva).length < 15 || Array.from(nueva).length > 128) {
        setError('La contraseña debe tener entre 15 y 128 caracteres Unicode.');
        return;
      }
    }

    setCargando(true);
    setError(null);
    try {
      if (flujo === 'activation' || flujo === 'recovery') {
        await completarAcceso(flujo, { token, newPassword: nueva });
        setMensajeExito(
          flujo === 'activation'
            ? 'La cuenta quedó activada. Ya puedes iniciar sesión.'
            : 'La contraseña se actualizó. Inicia sesión con tu contraseña nueva.',
        );
      } else {
        await completarCambioCorreo(token);
        setMensajeExito('El correo quedó verificado y actualizado.');
      }
      setToken(null);
      setNueva('');
      setConfirmacion('');
    } catch (rechazo: unknown) {
      setError(
        rechazo instanceof ErrorApiAuth
          ? rechazo.message
          : 'No fue posible completar el enlace. Inténtalo de nuevo.',
      );
    } finally {
      setCargando(false);
    }
  }

  /** Conserva la contraseña nueva solo en memoria hasta completar el token. */
  function manejarCambioContrasena(evento: ChangeEvent<HTMLInputElement>): void {
    setNueva(evento.currentTarget.value);
  }

  /** Actualiza la confirmación temporal para detectar errores de escritura. */
  function manejarCambioConfirmacion(evento: ChangeEvent<HTMLInputElement>): void {
    setConfirmacion(evento.currentTarget.value);
  }

  const flujoDeContrasena = flujo === 'activation' || flujo === 'recovery';

  return (
    <main className="auth-viewport">
      <div className="auth-layout">
        <header className="identidad-marca">
          <p className="marca">e-Billia</p>
          <p className="marca-descripcion">Portal de Soporte</p>
        </header>
        <section className="auth-panel" aria-labelledby="enlace-titulo">
          <div className="encabezado-panel">
            <p className="sobrelinea">Enlace de un solo uso</p>
            <h1 id="enlace-titulo">{obtenerTituloFlujo(flujo)}</h1>
            <p className="texto-secundario">{obtenerDescripcionFlujo(flujo)}</p>
          </div>
          {!listo ? (
            <p className="texto-secundario" role="status">
              Comprobando el enlace…
            </p>
          ) : null}
          {listo && token === null && mensajeExito === null ? (
            <p className="aviso-error" role="alert">
              El enlace no es válido o ya venció. Solicita uno nuevo.
            </p>
          ) : null}
          {mensajeExito !== null ? (
            <p className="aviso-exito" role="status">
              {mensajeExito}
            </p>
          ) : null}
          {listo && token !== null && mensajeExito === null ? (
            <form className="formulario" onSubmit={completar}>
              {flujoDeContrasena ? (
                <>
                  <div className="campo">
                    <label htmlFor="nueva-contrasena">Contraseña nueva</label>
                    <input
                      id="nueva-contrasena"
                      name="newPassword"
                      type="password"
                      autoComplete="new-password"
                      minLength={15}
                      maxLength={256}
                      required
                      value={nueva}
                      onChange={manejarCambioContrasena}
                    />
                    <span className="ayuda-campo">15–128 caracteres Unicode.</span>
                  </div>
                  <div className="campo">
                    <label htmlFor="confirmar-contrasena">Confirma la contraseña</label>
                    <input
                      id="confirmar-contrasena"
                      name="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      minLength={15}
                      maxLength={256}
                      required
                      value={confirmacion}
                      onChange={manejarCambioConfirmacion}
                    />
                  </div>
                </>
              ) : null}
              {error !== null ? (
                <p className="aviso-error" role="alert" aria-live="polite">
                  {error}
                </p>
              ) : null}
              <button
                className="boton-primario boton-ancho"
                type="submit"
                disabled={cargando}
                aria-busy={cargando}
              >
                {cargando
                  ? 'Procesando…'
                  : flujoDeContrasena
                    ? 'Guardar contraseña'
                    : 'Confirmar correo'}
              </button>
            </form>
          ) : null}
          <div className="pie-panel">
            <Link className="enlace" href="/login">
              Volver al inicio de sesión
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

/**
 * Resuelve los propósitos que el servidor puede incluir en el fragmento del enlace.
 *
 * @param valor - Valor no confiable leído desde el fragmento de la URL.
 * @returns Un propósito admitido o `null` cuando el valor no coincide exactamente.
 */
function resolverFlujoEnlace(valor: string | null): FlujoEnlace | null {
  if (
    valor === 'activation' ||
    valor === 'recovery' ||
    valor === 'email-change' ||
    valor === 'verify-email'
  ) {
    return valor;
  }

  return null;
}
