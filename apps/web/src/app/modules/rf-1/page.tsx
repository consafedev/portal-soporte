import type { JSX } from 'react';
import type { Metadata } from 'next';
import { MarcoAutenticado } from '../../../components/auth/auth-shell';
import { VistaPreviaRf1 } from '../../../components/rf-1/rf1-preview';

/** Evita prerenderizar una vista que carga catálogos y permisos de una sesión activa. */
export const dynamic = 'force-dynamic';

/** Metadatos privados de la vista de lectura RF-1. */
export const metadata: Metadata = {
  title: 'Vista previa RF-1 · Portal de Soporte',
  description: 'Valida CFDI y presenta una vista previa sin modificar bases de clientes.',
  robots: { index: false, follow: false },
};

/** Renderiza la vista RF-1 dentro del marco que confirma la sesión en el servidor. */
export default function PaginaVistaPreviaRf1(): JSX.Element {
  return (
    <MarcoAutenticado>
      <VistaPreviaRf1 />
    </MarcoAutenticado>
  );
}
