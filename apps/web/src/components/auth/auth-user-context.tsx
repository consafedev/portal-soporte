'use client';

import { createContext, useContext, type JSX, type ReactNode } from 'react';
import type { RespuestaUsuarioPublico } from '@portal-soporte/contracts/auth';

const ContextoUsuarioAutenticado = createContext<RespuestaUsuarioPublico | null>(null);

/** Propiedades del proveedor con la identidad ya validada por el servidor. */
export interface PropiedadesProveedorUsuarioAutenticado {
  /** Usuario público de la sesión; nunca incluye credenciales ni secretos. */
  readonly usuario: RespuestaUsuarioPublico;
  /** Contenido protegido que puede leer la identidad de la sesión actual. */
  readonly children: ReactNode;
}

/**
 * Proporciona la identidad que el marco ya validó a las pantallas protegidas.
 *
 * @param propiedades - Usuario público validado y contenido protegido.
 * @param propiedades.usuario - Identidad que verificó el marco autenticado.
 * @param propiedades.children - Componentes que requieren leer el usuario actual.
 * @returns Proveedor React sin exponer datos de autenticación sensibles.
 */
export function ProveedorUsuarioAutenticado({
  usuario,
  children,
}: Readonly<PropiedadesProveedorUsuarioAutenticado>): JSX.Element {
  return (
    <ContextoUsuarioAutenticado.Provider value={usuario}>
      {children}
    </ContextoUsuarioAutenticado.Provider>
  );
}

/**
 * Devuelve la identidad autenticada dentro del marco protegido.
 *
 * @returns Usuario público validado por el marco de la ruta.
 * @throws Error cuando el hook se usa fuera del proveedor autenticado.
 */
export function useUsuarioAutenticado(): RespuestaUsuarioPublico {
  const usuario = useContext(ContextoUsuarioAutenticado);
  if (usuario === null) {
    throw new Error('useUsuarioAutenticado requiere el marco autenticado.');
  }

  return usuario;
}
