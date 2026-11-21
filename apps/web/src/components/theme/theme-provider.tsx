'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import type { TemaPreferenciaUsuarioContrato } from '@portal-soporte/contracts/user-preferences';
import { actualizarPreferenciasUsuario, obtenerPreferenciasUsuario } from '../../lib/auth-api';

const CLAVE_TEMA_LOCAL = 'portal-soporte-theme';
const EVENTO_TEMA_LOCAL_ACTUALIZADO = 'portal-soporte:theme-local-updated';

/** Estado compartido de apariencia que sincroniza perfil, navegador y API. */
export interface ContextoTemaPortal {
  /** Tema confirmado más recientemente por la cuenta o la preferencia local. */
  readonly theme: TemaPreferenciaUsuarioContrato;
  /** Indica que el API está resolviendo el tema persistido para la ruta actual. */
  readonly loading: boolean;
  /** Cambia tema localmente en rutas públicas o lo persiste en cuenta mediante API autenticada. */
  guardarTema(tema: TemaPreferenciaUsuarioContrato): Promise<void>;
}

const ContextoTema = createContext<ContextoTemaPortal | null>(null);

/**
 * Sincroniza las preferencias de la cuenta con el tema visible del documento.
 *
 * @param propiedades - Contenido de la aplicación que hereda el tema seleccionado.
 * @param propiedades.children - Rutas Next.js renderizadas dentro del proveedor.
 * @returns Proveedor de tema que conserva un fallback local para la pantalla de login.
 */
