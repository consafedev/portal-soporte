import type { JSX } from 'react';
import type { Metadata } from 'next';
import { MarcoAutenticado } from '../../components/auth/auth-shell';
import { SaludoDashboard } from '../../components/dashboard/dashboard-greeting';

/** Evita prerenderizar contenido que exige comprobar la sesión vigente. */
export const dynamic = 'force-dynamic';

/** Metadatos privados de la portada autenticada del portal. */
export const metadata: Metadata = {
  title: 'Inicio · Portal de Soporte',
  description: 'Bienvenida al Portal de Soporte e-Billia.',
  robots: { index: false, follow: false },
};

/** Presenta un saludo breve dentro del área protegida. */
export default function PaginaDashboard(): JSX.Element {
  return (
    <MarcoAutenticado>
      <SaludoDashboard />
    </MarcoAutenticado>
  );
}
