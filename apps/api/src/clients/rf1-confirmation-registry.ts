import { createHash, randomBytes } from 'node:crypto';

/** Contexto de negocio al que se vincula una confirmación de inserción RF-1. */
export interface ContextoConfirmacionRf1 {
  /** Identificador del usuario autenticado que revisó la vista previa. */
  readonly actorUserId: string;
  /** Cliente al que pertenecen la factura y el perfil autorizado. */
  readonly clientId: string;
  /** Perfil MySQL elegido en la vista previa. */
  readonly profileId: string;
  /** Huella del conjunto normalizado de facturas aprobado en la vista previa. */
  readonly digest: string;
}

/** Entrada temporal almacenada por hash para una confirmación RF-1 de un solo uso. */
interface ConfirmacionRegistrada {
  /** Identidad, destino y digest que deben coincidir al consumir el token. */
  readonly contexto: ContextoConfirmacionRf1;
  /** Vencimiento absoluto medido con el reloj de la operación. */
  readonly venceEn: number;
}

const DURACION_CONFIRMACION_MS = 2 * 60 * 1000;
const MAXIMO_CONFIRMACIONES = 1000;

/**
 * Mantiene confirmaciones breves y de un solo uso sin conservar XML ni tokens en claro.
 * @effects Al reiniciar el proceso se invalidan todas las confirmaciones pendientes.
 */
export class RegistroConfirmacionesRf1 {
  /** Índice por hash; nunca conserva el token opaco en claro. */
  private readonly confirmaciones = new Map<string, ConfirmacionRegistrada>();

  /**
   * Crea un registro limitado para un proceso API.
   * @param duracionMs Vida máxima de cada confirmación en milisegundos.
   * @param capacidad Número máximo de confirmaciones pendientes.
   * @throws Error si la duración o la capacidad no son enteros positivos.
   */
  public constructor(
    private readonly duracionMs = DURACION_CONFIRMACION_MS,
    private readonly capacidad = MAXIMO_CONFIRMACIONES,
  ) {
    if (!Number.isSafeInteger(duracionMs) || duracionMs < 1) {
      throw new Error('La duración de confirmación debe ser un entero positivo.');
    }
    if (!Number.isSafeInteger(capacidad) || capacidad < 1) {
      throw new Error('La capacidad de confirmaciones debe ser un entero positivo.');
    }
  }

  /**
   * Emite un token aleatorio después de retirar entradas vencidas.
   * @param contexto Identidad y contenido autorizado por la vista previa.
   * @param ahora Instante de referencia inyectable para pruebas deterministas.
   * @returns Token opaco de 256 bits o null si el registro alcanzó su límite.
   * @effects Solo almacena el hash del token y una copia inmutable del contexto.
   */
  public emitir(contexto: ContextoConfirmacionRf1, ahora = new Date()): string | null {
    this.eliminarVencidas(ahora.getTime());
    if (this.confirmaciones.size >= this.capacidad) {
      return null;
    }

    const token = randomBytes(32).toString('base64url');
    const huella = this.calcularHuella(token);
    this.confirmaciones.set(huella, {
      contexto: Object.freeze({ ...contexto }),
      venceEn: ahora.getTime() + this.duracionMs,
    });
    return token;
  }

  /**
   * Consume la confirmación si token, actor y contenido coinciden y no ha vencido.
   * @param token Valor opaco recibido por el cliente.
   * @param contexto Contexto que el servidor vuelve a calcular para esta solicitud.
   * @param ahora Instante de referencia inyectable para pruebas deterministas.
   * @returns `true` solo una vez para el mismo token y contexto.
   * @effects Un token válido se elimina antes de devolver `true`.
   */
  public consumir(token: string, contexto: ContextoConfirmacionRf1, ahora = new Date()): boolean {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      return false;
    }

    const huella = this.calcularHuella(token);
    const registro = this.confirmaciones.get(huella);
    if (registro === undefined) {
      return false;
    }
    if (registro.venceEn <= ahora.getTime()) {
      this.confirmaciones.delete(huella);
      return false;
    }
    if (!coincideContexto(registro.contexto, contexto)) {
      return false;
    }

    this.confirmaciones.delete(huella);
    return true;
  }

  /**
   * Retira confirmaciones vencidas antes de reservar capacidad para nuevos tokens.
   * @param ahora Instante epoch en milisegundos usado para decidir el vencimiento.
   * @returns Nada; actualiza el mapa interno del registro.
   * @effects Elimina únicamente entradas con vencimiento igual o anterior al instante dado.
   */
  private eliminarVencidas(ahora: number): void {
    for (const [huella, registro] of this.confirmaciones) {
      if (registro.venceEn <= ahora) {
        this.confirmaciones.delete(huella);
      }
    }
  }

  /**
   * Calcula la clave de búsqueda del token sin almacenar su valor original.
   * @param token Token opaco temporal emitido al operador autenticado.
   * @returns Digest hexadecimal SHA-256 usado como clave interna del mapa.
   * @effects No registra ni transmite el token en claro.
   */
  private calcularHuella(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}

/**
 * Compara identidad, cliente, perfil y digest de una confirmación.
 * @param original Contexto inmutable registrado cuando se emitió el token.
 * @param recibido Contexto que el servidor vuelve a calcular al consumirlo.
 * @returns `true` únicamente si todos los campos protegidos coinciden.
 */
function coincideContexto(
  original: ContextoConfirmacionRf1,
  recibido: ContextoConfirmacionRf1,
): boolean {
  return (
    original.actorUserId === recibido.actorUserId &&
    original.clientId === recibido.clientId &&
    original.profileId === recibido.profileId &&
    original.digest === recibido.digest
  );
}
