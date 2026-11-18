'use client';

import { useState, type ChangeEvent, type FormEvent, type JSX } from 'react';
import Link from 'next/link';
import { ErrorApiAuth, solicitarRecuperacion } from '../../lib/auth-api';

/**
 * Presenta una solicitud de recuperación con respuesta pública no enumerativa.
 *
 * @returns Formulario accesible que informa el mismo resultado para cualquier correo.
 */
export function FormularioSolicitudRecuperacion(): JSX.Element {
  const [email, setEmail] = useState('');
  const [cargando, setCargando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Solicita el enlace sin indicar si existe una cuenta para el correo ingresado.
   *
   * @param evento - Envío nativo que se procesará mediante la API same-origin.
   * @returns Promesa que termina tras comunicar una respuesta genérica o un error controlado.
   */
  async function enviar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setCargando(true);
    setError(null);
    setEnviado(false);
    try {
      await solicitarRecuperacion(email);
      setEnviado(true);
      setEmail('');
    } catch (rechazo: unknown) {
      setError(
        rechazo instanceof ErrorApiAuth
          ? rechazo.message
          : 'No fue posible enviar la solicitud. Inténtalo de nuevo.',
      );
    } finally {
      setCargando(false);
    }
  }

  /** Conserva el correo solo en memoria mientras la persona completa la solicitud. */
  function manejarCambioCorreo(evento: ChangeEvent<HTMLInputElement>): void {
    setEmail(evento.currentTarget.value);
  }

  return (
    <main className="auth-viewport">
      <div className="auth-layout">
        <header className="identidad-marca">
          <p className="marca">e-Billia</p>
          <p className="marca-descripcion">Portal de Soporte</p>
        </header>
        <section className="auth-panel" aria-labelledby="recuperacion-titulo">
          <div className="encabezado-panel">
            <p className="sobrelinea">Recuperación segura</p>
            <h1 id="recuperacion-titulo">Recupera el acceso</h1>
            <p className="texto-secundario">
              Si el correo pertenece a una cuenta activa y verificada, enviaremos un enlace de un
              solo uso.
            </p>
          </div>
          <form className="formulario" onSubmit={enviar}>
            <div className="campo">
              <label htmlFor="recovery-email">Correo de tu cuenta</label>
              <input
                id="recovery-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                value={email}
                onChange={manejarCambioCorreo}
              />
            </div>
            {error !== null ? (
              <p className="aviso-error" role="alert" aria-live="polite">
                {error}
              </p>
            ) : null}
            {enviado ? (
              <p className="aviso-exito" role="status">
                Si el correo pertenece a una cuenta activa y verificada, recibirás instrucciones
                para continuar.
              </p>
            ) : null}
            <button
              className="boton-primario boton-ancho"
              type="submit"
              disabled={cargando}
              aria-busy={cargando}
            >
              {cargando ? 'Enviando solicitud…' : 'Enviar instrucciones'}
            </button>
          </form>
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
