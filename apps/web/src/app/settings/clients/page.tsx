import type { JSX } from 'react';
import type { Metadata } from 'next';
import { MarcoAutenticado } from '../../../components/auth/auth-shell';
import { AdministracionClientes } from '../../../components/clients/client-management';

/** Evita prerenderizar una pantalla que consulta datos administrativos autenticados. */
export const dynamic = 'force-dynamic';

/** Metadatos privados de la pantalla de clientes. */
export const metadata: Metadata = {
  title: 'Clientes · Portal de Soporte',
  description: 'Administra clientes y ambientes SAP del Portal de Soporte.',
  robots: { index: false, follow: false },
};

/** Presenta el catálogo de clientes dentro del marco autenticado y restringido a ADMIN. */
export default function PaginaAdministracionClientes(): JSX.Element {
  return (
    <MarcoAutenticado rolRequerido="ADMIN">
      <AdministracionClientes />
    </MarcoAutenticado>
  );
}
