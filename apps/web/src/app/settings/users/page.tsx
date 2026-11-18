import type { JSX } from 'react';
import type { Metadata } from 'next';
import { AdministracionUsuarios } from '../../../components/auth/user-management';
import { MarcoAutenticado } from '../../../components/auth/auth-shell';

/** Evita prerender de una página que consulta usuarios bajo el rol vigente. */
export const dynamic = 'force-dynamic';

/** Metadatos de la pantalla administrativa de cuentas individuales. */
export const metadata: Metadata = {
  title: 'Usuarios · Portal de Soporte',
  description: 'Administra invitaciones, roles, estado y sesiones de usuarios.',
  robots: { index: false, follow: false },
};

/** Presenta controles administrativos mínimos sin agregar un dashboard. */
export default function PaginaAdministracionUsuarios(): JSX.Element {
  return (
    <MarcoAutenticado rolRequerido="ADMIN">
      <AdministracionUsuarios />
    </MarcoAutenticado>
  );
}
