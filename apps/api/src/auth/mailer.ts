import nodemailer from 'nodemailer';
import type {
  MensajeCorreoAuth,
  ServicioCorreoAuth,
} from '../../../../packages/core/src/auth/ports.js';
import type { PropositoTokenAuth } from '../../../../packages/core/src/auth/recovery-ports.js';

/** Opciones de red y autenticación SMTP validadas antes de crear el transporte. */
export interface ConfiguracionTransporteSmtpAuth {
  /** Host SMTP configurado fuera del repositorio. */
  readonly host: string;
  /** Puerto TCP SMTP configurado. */
  readonly port: number;
  /** Indica TLS implícito, normalmente en el puerto 465. */
  readonly secure: boolean;
  /** Usuario SMTP opcional para relés internos sin autenticación. */
  readonly user?: string;
  /** Contraseña SMTP opcional, disponible solo junto al usuario. */
  readonly password?: string;
}

/** Mensaje mínimo que puede transportar el adaptador sin registrar su contenido. */
export interface CorreoSalienteAuth {
  /** Dirección remitente configurada. */
  readonly from: string;
  /** Dirección destino de la persona. */
  readonly to: string;
  /** Asunto fijo para el tipo de flujo. */
  readonly subject: string;
  /** Texto plano que incluye el enlace de un solo uso. */
  readonly text: string;
}

/** Transporte inyectable que mantiene la composición de correo separada de SMTP. */
export interface TransporteCorreoAuth {
  /** Envía un mensaje y rechaza sin requerir datos de diagnóstico sensibles. */
  enviar(mensaje: CorreoSalienteAuth): Promise<void>;
}

/** Error de entrega estable que no conserva las causas SMTP ni sus datos sensibles. */
export class ErrorServicioCorreoAuth extends Error {
  /** Crea un fallo controlado sin mensaje, recipient, URL ni respuesta del servidor. */
  public constructor() {
    super('SMTP_DELIVERY_FAILED');
    this.name = 'ErrorServicioCorreoAuth';
    this.code = 'SMTP_DELIVERY_FAILED';
  }

  /** Código estable consumible por los casos de uso y pruebas. */
  public readonly code = 'SMTP_DELIVERY_FAILED';
}

/** Adapta mensajes tipados al transporte sin registrar destinatarios o enlaces. */
export class AdaptadorCorreoSmtp implements ServicioCorreoAuth {
  /** Construye el adaptador con un remitente explícito y un transporte reutilizable. */
  public constructor(
    private readonly configuracion: { readonly remitente: string },
    private readonly transporte: TransporteCorreoAuth,
  ) {}

  /** Compone y envía un enlace fijo; reemplaza toda excepción SMTP por código seguro. */
  public async enviar(mensaje: MensajeCorreoAuth): Promise<void> {
    const plantilla = resolverPlantilla(mensaje.tipo);

    try {
      await this.transporte.enviar({
        from: this.configuracion.remitente,
        to: mensaje.destinatario,
        subject: plantilla.asunto,
        text: `${plantilla.instruccion}\n\n${mensaje.enlace}\n\nEl enlace vence en 30 minutos.`,
      });
    } catch {
      throw new ErrorServicioCorreoAuth();
    }
  }
}

/** Rechaza los flujos de correo cuando el SMTP no está configurado fuera de producción. */
export class ServicioCorreoNoConfigurado implements ServicioCorreoAuth {
  /**
   * Falla de forma cerrada sin guardar ni publicar destinatarios, enlaces o tokens.
   *
   * @returns Promesa rechazada con un código SMTP fijo para manejo no enumerativo.
   * @throws ErrorServicioCorreoAuth cuando no existe SMTP configurado.
   */
  public async enviar(): Promise<void> {
    throw new ErrorServicioCorreoAuth();
  }
}

/** Crea un transporte SMTP con timeout y TLS obligatorio para STARTTLS o TLS implícito. */
export function crearAdaptadorCorreoSmtp(
  configuracion: ConfiguracionTransporteSmtpAuth & { readonly remitente: string },
): AdaptadorCorreoSmtp {
  const transportador = nodemailer.createTransport({
    host: configuracion.host,
    port: configuracion.port,
    secure: configuracion.secure,
    requireTLS: !configuracion.secure,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
    ...(configuracion.user !== undefined && configuracion.password !== undefined
      ? { auth: { user: configuracion.user, pass: configuracion.password } }
      : {}),
  });

  return new AdaptadorCorreoSmtp(configuracion, {
    async enviar(mensaje) {
      await transportador.sendMail(mensaje);
    },
  });
}

/** Construye enlaces de correo con origen canónico y token solo en el fragmento. */
export function crearEnlaceCorreoAuth(
  origenConfigurado: string,
  proposito: PropositoTokenAuth,
  token: string,
): string {
  const origen = new URL(origenConfigurado);
  if (
    !['http:', 'https:'].includes(origen.protocol) ||
    origen.username.length > 0 ||
    origen.password.length > 0 ||
    origen.pathname !== '/' ||
    origen.search.length > 0 ||
    origen.hash.length > 0 ||
    origen.origin !== origenConfigurado
  ) {
    throw new Error('PUBLIC_APP_ORIGIN debe ser un origen canónico para los enlaces de auth.');
  }
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
    throw new Error('El enlace requiere un token opaco válido.');
  }

  const enlace = new URL('/recover-access/complete', origen);
  enlace.hash = new URLSearchParams({ flow: resolverFlujoEnlace(proposito), token }).toString();

  return enlace.toString();
}

/** Traduce la intención de correo a una plantilla española fija sin contenido suministrado. */
function resolverPlantilla(tipo: MensajeCorreoAuth['tipo']): {
  readonly asunto: string;
  readonly instruccion: string;
} {
  const plantillas: Record<MensajeCorreoAuth['tipo'], { asunto: string; instruccion: string }> = {
    ACTIVACION: {
      asunto: 'Activa tu cuenta del Portal de Soporte e-Billia',
      instruccion: 'Abre este enlace para establecer tu contraseña y activar tu cuenta.',
    },
    RECUPERACION: {
      asunto: 'Recupera el acceso al Portal de Soporte e-Billia',
      instruccion:
        'Si solicitaste recuperar el acceso, abre este enlace para definir una contraseña nueva.',
    },
    VERIFICACION_CORREO: {
      asunto: 'Verifica tu correo del Portal de Soporte e-Billia',
      instruccion: 'Abre este enlace para confirmar que puedes recibir mensajes en este correo.',
    },
    CAMBIO_CORREO: {
      asunto: 'Confirma el cambio de correo del Portal de Soporte e-Billia',
      instruccion: 'Abre este enlace para confirmar el nuevo correo de tu cuenta.',
    },
  };

  return plantillas[tipo];
}

/** Evita que un token de un propósito active otro flujo de recuperación. */
function resolverFlujoEnlace(proposito: PropositoTokenAuth): string {
  const flujos: Record<PropositoTokenAuth, string> = {
    ACTIVATION: 'activation',
    PASSWORD_RECOVERY: 'recovery',
    EMAIL_CHANGE: 'email-change',
    EMAIL_VERIFICATION: 'verify-email',
  };

  return flujos[proposito];
}
