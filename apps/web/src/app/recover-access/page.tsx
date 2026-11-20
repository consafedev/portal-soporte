import type { JSX } from 'react';
import type { Metadata } from 'next';
import { AvisoCorreoNoDisponible } from '../../components/auth/email-unavailable-notice';

/** Metadatos de solicitud pública sin datos asociados a una identidad. */
export const metadata: Metadata = {
  title: 'Recuperar acceso · Portal de Soporte',
  description: 'La recuperación por correo está deshabilitada; contacta con administración.',
};

/** Informa que la recuperación por correo requiere un servicio SMTP no configurado. */
export default function PaginaRecuperacion(): JSX.Element {
  return <AvisoCorreoNoDisponible />;
}
