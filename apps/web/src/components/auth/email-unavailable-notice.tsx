import Link from 'next/link';
import type { JSX } from 'react';

/**
 * Presenta el estado seguro de las funciones que requieren un servicio de correo.
 *
 * @returns Aviso accesible y enlace para volver al inicio de sesión.
 */
export function AvisoCorreoNoDisponible(): JSX.Element {
  return (
    <main className="auth-viewport">
      <div className="auth-layout">
        <header className="identidad-marca">
          <p className="marca">e-Billia</p>
          <p className="marca-descripcion">Portal de Soporte</p>
        </header>
        <section className="auth-panel" aria-labelledby="correo-no-disponible-titulo">
          <div className="encabezado-panel">
            <p className="sobrelinea">Acceso seguro</p>
            <h1 id="correo-no-disponible-titulo">Recuperación por correo deshabilitada</h1>
            <p className="texto-secundario">
              No hay un servicio de correo configurado, por lo que no enviamos enlaces de
              recuperación ni verificación.
            </p>
          </div>
          <p className="texto-secundario" role="status">
            Contacta con una persona administradora para restablecer tu acceso.
          </p>
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
