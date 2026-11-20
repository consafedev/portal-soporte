import { describe, expect, it } from 'vitest';
import { ServicioPreferenciasUsuario } from '../../packages/core/src/preferences/service.js';
import type { RepositorioPreferenciasUsuario } from '../../packages/core/src/preferences/ports.js';
import type { TemaPreferenciaUsuario } from '../../packages/core/src/preferences/models.js';

const idUsuario = '018f1000-0000-7000-8000-000000000001';

/** Repositorio en memoria acotado para probar las reglas del caso de uso. */
class RepositorioPreferenciasMemoria implements RepositorioPreferenciasUsuario {
  private tema: TemaPreferenciaUsuario = 'system';
  private usuarioExiste = true;

  /** Devuelve el tema almacenado para la cuenta sintética. */
  public async obtenerTemaPreferido(): Promise<TemaPreferenciaUsuario | null> {
    if (!this.usuarioExiste) return null;
    return this.tema;
  }

  /** Persiste un tema únicamente si la cuenta de prueba todavía existe. */
  public async actualizarTemaPreferido(
    _idUsuario: string,
    tema: TemaPreferenciaUsuario,
  ): Promise<boolean> {
    if (!this.usuarioExiste) return false;
    this.tema = tema;
    return true;
  }

  /** Cambia la existencia simulada de la cuenta para probar la carrera de desactivación. */
  public cambiarExistencia(existe: boolean): void {
    this.usuarioExiste = existe;
  }
}

/** Agrupa pruebas del valor inicial y la actualización de preferencias por usuario. */
function definirPruebasServicioPreferencias(): void {
  it('usa el tema del sistema cuando la cuenta aún no eligió uno', pruebaValorPredeterminado);
  it('persiste el tema solicitado para la cuenta autenticada', pruebaPersistenciaTema);
  it('informa si la cuenta dejó de existir antes de guardar', pruebaCuentaDesaparecida);
}

/** Comprueba que una cuenta sin preferencia reciba el comportamiento del sistema. */
async function pruebaValorPredeterminado(): Promise<void> {
  const servicio = new ServicioPreferenciasUsuario(new RepositorioPreferenciasMemoria());

  await expect(servicio.obtener(idUsuario)).resolves.toEqual({ theme: 'system' });
}

/** Comprueba que el caso de uso delegue la preferencia al repositorio de la identidad dada. */
async function pruebaPersistenciaTema(): Promise<void> {
  const repositorio = new RepositorioPreferenciasMemoria();
  const servicio = new ServicioPreferenciasUsuario(repositorio);

  await expect(servicio.actualizar(idUsuario, 'dark')).resolves.toEqual({ theme: 'dark' });
  await expect(servicio.obtener(idUsuario)).resolves.toEqual({ theme: 'dark' });
}

/** Comprueba que el servicio no confirme un cambio si la cuenta desapareció. */
async function pruebaCuentaDesaparecida(): Promise<void> {
  const repositorio = new RepositorioPreferenciasMemoria();
  repositorio.cambiarExistencia(false);
  const servicio = new ServicioPreferenciasUsuario(repositorio);

  await expect(servicio.actualizar(idUsuario, 'light')).resolves.toBeNull();
}

describe('ServicioPreferenciasUsuario', definirPruebasServicioPreferencias);