export function ProveedorTemaPortal({ children }: Readonly<{ children: ReactNode }>): JSX.Element {
  const rutaActual = usePathname();
  const esRutaPublica = rutaActual === '/login' || rutaActual.startsWith('/recover-access');
  const themeLocal = useSyncExternalStore(
    suscribirCambiosTemaLocal,
    obtenerTemaLocal,
    obtenerTemaInicialServidor,
  );
  const [themeCuenta, setThemeCuenta] = useState<TemaPreferenciaUsuarioContrato | null>(null);
  const [loadingCuenta, setLoading] = useState(true);
  const theme = esRutaPublica ? themeLocal : (themeCuenta ?? themeLocal);
  const loading = !esRutaPublica && loadingCuenta;

  /**
   * Consulta la preferencia al entrar al área autenticada y descarta respuestas obsoletas.
   *
   * @returns Limpieza React que invalida la respuesta si cambia la ruta o se desmonta.
   */
  const sincronizarPreferenciaCuenta = useCallback((): (() => void) | undefined => {
    if (esRutaPublica) return undefined;

    let vigente = true;

    /**
     * Reemplaza el fallback local únicamente con un tema que validó la API.
     *
     * @returns Promesa que termina al actualizar estado o descartar una respuesta obsoleta.
     * @effects Lee la preferencia autenticada y actualiza el fallback local no sensible.
     */
    async function cargarPreferenciaCuenta(): Promise<void> {
      setLoading(true);
      try {
        const preferencias = await obtenerPreferenciasUsuario();
        if (!vigente) return;
        setThemeCuenta(preferencias.theme);
        guardarTemaLocal(preferencias.theme);
      } catch {
        // La sesión pública conserva el valor local; los fallos se muestran solo al guardar.
        if (vigente) setThemeCuenta(null);
      } finally {
        if (vigente) setLoading(false);
      }
    }

    void cargarPreferenciaCuenta();

    return () => {
      vigente = false;
    };
  }, [esRutaPublica]);

  useEffect(sincronizarPreferenciaCuenta, [sincronizarPreferenciaCuenta]);

  /**
   * Aplica el atributo que selecciona tokens CSS sin depender del estado del navegador.
   *
   * @returns Nada; modifica el atributo `data-theme` del documento.
   * @effects Actualiza el tema raíz para que CSS presente la preferencia confirmada.
   */
  const aplicarTemaDocumento = useCallback((): void => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  useEffect(aplicarTemaDocumento, [aplicarTemaDocumento]);

  /**
   * Aplica el tema de inmediato y revierte el cambio visible si el API no lo confirma.
   *
   * @param tema - Preferencia que el usuario seleccionó.
   * @returns Promesa que termina cuando el fallback local o la API confirma la preferencia.
   * @throws El error de actualización del API tras restaurar el tema anterior.
   * @effects Actualiza estado React, almacenamiento local y, en sesión autenticada, el API.
   */
  const guardarTema = useCallback(
    async (tema: TemaPreferenciaUsuarioContrato): Promise<void> => {
      if (esRutaPublica) {
        guardarTemaLocal(tema);
        return;
      }

      const temaAnterior = themeCuenta ?? themeLocal;
      setThemeCuenta(tema);
      guardarTemaLocal(tema);
      try {
        const respuesta = await actualizarPreferenciasUsuario({ theme: tema });
        setThemeCuenta(respuesta.theme);
        guardarTemaLocal(respuesta.theme);
      } catch (error: unknown) {
        setThemeCuenta(temaAnterior);
        guardarTemaLocal(temaAnterior);
        throw error;
      }
    },
    [esRutaPublica, themeCuenta, themeLocal],
  );

  const valor = useMemo<ContextoTemaPortal>(
    () => ({ theme, loading, guardarTema }),
    [theme, loading, guardarTema],
  );

  return <ContextoTema.Provider value={valor}>{children}</ContextoTema.Provider>;
}

/** Recupera el contexto de apariencia solo dentro del proveedor de la aplicación. */
export function useTemaPortal(): ContextoTemaPortal {
  const contexto = useContext(ContextoTema);
  if (contexto === null) {
    throw new Error('useTemaPortal requiere ProveedorTemaPortal.');
  }

  return contexto;
}

/**
 * Acepta solamente los valores cerrados que define el contrato visual.
 *
 * @returns Preferencia almacenada válida o `null` ante ausencia, valor inválido o acceso denegado.
 * @effects Lee la clave local de preferencia sin propagar errores del navegador.
 */
function leerTemaLocal(): TemaPreferenciaUsuarioContrato | null {
  try {
    const valor: string | null = window.localStorage.getItem(CLAVE_TEMA_LOCAL);
    return valor === 'system' || valor === 'light' || valor === 'dark' ? valor : null;
  } catch {
    return null;
  }
}

/**
 * Suscribe componentes a cambios locales de tema en esta pestaña y en otras.
 *
 * @param actualizar - Callback que vuelve a leer el valor de preferencia.
 * @returns Callback que retira ambos listeners al desmontar el componente.
 */
function suscribirCambiosTemaLocal(actualizar: () => void): () => void {
  window.addEventListener('storage', actualizar);
  window.addEventListener(EVENTO_TEMA_LOCAL_ACTUALIZADO, actualizar);
  return (): void => {
    window.removeEventListener('storage', actualizar);
    window.removeEventListener(EVENTO_TEMA_LOCAL_ACTUALIZADO, actualizar);
  };
}

/**
 * Devuelve el tema local válido o el modo de sistema cuando no existe preferencia previa.
 *
 * @returns Preferencia válida; usa `system` como valor predeterminado.
 */
function obtenerTemaLocal(): TemaPreferenciaUsuarioContrato {
  return leerTemaLocal() ?? 'system';
}

/**
 * Mantiene el primer render del servidor y la hidratación en el tema de sistema.
 *
 * @returns Tema neutro usado para una hidratación consistente.
 */
function obtenerTemaInicialServidor(): TemaPreferenciaUsuarioContrato {
  return 'system';
}

/**
 * Conserva una preferencia visual no sensible para aplicarla a la pantalla pública de login.
 *
 * @param tema - Tema cerrado permitido por el contrato.
 * @returns Nada; ignora errores de almacenamiento porque el fallback es opcional.
 * @effects Escribe una preferencia local y notifica a componentes suscritos.
 */
function guardarTemaLocal(tema: TemaPreferenciaUsuarioContrato): void {
  try {
    window.localStorage.setItem(CLAVE_TEMA_LOCAL, tema);
    window.dispatchEvent(new Event(EVENTO_TEMA_LOCAL_ACTUALIZADO));
  } catch {
    // La preferencia de cuenta ya quedó guardada; localStorage es solo un fallback opcional.
  }
}
