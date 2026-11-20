'use client';

import { useState, useSyncExternalStore, type JSX } from 'react';
import { useTemaPortal } from './theme-provider';

/**
 * Alterna el tema claro y oscuro con iconos, estado accesible y persistencia existente.
 *
 * @returns Control global de tema con estado anunciable para tecnologías de asistencia.
 * @throws Error si no está montado dentro de `ProveedorTemaPortal`.
 * @effects Persiste el tema mediante el contexto y comunica fallos en una región accesible.
 */
export function BotonAlternarTema(): JSX.Element {
  const { theme, loading, guardarTema } = useTemaPortal();
  const temaSistema = useSyncExternalStore(
    suscribirCambioTemaSistema,
    obtenerTemaSistema,
    obtenerTemaSistemaServidor,
  );
  const temaActual = theme === 'system' ? temaSistema : theme;
  const temaDestino = temaActual === 'dark' ? 'light' : 'dark';
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  /**
   * Persiste el destino y anuncia un error accesible si la actualización no se confirma.
   *
   * @returns Promesa resuelta luego de guardar o manejar el error de la preferencia.
   * @effects Alterna estado de espera y puede actualizar el contexto de tema.
   */
  async function alternarTema(): Promise<void> {
    if (loading || guardando) return;

    setGuardando(true);
    setError('');
    try {
      await guardarTema(temaDestino);
    } catch {
      setError('No se guardó el tema. Tu preferencia anterior sigue activa.');
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Atiende el clic sin dejar una promesa rechazada sin manejar.
   *
   * @returns Nada; delega el cambio al manejador asíncrono con errores controlados.
   */
  function manejarClic(): void {
    void alternarTema();
  }

  const nombreTemaDestino = temaDestino === 'dark' ? 'oscuro' : 'claro';

  return (
    <div className="control-tema-global">
      <button
        className="boton-cambiar-tema"
        type="button"
        data-theme={temaActual}
        aria-label={`Cambiar a tema ${nombreTemaDestino}`}
        aria-pressed={temaActual === 'dark'}
        aria-busy={guardando}
        title={`Cambiar a tema ${nombreTemaDestino}`}
        disabled={loading || guardando}
        onClick={manejarClic}
      >
        <svg
          className="icono-tema icono-tema-sol"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2m10-10h-2M4 12H2m17.07 7.07-1.42-1.42M6.35 6.35 4.93 4.93m14.14 0-1.42 1.42M6.35 17.65l-1.42 1.42" />
        </svg>
        <svg
          className="icono-tema icono-tema-luna"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M20.1 15.2A8.4 8.4 0 0 1 8.8 3.9 8.8 8.8 0 1 0 20.1 15.2Z" />
        </svg>
      </button>
      <span className="texto-solo-lector" aria-live="polite" aria-atomic="true">
        {error}
      </span>
    </div>
  );
}

/**
 * Suscribe el botón a cambios del esquema de color del dispositivo.
 *
 * @param actualizar - Función React que vuelve a leer el esquema del sistema.
 * @returns Función para retirar el listener al desmontar el componente.
 */
function suscribirCambioTemaSistema(actualizar: () => void): () => void {
  const consulta = window.matchMedia('(prefers-color-scheme: dark)');
  consulta.addEventListener('change', actualizar);
  return (): void => consulta.removeEventListener('change', actualizar);
}

/**
 * Devuelve el tema preferido del dispositivo.
 *
 * @returns `dark` o `light` según la media query del navegador.
 */
function obtenerTemaSistema(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Mantiene un valor determinista durante SSR e hidratación inicial.
 *
 * @returns Tema claro como fallback hasta consultar la preferencia del dispositivo.
 */
function obtenerTemaSistemaServidor(): 'light' {
  return 'light';
}
