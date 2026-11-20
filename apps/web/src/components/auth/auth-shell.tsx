'use client';

import { useCallback, useEffect, useState, type JSX, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { RespuestaUsuarioPublico, RolUsuario } from '@portal-soporte/contracts/auth';
import { cerrarSesion, ErrorApiAuth, obtenerSesion } from '../../lib/auth-api';

/** Propiedades de contenido cuya sesión requiere validación remota antes de mostrarse. */
export interface PropiedadesMarcoAutenticado {
  /** Contenido protegido que se renderiza tras cargar la sesión. */
  readonly children: ReactNode;
  /** Rol requerido en la interfaz; el backend conserva la autorización definitiva. */
  readonly rolRequerido?: RolUsuario;
}

/**
 * Valida la sesión en el servidor y muestra navegación según la identidad confirmada.
 *
 * @param propiedades - Contenido protegido y rol de presentación opcional.
 * @param propiedades.children - Interfaz que solo se muestra tras cargar la sesión.
 * @param propiedades.rolRequerido - Rol para ocultar contenido en la interfaz; el backend decide el acceso.
 * @returns Estado de sesión, navegación de cuenta o mensaje accesible de denegación.
 */
export function MarcoAutenticado({
  children,
  rolRequerido,
}: PropiedadesMarcoAutenticado): JSX.Element {
  const router = useRouter();
  const rutaActual = usePathname();
  const [usuario, setUsuario] = useState<RespuestaUsuarioPublico | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorSalida, setErrorSalida] = useState<string | null>(null);

  /** Consulta el API y publica el resultado solo mientras el marco siga montado. */
  const verificarSesion = useCallback((): (() => void) => {
    let vigente = true;
    /** Carga la identidad vigente y traduce fallos a mensajes no sensibles. */
    async function cargarSesion(): Promise<void> {
      try {
        const sesion = await obtenerSesion();
        if (vigente) {
          setUsuario(sesion);
          setCargando(false);
        }
      } catch (error: unknown) {
        if (!vigente) {
          return;
        }
        setCargando(false);
        if (error instanceof ErrorApiAuth && error.status === 401) {
          router.replace('/login');
          return;
        }
        setErrorSalida('No fue posible validar la sesión. Inténtalo de nuevo.');
      }
    }

    void cargarSesion();

    return () => {
      vigente = false;
    };
  }, [router]);

  useEffect(verificarSesion, [verificarSesion]);

  /**
   * Invalida la sesión en el servidor antes de abandonar las pantallas protegidas.
   *
   * @returns Promesa que resuelve tras cerrar la sesión o comunicar un error controlado.
   */
  async function salir(): Promise<void> {
    setErrorSalida(null);
    try {
      await cerrarSesion();
      router.replace('/login');
    } catch {
      setErrorSalida('No fue posible cerrar la sesión. Vuelve a intentarlo.');
    }
  }

  /** Inicia el cierre solicitado por la persona sin bloquear el evento de interfaz. */
  function manejarSalida(): void {
    void salir();
  }

  if (cargando || usuario === null) {
    return (
      <main className="auth-viewport">
        <section className="auth-panel" aria-labelledby="estado-sesion-titulo">
          <p className="marca" aria-label="Portal de Soporte e-Billia">
            e-Billia
          </p>
          <h1 id="estado-sesion-titulo">
            {cargando ? 'Comprobando tu sesión' : 'Sesión no disponible'}
          </h1>
          <p className="texto-secundario" role={cargando ? 'status' : 'alert'}>
            {cargando
              ? 'Un momento, por favor.'
              : (errorSalida ?? 'Te llevaremos al inicio de sesión.')}
          </p>
        </section>
      </main>
    );
  }

  if (rolRequerido !== undefined && usuario.role !== rolRequerido) {
    return (
      <main className="auth-viewport">
        <section className="auth-panel" aria-labelledby="permiso-titulo">
          <p className="marca" aria-label="Portal de Soporte e-Billia">
            e-Billia
          </p>
          <h1 id="permiso-titulo">No tienes permiso para esta pantalla</h1>
          <p className="texto-secundario">Tu cuenta puede cambiar su propia contraseña.</p>
          <Link className="enlace" href="/profile/password">
            Ir a cambio de contraseña
          </Link>
        </section>
      </main>
    );
  }

  return (
    <div className="area-autenticada">
      <aside className="barra-lateral" aria-label="Navegación del Portal de Soporte">
        <Link
          className="marca marca-enlace"
          href="/dashboard"
          aria-label="e-Billia, Portal de Soporte"
        >
          <span>e-Billia</span>
          <span className="marca-descripcion">Portal de Soporte</span>
        </Link>
        <div className="identidad-lateral" aria-label="Cuenta activa">
          <span className="avatar-lateral" aria-hidden="true">
            {usuario.displayName.slice(0, 1).toUpperCase()}
          </span>
          <span className="identidad-detalle">
            <strong>{usuario.displayName}</strong>
            <span>{usuario.role === 'ADMIN' ? 'Administración' : 'Soporte'}</span>
          </span>
        </div>
        <nav className="navegacion" aria-label="Principal">
          <Link href="/dashboard" aria-current={rutaActual === '/dashboard' ? 'page' : undefined}>
            Inicio
          </Link>
          {usuario.role === 'ADMIN' ? (
            <Link
              href="/settings/users"
              aria-current={rutaActual === '/settings/users' ? 'page' : undefined}
            >
              Usuarios
            </Link>
          ) : null}
        </nav>
        <div className="navegacion-inferior">
          <Link
            href="/profile/password"
            aria-current={rutaActual.startsWith('/profile/') ? 'page' : undefined}
          >
            Mi contraseña
          </Link>
          <button className="boton-secundario boton-salir" type="button" onClick={manejarSalida}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="panel-aplicacion">
        {errorSalida !== null ? (
          <p className="aviso-error aviso-global" role="alert">
            {errorSalida}
          </p>
        ) : null}
        <main className="contenido-autenticado">{children}</main>
      </div>
    </div>
  );
}
