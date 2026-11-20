import type { JSX } from 'react';
import type { Metadata } from 'next';
import { AvisoCorreoNoDisponible } from '../../../components/auth/email-unavailable-notice';

/** Evita respuestas estáticas compartidas para una ruta de tokens de un solo uso. */
export const dynamic = 'force-dynamic';

/** Metadatos que impiden referencias a URLs de activación o recuperación. */
export const metadata: Metadata = {
  title: 'Completar acceso · Portal de Soporte',
  description: 'Los enlaces por correo están deshabilitados; contacta con administración.',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/** Informa que los enlaces de autenticación por correo no se procesan mientras SMTP no exista. */
export default function PaginaCompletarEnlace(): JSX.Element {
  return <AvisoCorreoNoDisponible />;
}
