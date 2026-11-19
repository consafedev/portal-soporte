import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';
import './globals.css';

/** Metadatos del portal interno; evita indexación de páginas con datos de cuenta. */
export const metadata: Metadata = {
  title: 'Portal de Soporte e-Billia',
  description: 'Acceso seguro al Portal de Soporte e-Billia.',
  robots: { index: false, follow: false },
};

/**
 * Proporciona el documento HTML en español para las rutas de la aplicación web.
 *
 * @param props - Contenido de la ruta que Next.js renderiza dentro del documento.
 * @returns El documento raíz con idioma declarado y contenido semántico.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): JSX.Element {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
