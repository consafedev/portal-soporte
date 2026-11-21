import type { JSX } from 'react';
import type { Metadata } from 'next';
import { FormularioPerfil } from '../../../components/auth/password-change-form';

/** Evita prerender de una ruta que consulta identidad/sesión al cargarse. */
export const dynamic = 'force-dynamic';

/** Metadatos de preferencias personales y actualización voluntaria de credenciales. */
export const metadata: Metadata = {
  title: 'Mi perfil · Portal de Soporte',
  description: 'Configura la apariencia del portal y administra tus credenciales.',
  robots: { index: false, follow: false },
};

/** Presenta preferencias personales y habilita correo solo si el runtime lo declara disponible. */
export default function PaginaPerfil(): JSX.Element {
  const correoHabilitado = process.env['PORTAL_EMAIL_DELIVERY_ENABLED'] === 'true';

  return <FormularioPerfil correoHabilitado={correoHabilitado} />;
}
