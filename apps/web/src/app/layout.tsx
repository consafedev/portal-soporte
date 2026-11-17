import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';
import './globals.css';

/** Metadatos neutrales de la aplicación durante el bootstrap técnico. */
export const metadata: Metadata = {
  title: 'Portal de Soporte e-Billia',
  description: 'Estructura técnica inicial del portal interno de soporte.',
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
