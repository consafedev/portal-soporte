import type { JSX } from 'react';
import type { Metadata } from 'next';
import { FormularioPerfil } from '../../../components/auth/password-change-form';

/** Evita prerender de una ruta que consulta identidad/sesión al cargarse. */
export const dynamic = 'force-dynamic';

/** Metadatos de actualización voluntaria de credenciales. */
export const metadata: Metadata = {
  title: 'Mi perfil · Portal de Soporte',
  description: 'Actualiza tu contraseña y solicita verificar tu correo.',
  robots: { index: false, follow: false },
};

/** Presenta cambio de contraseña y correo con reautenticación en el servidor. */
export default function PaginaPerfil(): JSX.Element {
  return <FormularioPerfil />;
}
