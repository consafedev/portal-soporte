import Link from 'next/link';
import type { JSX } from 'react';
import type { Metadata } from 'next';
import { MarcoAutenticado } from '../../components/auth/auth-shell';

/** Evita prerenderizar contenido que exige comprobar la sesión vigente. */
export const dynamic = 'force-dynamic';

/** Metadatos privados de la portada autenticada del portal. */
export const metadata: Metadata = {
  title: 'Inicio · Portal de Soporte',
  description: 'Accesos disponibles en el Portal de Soporte e-Billia.',
  robots: { index: false, follow: false },
};

/** Presenta el inicio protegido y los accesos del núcleo disponibles actualmente. */
export default function PaginaDashboard(): JSX.Element {
  return (
    <MarcoAutenticado>
      <div className="pagina-contenido pagina-dashboard">
        <header className="encabezado-dashboard">
          <p className="sobrelinea">Portal de Soporte e-Billia</p>
          <h1>Inicio</h1>
          <p className="texto-secundario">Accede a las funciones disponibles para tu cuenta.</p>
        </header>
        <section className="panel-contenido tarjeta-inicio" aria-labelledby="cuenta-titulo">
          <div>
            <p className="sobrelinea">Cuenta</p>
            <h2 id="cuenta-titulo">Cuida tu acceso</h2>
            <p className="texto-secundario">
              Mantén tu contraseña personal actualizada y cierra tu sesión al terminar.
            </p>
          </div>
          <Link className="enlace-acceso" href="/profile/password">
            <span>
              <strong>Mi contraseña</strong>
              <span>Actualizar tus credenciales</span>
            </span>
            <span className="flecha-acceso" aria-hidden="true">
              →
            </span>
          </Link>
        </section>
        <section className="modulos-vacios" aria-labelledby="modulos-titulo">
          <div>
            <p className="sobrelinea">Espacio de trabajo</p>
            <h2 id="modulos-titulo">Módulos</h2>
          </div>
          <p className="texto-secundario" role="status">
            Aún no hay módulos operativos habilitados para tu cuenta. Los módulos aparecerán aquí
            cuando su implementación, permisos y disponibilidad estén aprobados.
          </p>
        </section>
      </div>
    </MarcoAutenticado>
  );
}
