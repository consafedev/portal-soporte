import { and, eq } from 'drizzle-orm';
import type { RepositorioPreferenciasUsuario } from '../../../../packages/core/src/preferences/ports.js';
import type { TemaPreferenciaUsuario } from '../../../../packages/core/src/preferences/models.js';
import type { BaseDatosAuth } from '../db/client.js';
import { users } from '../db/schema.js';

/** Implementa preferencias personales con consultas limitadas a la cuenta activa. */
export class RepositorioPreferenciasUsuarioPostgres implements RepositorioPreferenciasUsuario {
  /**
   * Construye el adaptador con el cliente PostgreSQL del portal.
   *
   * @param database - Cliente con rol de runtime y esquema del portal configurado.
   */
  public constructor(private readonly database: BaseDatosAuth) {}

  /**
   * Lee el tema solo de la cuenta activa identificada por el contexto del servidor.
   *
   * @param idUsuario - Identificador que entrega el caso de uso autenticado.
   * @returns Tema persistido o `null` si no existe una cuenta activa.
   * @throws Propaga los fallos del cliente SQL sin incluir consultas ni parámetros sensibles.
   */
  public async obtenerTemaPreferido(idUsuario: string): Promise<TemaPreferenciaUsuario | null> {
    const [cuenta] = await this.database
      .select({ theme: users.themePreference })
      .from(users)
      .where(and(eq(users.id, idUsuario), eq(users.status, 'ACTIVE')))
      .limit(1);

    return cuenta?.theme ?? null;
  }

  /**
   * Cambia el tema solo si la cuenta indicada sigue activa al ejecutar el UPDATE.
   *
   * @param idUsuario - Identificador que entrega el caso de uso autenticado.
   * @param tema - Tema de la lista permitida por el dominio.
   * @returns `true` cuando se modificó una cuenta activa.
   * @throws Propaga los fallos del cliente SQL sin incluir consultas ni parámetros sensibles.
   * @effects Ejecuta un único UPDATE parametrizado y no altera otras columnas de usuario.
   */
  public async actualizarTemaPreferido(
    idUsuario: string,
    tema: TemaPreferenciaUsuario,
  ): Promise<boolean> {
    const actualizadas = await this.database
      .update(users)
      .set({ themePreference: tema })
      .where(and(eq(users.id, idUsuario), eq(users.status, 'ACTIVE')))
      .returning({ id: users.id });

    return actualizadas.length === 1;
  }
}
