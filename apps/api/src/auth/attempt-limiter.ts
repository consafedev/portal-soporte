import { createHmac } from 'node:crypto';
import { inArray, lte, sql } from 'drizzle-orm';
import type {
  LimitadorIntentosAuth,
  TipoIntentoAuth,
} from '../../../../packages/core/src/auth/recovery-ports.js';
import type { BaseDatosAuth } from '../db/client.js';
import { authThrottleWindows } from '../db/schema.js';

const MINUTOS_VENTANA_INTENTOS = 15;
const MAX_INTENTOS_CUENTA = 5;
const MAX_INTENTOS_RED = 20;

type AlcanceIntentos = 'LOGIN_ACCOUNT' | 'LOGIN_NETWORK' | 'RECOVERY_ACCOUNT' | 'RECOVERY_NETWORK';
type FilaIntentos = { attemptCount: number; blockedUntil: Date | null };

/** Aplica límites de intentos con contadores HMAC persistidos en PostgreSQL. */
export class LimitadorIntentosPostgres implements LimitadorIntentosAuth {
  /** Construye el limitador con una clave HMAC de al menos 32 bytes guardada en configuración. */
  public constructor(
    private readonly database: BaseDatosAuth,
    private readonly claveHmac: Buffer,
  ) {
    if (claveHmac.length < 32) {
      throw new Error('La clave HMAC del limitador debe contener al menos 32 bytes.');
    }
  }

  /** Registra atómicamente el intento y limita por identificador/IP y por red/IP. */
  public async registrarIntento(
    tipo: TipoIntentoAuth,
    identificador: string,
    direccionIp: string,
    ahora: Date,
  ): Promise<boolean> {
    const alcances = resolverAlcances(tipo);
    const claveCuenta = this.calcularClave(alcances.cuenta, identificador, direccionIp);
    const claveRed = this.calcularClave(alcances.red, '', direccionIp);

    return this.database.transaction(async (transaccion) => {
      await transaccion
        .delete(authThrottleWindows)
        .where(lte(authThrottleWindows.expiresAt, ahora));
      const cuenta = await incrementarContador(
        transaccion,
        claveCuenta,
        alcances.cuenta,
        MAX_INTENTOS_CUENTA,
        ahora,
      );
      const red = await incrementarContador(
        transaccion,
        claveRed,
        alcances.red,
        MAX_INTENTOS_RED,
        ahora,
      );

      return cuenta.attemptCount <= MAX_INTENTOS_CUENTA && red.attemptCount <= MAX_INTENTOS_RED;
    });
  }

  /** Elimina contadores de login tras validar credenciales y evita retener identificadores. */
  public async reiniciarIntentos(
    tipo: TipoIntentoAuth,
    identificador: string,
    direccionIp: string,
  ): Promise<void> {
    const alcances = resolverAlcances(tipo);
    const claves = [
      this.calcularClave(alcances.cuenta, identificador, direccionIp),
      this.calcularClave(alcances.red, '', direccionIp),
    ];
    await this.database
      .delete(authThrottleWindows)
      .where(inArray(authThrottleWindows.keyHash, claves));
  }

  /** HMAC-SHA-256 de alcance, identificador e IP sin guardar los originales. */
  private calcularClave(
    alcance: AlcanceIntentos,
    identificador: string,
    direccionIp: string,
  ): string {
    const material = `${alcance}\0${identificador.length}:${identificador}\0${direccionIp.length}:${direccionIp}`;

    return createHmac('sha256', this.claveHmac).update(material, 'utf8').digest('hex');
  }
}

/** Deriva los dos scopes aprobados sin mezclar contadores de login y correo. */
function resolverAlcances(tipo: TipoIntentoAuth): {
  readonly cuenta: AlcanceIntentos;
  readonly red: AlcanceIntentos;
} {
  return tipo === 'LOGIN'
    ? { cuenta: 'LOGIN_ACCOUNT', red: 'LOGIN_NETWORK' }
    : { cuenta: 'RECOVERY_ACCOUNT', red: 'RECOVERY_NETWORK' };
}

/** Incrementa un contador concurrentemente y reinicia solo al vencer su ventana. */
async function incrementarContador(
  transaccion: Parameters<Parameters<BaseDatosAuth['transaction']>[0]>[0],
  keyHash: string,
  scope: AlcanceIntentos,
  umbral: number,
  ahora: Date,
): Promise<FilaIntentos> {
  const venceEn = new Date(ahora.getTime() + MINUTOS_VENTANA_INTENTOS * 60_000);
  const ahoraIso = ahora.toISOString();
  const venceEnIso = venceEn.toISOString();
  const [fila] = await transaccion
    .insert(authThrottleWindows)
    .values({
      keyHash,
      scope,
      windowStartedAt: ahora,
      attemptCount: 1,
      blockedUntil: null,
      expiresAt: venceEn,
      updatedAt: ahora,
    })
    .onConflictDoUpdate({
      target: authThrottleWindows.keyHash,
      set: {
        scope,
        windowStartedAt: sql`CASE WHEN ${authThrottleWindows.expiresAt} <= ${ahoraIso}::timestamptz THEN ${ahoraIso}::timestamptz ELSE ${authThrottleWindows.windowStartedAt} END`,
        attemptCount: sql`CASE
          WHEN ${authThrottleWindows.expiresAt} <= ${ahoraIso}::timestamptz THEN 1
          WHEN ${authThrottleWindows.blockedUntil} > ${ahoraIso}::timestamptz THEN GREATEST(${authThrottleWindows.attemptCount}, ${umbral + 1})
          ELSE ${authThrottleWindows.attemptCount} + 1
        END`,
        blockedUntil: sql`CASE
          WHEN ${authThrottleWindows.expiresAt} <= ${ahoraIso}::timestamptz THEN NULL
          WHEN ${authThrottleWindows.blockedUntil} > ${ahoraIso}::timestamptz THEN ${authThrottleWindows.blockedUntil}
          WHEN ${authThrottleWindows.attemptCount} + 1 >= ${umbral} THEN ${authThrottleWindows.expiresAt}
          ELSE NULL
        END`,
        expiresAt: sql`CASE WHEN ${authThrottleWindows.expiresAt} <= ${ahoraIso}::timestamptz THEN ${venceEnIso}::timestamptz ELSE ${authThrottleWindows.expiresAt} END`,
        updatedAt: ahora,
      },
    })
    .returning({
      attemptCount: authThrottleWindows.attemptCount,
      blockedUntil: authThrottleWindows.blockedUntil,
    });

  if (fila === undefined) {
    throw new Error('No se pudo registrar el contador temporal de autenticación.');
  }

  return fila;
}
