import type { JSX } from 'react';
import type { Metadata } from 'next';
import { FormularioSolicitudRecuperacion } from '../../components/auth/recovery-request-form';

/** Metadatos de solicitud pública sin datos asociados a una identidad. */
export const metadata: Metadata = {
  title: 'Recuperar acceso · Portal de Soporte',
  description: 'Solicita instrucciones seguras para recuperar el acceso.',
};

/** Presenta recuperación con una respuesta que no revela cuentas registradas. */
export default function PaginaRecuperacion(): JSX.Element {
  return <FormularioSolicitudRecuperacion />;
}
