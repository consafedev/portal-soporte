'use client';

import type { JSX } from 'react';
import { useUsuarioAutenticado } from '../auth/auth-user-context';

/**
 * Presenta el saludo sencillo con el nombre visible de la sesión confirmada.
 *
 * @returns Encabezado breve sin métricas, gráficas ni información operativa adicional.
 * @throws Error cuando el dashboard se monta fuera del marco autenticado.
 */
export function SaludoDashboard(): JSX.Element {
  const usuario = useUsuarioAutenticado();

  return (
    <div className="pagina-contenido pagina-dashboard">
      <header className="encabezado-dashboard">
        <h1>Hola, {usuario.displayName}</h1>
        <p className="texto-secundario">Bienvenido al Portal de Soporte e-Billia.</p>
      </header>
    </div>
  );
}
