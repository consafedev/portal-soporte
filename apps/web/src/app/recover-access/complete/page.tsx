import type { JSX } from 'react';
import type { Metadata } from 'next';
import { FormularioCompletarEnlace } from '../../../components/auth/recovery-completion-form';

/** Evita respuestas estáticas compartidas para una ruta de tokens de un solo uso. */
export const dynamic = 'force-dynamic';

/** Metadatos que impiden referencias a URLs de activación o recuperación. */
export const metadata: Metadata = {
  title: 'Completar acceso · Portal de Soporte',
  description: 'Completa el enlace de autenticación de un solo uso.',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/** Renderiza una pantalla que consume el token del fragmento en el navegador. */
export default function PaginaCompletarEnlace(): JSX.Element {
  return <FormularioCompletarEnlace />;
}
