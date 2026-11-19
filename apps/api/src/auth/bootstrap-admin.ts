import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { recoveryRequestSchema } from '../../../../packages/contracts/src/auth.js';
import type { RepositorioBootstrapAdmin } from '../../../../packages/core/src/auth/admin-ports.js';
import { ErrorRepositorioUsuariosAdmin } from '../../../../packages/core/src/auth/admin-ports.js';
import type { RespuestaUsuarioAdmin } from '../../../../packages/core/src/auth/models.js';
import {
  esNombreUsuarioValido,
  normalizarCorreo,
  normalizarUsuario,
  validarNuevaContrasena,
} from '../../../../packages/core/src/auth/policies.js';
import type { RelojAuth } from '../../../../packages/core/src/auth/ports.js';
import { Argon2PasswordHasher } from './argon2-password-hasher.js';
import { ErrorUsuarioAdmin } from './admin-user-service.js';

/** Entrada no secreta solicitada por el comando local de bootstrap. */
export interface EntradaAdministradorInicial {
  /** Username presentado para la cuenta inicial. */
  readonly username: string;
  /** Correo sin verificar al concluir el bootstrap. */
  readonly email: string;
  /** Nombre visible del responsable administrador. */
  readonly displayName: string;
}

/** Terminal que permite comprobar TTY y recoger una contraseña sin eco. */
export interface TerminalBootstrapAdmin {
  /** Indica que existe un terminal interactivo capaz de ocultar la entrada. */
  esInteractiva(): boolean;
  /** Lee la contraseña sin imprimir sus caracteres, almacenando el valor solo en memoria. */
  leerContrasenaSinEco(): Promise<string>;
}

/** Implementa lectura de contraseña con modo raw para impedir su eco en terminal. */
export class TerminalContrasenaSinEco implements TerminalBootstrapAdmin {
  /** Construye el lector con las streams TTY del proceso actual o con streams sintéticas. */
  public constructor(
    private readonly entrada: NodeJS.ReadStream = process.stdin,
    private readonly salida: NodeJS.WriteStream = process.stdout,
  ) {}

  /** Solo declara interacción cuando la entrada admite raw mode real. */
  public esInteractiva(): boolean {
    return this.entrada.isTTY === true && typeof this.entrada.setRawMode === 'function';
  }

  /** Lee una línea secreta y restaura el modo del terminal antes de resolver o rechazar. */
  public async leerContrasenaSinEco(): Promise<string> {
    if (!this.esInteractiva()) {
      throw new ErrorUsuarioAdmin('BOOTSTRAP_REQUIRES_TTY', 400);
    }

    return new Promise<string>((resolver, rechazar) => {
      let secreto = '';
      let restaurado = false;
      /** Elimina listeners y restaura entrada/salida solo una vez por lectura. */
      const restaurar = (): void => {
        if (restaurado) {
          return;
        }
        restaurado = true;
        this.entrada.removeListener('data', leerCaracteres);
        this.entrada.removeListener('error', manejarError);
        this.entrada.setRawMode(false);
        this.entrada.pause();
        this.salida.write('\n');
      };
      /** Interpreta caracteres sin eco, incluyendo Enter, cancelación y retroceso. */
      const leerCaracteres = (fragmento: Buffer | string): void => {
        for (const caracter of String(fragmento)) {
          if (caracter === '\r' || caracter === '\n') {
            restaurar();
            resolver(secreto);
            return;
          }
          if (caracter === '\u0003') {
            restaurar();
            rechazar(new ErrorUsuarioAdmin('BOOTSTRAP_CANCELLED', 400));
            return;
          }
          if (caracter === '\u0008' || caracter === '\u007f') {
            secreto = Array.from(secreto).slice(0, -1).join('');
            continue;
          }
          secreto += caracter;
        }
      };
      /** Maneja errores de lectura después de restaurar raw mode y los listeners. */
      const manejarError = (error: Error): void => {
        restaurar();
        rechazar(error);
      };

      try {
        this.entrada.setRawMode(true);
        this.entrada.setEncoding('utf8');
        this.salida.write('Contraseña inicial (entrada oculta): ');
        this.entrada.on('data', leerCaracteres);
        this.entrada.once('error', manejarError);
        this.entrada.resume();
      } catch (error) {
        restaurar();
        rechazar(error);
      }
    });
  }
}

/** Valida los campos públicos, recoge secreto en TTY, hashea y serializa el primer ADMIN. */
export async function crearAdministradorInicial(
  entrada: EntradaAdministradorInicial,
  terminal: TerminalBootstrapAdmin,
  repositorio: RepositorioBootstrapAdmin,
  reloj: RelojAuth = { ahora: () => new Date() },
): Promise<RespuestaUsuarioAdmin> {
  if (!terminal.esInteractiva()) {
    throw new ErrorUsuarioAdmin('BOOTSTRAP_REQUIRES_TTY', 400);
  }

  const usernameRecibido = entrada.username.trim();
  const username = normalizarUsuario(usernameRecibido);
  const email = normalizarCorreo(entrada.email);
  const displayName = entrada.displayName.trim();
  if (!esNombreUsuarioValido(usernameRecibido)) {
    throw new ErrorUsuarioAdmin('INVALID_USERNAME', 400);
  }
  if (!Value.Check(recoveryRequestSchema, { email })) {
    throw new ErrorUsuarioAdmin('INVALID_EMAIL', 400);
  }
  if (displayName.length === 0 || Array.from(displayName).length > 120) {
    throw new ErrorUsuarioAdmin('INVALID_DISPLAY_NAME', 400);
  }

  const contrasena = await terminal.leerContrasenaSinEco();
  const confirmacion = await terminal.leerContrasenaSinEco();
  if (contrasena !== confirmacion) {
    throw new ErrorUsuarioAdmin('BOOTSTRAP_PASSWORD_MISMATCH', 400);
  }
  const validacion = validarNuevaContrasena(contrasena);
  if (!validacion.valida) {
    throw new ErrorUsuarioAdmin(validacion.codigo, 400);
  }

  const ahora = reloj.ahora();
  const id = randomUUID();
  const entradaPersistida = {
    id,
    username,
    usernameNormalized: username,
    displayName,
    email,
    emailNormalized: email,
    emailVerifiedAt: null,
    passwordHash: await new Argon2PasswordHasher().hash(contrasena),
    role: 'ADMIN' as const,
    status: 'ACTIVE' as const,
    createdAt: ahora,
    updatedAt: ahora,
  };

  try {
    return await repositorio.crearAdministradorInicial(entradaPersistida, {
      actorUserId: null,
      action: 'AUTH_BOOTSTRAP_ADMIN',
      targetUserId: id,
      outcome: 'SUCCESS',
      metadata: {},
      createdAt: ahora,
    });
  } catch (error) {
    if (error instanceof ErrorRepositorioUsuariosAdmin) {
      const statusCode = error.code === 'AUTH_INVARIANT_UNAVAILABLE' ? 503 : 409;
      throw new ErrorUsuarioAdmin(error.code, statusCode);
    }
    throw error;
  }
}
