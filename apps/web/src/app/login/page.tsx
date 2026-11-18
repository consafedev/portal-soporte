import type { JSX } from 'react';
import type { Metadata } from 'next';
import { FormularioInicioSesion } from '../../components/auth/login-form';

/** Metadatos de la pantalla de acceso interno. */
export const metadata: Metadata = {
  title: 'Iniciar sesión · Portal de Soporte',
  description: 'Acceso seguro al Portal de Soporte e-Billia.',
};

/** Presenta el formulario de login aprobado sin cargar datos de cuenta en el servidor. */
export default function PaginaInicioSesion(): JSX.Element {
  return <FormularioInicioSesion />;
}
