'use client';

import { useState, type ChangeEvent, type FormEvent, type JSX } from 'react';
import type { TemaPreferenciaUsuarioContrato } from '@portal-soporte/contracts/user-preferences';
import { ErrorApiAuth } from '../../lib/auth-api';
import { useTemaPortal } from './theme-provider';

const OPCIONES_TEMA: readonly {
  readonly valor: TemaPreferenciaUsuarioContrato;
  readonly titulo: string;
  readonly detalle: string;
}[] = [
  {
    valor: 'system',
    titulo: 'Seguir dispositivo',
    detalle: 'Usa el tema configurado en tu sistema.',
  },
  { valor: 'light', titulo: 'Claro', detalle: 'Mantiene una superficie clara.' },
  { valor: 'dark', titulo: 'Oscuro', detalle: 'Mantiene una superficie oscura.' },
];

/**
 * Presenta una selección accesible de tema con persistencia en el perfil personal.
 *
 * @returns Formulario agrupado con selección por teclado y estados de guardado/error.
 * @throws Error si se renderiza fuera de `ProveedorTemaPortal`.
 * @effects Actualiza la preferencia autenticada mediante el contexto que aplica sesión y CSRF.
 */
export function FormularioPreferenciaTema(): JSX.Element {
  const { theme, loading, guardarTema } = useTemaPortal();
  const [seleccionManual, setSeleccionManual] = useState<TemaPreferenciaUsuarioContrato | null>(
    null,
  );
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seleccionado = seleccionManual ?? theme;

  /**
   * Actualiza la opción elegida solo si corresponde a un valor del contrato.
   *
   * @param evento - Cambio generado por una opción radio del formulario.
   * @returns Nada; conserva la selección en estado local hasta confirmar el guardado.
   */
  function manejarCambio(evento: ChangeEvent<HTMLInputElement>): void {
    const valor = evento.currentTarget.value;
    if (valor === 'system' || valor === 'light' || valor === 'dark') {
      setSeleccionManual(valor);
      setMensaje(null);
      setError(null);
    }
  }

  /**
   * Persiste el tema y confirma el cambio solo después de una respuesta válida del API.
   *
   * @param evento - Envío del formulario de apariencia.
   * @returns Promesa que termina después de actualizar el estado de resultado accesible.
   * @effects Previene el envío HTML y delega el PATCH autenticado al proveedor.
   */
  async function guardar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setGuardando(true);
    setMensaje(null);
    setError(null);
    try {
      await guardarTema(seleccionado);
      setSeleccionManual(null);
      setMensaje('Preferencia guardada.');
    } catch (rechazo: unknown) {
      setError(
        rechazo instanceof ErrorApiAuth
          ? rechazo.message
          : 'No fue posible guardar tu preferencia. Inténtalo de nuevo.',
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="panel-contenido panel-preferencias" aria-labelledby="tema-titulo">
      <h2 id="tema-titulo">Apariencia</h2>
      <p className="texto-secundario">Elige cómo quieres ver el Portal de Soporte.</p>
      <form className="formulario formulario-preferencias" onSubmit={guardar}>
        <fieldset className="opciones-tema" disabled={loading || guardando}>
          <legend>Tema del portal</legend>
          {OPCIONES_TEMA.map(({ valor, titulo, detalle }) => (
            <label className="opcion-tema" key={valor}>
              <input
                type="radio"
                name="tema-portal"
                value={valor}
                checked={seleccionado === valor}
                onChange={manejarCambio}
              />
              <span>
                <strong>{titulo}</strong>
                <span className="texto-secundario">{detalle}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <button
          className="boton-primario"
          type="submit"
          disabled={loading || guardando || seleccionado === theme}
          aria-busy={guardando}
        >
          {guardando ? 'Guardando…' : 'Guardar apariencia'}
        </button>
      </form>
      {error !== null ? (
        <p className="aviso-error" role="alert">
          {error}
        </p>
      ) : null}
      {mensaje !== null ? (
        <p className="aviso-exito" role="status">
          {mensaje}
        </p>
      ) : null}
    </section>
  );
}
