'use client';

import { useState, type ChangeEvent, type FormEvent, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorApiAuth, iniciarSesion } from '../../lib/auth-api';

/**
 * Presenta el acceso por username y entrega contraseñas al API únicamente por POST.
 *
 * @returns Formulario accesible con navegación posterior según el rol vigente.
 */
export function FormularioInicioSesion(): JSX.Element {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Envía el formulario sin persistir ni registrar los valores de credenciales.
   *
   * @param evento - Envío nativo del formulario que debe evitar navegación HTML.
   * @returns Promesa resuelta tras autenticar, mostrar un error o limpiar el estado de carga.
   */
  async function enviar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setCargando(true);
    setError(null);
    try {
      await iniciarSesion(username, password);
      router.replace('/dashboard');
    } catch (rechazo: unknown) {
      if (
        rechazo instanceof ErrorApiAuth &&
        ['INVALID_CREDENTIALS', 'RATE_LIMITED'].includes(rechazo.code)
      ) {
        setError('No fue posible iniciar sesión. Revisa tus datos e inténtalo de nuevo.');
      } else {
        setError(
          rechazo instanceof ErrorApiAuth
            ? rechazo.message
            : 'No fue posible conectar con el portal. Inténtalo de nuevo.',
        );
      }
    } finally {
      setCargando(false);
    }
  }

  /** Actualiza el username local sin normalizar datos que valida el servidor. */
  function manejarCambioUsuario(evento: ChangeEvent<HTMLInputElement>): void {
    setUsername(evento.currentTarget.value);
  }

  /** Mantiene la contraseña solo en estado transitorio del componente. */
  function manejarCambioContrasena(evento: ChangeEvent<HTMLInputElement>): void {
    setPassword(evento.currentTarget.value);
  }

  return (
    <main className="auth-viewport">
      <div className="auth-layout">
        <header className="identidad-marca">
          <p className="marca">e-Billia</p>
          <p className="marca-descripcion">Portal de Soporte</p>
        </header>
        <section className="auth-panel" aria-labelledby="login-titulo">
          <div className="encabezado-panel">
            <p className="sobrelinea">Acceso seguro</p>
            <h1 id="login-titulo">Inicia sesión</h1>
            <p className="texto-secundario">Usa tu cuenta personal del portal.</p>
          </div>
          <form className="formulario" onSubmit={enviar}>
            <div className="campo">
              <label htmlFor="username">Nombre de usuario</label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                minLength={3}
                maxLength={64}
                pattern="[A-Za-z0-9._-]+"
                required
                value={username}
                onChange={manejarCambioUsuario}
              />
            </div>
            <div className="campo">
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={1}
                maxLength={512}
                required
                value={password}
                onChange={manejarCambioContrasena}
              />
            </div>
            {error !== null ? (
              <p className="aviso-error" id="login-error" role="alert" aria-live="polite">
                {error}
              </p>
            ) : null}
            <button
              className="boton-primario boton-ancho"
              type="submit"
              disabled={cargando}
              aria-busy={cargando}
            >
              {cargando ? 'Iniciando sesión…' : 'Continuar'}
            </button>
          </form>
          <div className="pie-panel">
            <p className="texto-secundario">
              ¿Problemas para entrar? Contacta con una persona administradora para restablecer tu
              acceso.
            </p>
          </div>
        </section>
        <p className="nota-privacidad">
          Cada persona usa su propia cuenta. No compartas tu contraseña.
        </p>
      </div>
    </main>
  );
}
