import { Value } from '@sinclair/typebox/value';
import type { Static, TSchema } from '@sinclair/typebox';
import type {
  RespuestaAltaUsuarioAdmin,
  RespuestaRecuperacionAceptada,
  RespuestaUsuarioAdmin,
  RespuestaUsuarioPublico,
  SolicitudAltaUsuarioAdmin,
  SolicitudCambioContrasena,
  SolicitudCambioCorreo,
  SolicitudCambioCorreoAdmin,
  SolicitudFinalizacionToken,
  SolicitudModificacionUsuarioAdmin,
  SolicitudResetContrasenaAdmin,
  SolicitudRecuperacion,
  SolicitudTokenCorreo,
} from '@portal-soporte/contracts/auth';
import {
  adminCreateUserResponseSchema,
  adminRevokedSessionsResponseSchema,
  adminUserListResponseSchema,
  adminUserResponseSchema,
  authIdentityResponseSchema,
  csrfResponseSchema,
  publicErrorResponseSchema,
  recoveryAcceptedResponseSchema,
} from '@portal-soporte/contracts/auth';

type MetodoEscritura = 'POST' | 'PATCH';

const MENSAJES_API_AUTH: Readonly<Record<string, string>> = {
  ACCOUNT_NOT_AVAILABLE: 'La cuenta no puede completar esta operación.',
  AUTH_REQUIRED: 'Tu sesión terminó. Inicia sesión de nuevo.',
  COMMON_PASSWORD: 'La contraseña es demasiado común o predecible.',
  CURRENT_PASSWORD_INVALID: 'La contraseña actual no es válida.',
  EMAIL_DELIVERY_DISABLED: 'La entrega por correo está deshabilitada; contacta a administración.',
  EMAIL_ALREADY_VERIFIED: 'El correo ya está verificado.',
  EMAIL_TAKEN: 'Ese correo no está disponible para esta cuenta.',
  EMAIL_UNCHANGED: 'El correo nuevo debe ser distinto del actual.',
  FORBIDDEN: 'No tienes permiso para realizar esta operación.',
  INVALID_CREDENTIALS: 'No fue posible iniciar sesión. Revisa tus datos e inténtalo de nuevo.',
  INVALID_EMAIL: 'Escribe un correo electrónico válido.',
  INVALID_REQUEST: 'Revisa los datos del formulario.',
  PASSWORD_TOO_LONG: 'La contraseña no puede superar 128 caracteres Unicode.',
  PASSWORD_TOO_SHORT: 'La contraseña debe tener al menos 15 caracteres Unicode.',
  RATE_LIMITED: 'Espera antes de intentarlo de nuevo.',
  SMTP_DELIVERY_FAILED:
    'La invitación se reactivó, pero el enlace no pudo enviarse. Vuelve a intentarlo desde su ficha.',
  TOKEN_INVALID_OR_EXPIRED: 'El enlace no es válido o ya venció.',
  USERNAME_TAKEN: 'Ese nombre de usuario ya está ocupado.',
  USER_NOT_FOUND: 'No se encontró la cuenta solicitada.',
};

/**
 * Error HTTP de autenticación con código público estable y sin respuesta original.
 *
 * @param code - Código acotado para reglas de interfaz; no contiene cuerpo ni causa de red.
 * @param status - Estado HTTP recibido o cero si falló el transporte.
 */
export class ErrorApiAuth extends Error {
  /** Construye un mensaje localizado sin adjuntar cuerpos, credenciales o causas de red. */
  public constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(MENSAJES_API_AUTH[code] ?? 'No fue posible completar la solicitud.');
    this.name = 'ErrorApiAuth';
  }
}

/**
 * Obtiene una sesión vigente desde la API por el proxy same-origin.
 *
 * @returns Identidad pública validada contra el contrato compartido.
 */
export async function obtenerSesion(): Promise<RespuestaUsuarioPublico> {
  const respuesta = await solicitarApi('/api/v1/auth/me', authIdentityResponseSchema);
  return respuesta.user;
}

/**
 * Inicia sesión por username y deja la cookie opaca bajo control del navegador.
 *
 * @param username - Identificador que valida el contrato del API sin revelar su existencia.
 * @param password - Contraseña de entrada que se envía solo por POST same-origin.
 * @returns Identidad pública validada después de que el API emite la cookie HttpOnly.
 */
export async function iniciarSesion(
  username: string,
  password: string,
): Promise<RespuestaUsuarioPublico> {
  const respuesta = await enviarJson(
    '/api/v1/auth/login',
    { username, password },
    authIdentityResponseSchema,
  );

  return respuesta.user;
}

/**
 * Cierra sesión con CSRF y solicita al servidor invalidar la cookie opaca.
 *
 * @returns Promesa que resuelve solo después de aceptar la respuesta vacía 204.
 */
export async function cerrarSesion(): Promise<void> {
  await enviarJsonSinRespuesta('/api/v1/auth/logout', undefined);
}

/**
 * Solicita recuperación sin consultar ni exponer si el correo está asociado a una cuenta.
 *
 * @param email - Correo que el API normaliza y verifica sin enumeración pública.
 * @returns Confirmación uniforme de aceptación validada contra su contrato.
 */
export function solicitarRecuperacion(email: string): Promise<RespuestaRecuperacionAceptada> {
  const solicitud: SolicitudRecuperacion = { email };
  return enviarJson('/api/v1/auth/recovery/request', solicitud, recoveryAcceptedResponseSchema);
}

/**
 * Completa activación o recuperación con token enviado solo en el cuerpo POST.
 *
 * @param flujo - Propósito fijo que determina la ruta de consumo del token.
 * @param solicitud - Token y contraseña nueva sometidos al esquema de entrada del servidor.
 * @returns Promesa resuelta tras aceptar la respuesta vacía de consumo único.
 */
export function completarAcceso(
  flujo: 'activation' | 'recovery',
  solicitud: SolicitudFinalizacionToken,
): Promise<void> {
  const ruta =
    flujo === 'activation' ? '/api/v1/auth/activation/complete' : '/api/v1/auth/recovery/complete';
  return enviarJsonSinRespuesta(ruta, solicitud);
}

/**
 * Verifica un cambio de correo mediante token de un solo uso en el cuerpo POST.
 *
 * @param token - Token opaco recuperado del fragmento y no incluido en URL o logs.
 * @returns Promesa resuelta tras aceptar el consumo de token sin cuerpo de respuesta.
 */
export function completarCambioCorreo(token: string): Promise<void> {
  const solicitud: SolicitudTokenCorreo = { token };
  return enviarJsonSinRespuesta('/api/v1/auth/email-change/complete', solicitud);
}

/**
 * Cambia la contraseña propia con reautenticación y rotación de sesión del servidor.
 *
 * @param solicitud - Contraseña actual y nueva; el cliente no conserva la respuesta.
 * @returns Promesa resuelta tras la respuesta vacía del endpoint de cambio.
 */
export function cambiarContrasena(solicitud: SolicitudCambioContrasena): Promise<void> {
  return enviarJsonSinRespuesta('/api/v1/auth/password', solicitud);
}

/**
 * Solicita cambio o verificación de correo propio con reautenticación.
 *
 * @param solicitud - Credencial actual y correo candidato que permanece pendiente.
 * @returns Aceptación genérica validada sin revelar disponibilidad de la cuenta.
 */
export function solicitarCambioCorreoPropio(
  solicitud: SolicitudCambioCorreo,
): Promise<RespuestaRecuperacionAceptada> {
  return enviarJson('/api/v1/auth/email-change/request', solicitud, recoveryAcceptedResponseSchema);
}

/**
 * Lee usuarios administrativos validando cada campo permitido y sin usar caché web.
 *
 * @returns DTOs administrativos sin hash, token, cookie o secreto.
 */
export function listarUsuariosAdmin(): Promise<readonly RespuestaUsuarioAdmin[]> {
  return solicitarApi('/api/v1/admin/users', adminUserListResponseSchema);
}

/**
 * Crea una invitación sin transmitir contraseña inicial ni recibir el token de correo.
 *
 * @param solicitud - Identidad y rol de la cuenta pendiente que valida el servidor.
 * @returns Campos administrativos de la cuenta recién creada.
 */
export function crearUsuarioAdmin(
  solicitud: SolicitudAltaUsuarioAdmin,
): Promise<RespuestaAltaUsuarioAdmin> {
  return enviarResultadoAltaUsuario(solicitud);
}

/**
 * Valida los tres resultados de alta sin descartar el usuario creado por un límite o SMTP.
 *
 * @param solicitud - Identidad y rol que se envían al API para crear una cuenta pendiente.
 * @returns DTO creado junto con el estado de entrega explícito del enlace.
 * @throws ErrorApiAuth ante una respuesta inesperada o incompatible con su estado HTTP.
 */
async function enviarResultadoAltaUsuario(
  solicitud: SolicitudAltaUsuarioAdmin,
): Promise<RespuestaAltaUsuarioAdmin> {
  const respuesta = await enviarSolicitudJson('/api/v1/admin/users', solicitud, 'POST');
  if (respuesta.status !== 201) {
    throw await traducirErrorHttp(respuesta);
  }

  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    throw new ErrorApiAuth('INVALID_RESPONSE', 502);
  }

  if (!Value.Check(adminCreateUserResponseSchema, cuerpo)) {
    throw new ErrorApiAuth('INVALID_RESPONSE', 502);
  }

  return cuerpo;
}

/**
 * Modifica campos admitidos por el contrato administrativo y valida la respuesta.
 *
 * @param id - UUID que el servidor vuelve a validar como cuenta objetivo.
 * @param solicitud - Campos permitidos por el contrato de modificación.
 * @returns DTO administrativo resultante sin credenciales ni tokens.
 */
export function actualizarUsuarioAdmin(
  id: string,
  solicitud: SolicitudModificacionUsuarioAdmin,
): Promise<RespuestaUsuarioAdmin> {
  return enviarJson(
    `/api/v1/admin/users/${encodeURIComponent(id)}`,
    solicitud,
    adminUserResponseSchema,
    'PATCH',
  );
}

/**
 * Solicita un enlace para la cuenta elegida sin revelar el token al navegador.
 *
 * @param id - UUID de la cuenta cuya elegibilidad resuelve el servidor.
 * @returns Aceptación uniforme validada contra su contrato público.
 */
export function restablecerAccesoAdmin(id: string): Promise<RespuestaRecuperacionAceptada> {
  return enviarJson(
    `/api/v1/admin/users/${encodeURIComponent(id)}/reset`,
    undefined,
    recoveryAcceptedResponseSchema,
  );
}

/** Asigna una contraseña nueva por petición protegida y no interpreta ni conserva su respuesta. */
export function restablecerContrasenaAdmin(
  id: string,
  solicitud: SolicitudResetContrasenaAdmin,
): Promise<void> {
  return enviarJsonSinRespuesta(
    `/api/v1/admin/users/${encodeURIComponent(id)}/password`,
    solicitud,
  );
}

/**
 * Solicita un cambio de correo administrativo que queda pendiente de verificación.
 *
 * @param id - UUID de la cuenta que recibirá la solicitud de verificación.
 * @param solicitud - Correo candidato que aún no sustituye el correo vigente.
 * @returns Aceptación pública que no confirma existencia o disponibilidad.
 */
export function cambiarCorreoAdmin(
  id: string,
  solicitud: SolicitudCambioCorreoAdmin,
): Promise<RespuestaRecuperacionAceptada> {
  return enviarJson(
    `/api/v1/admin/users/${encodeURIComponent(id)}/email-change`,
    solicitud,
    recoveryAcceptedResponseSchema,
  );
}

/**
 * Revoca sesiones de una cuenta seleccionada por ADMIN.
 *
 * @param id - UUID de la cuenta objetivo.
 * @returns Conteo validado de sesiones que el servidor invalidó.
 */
export function revocarSesionesAdmin(id: string): Promise<{ readonly revokedSessions: number }> {
  return enviarJson(
    `/api/v1/admin/users/${encodeURIComponent(id)}/sessions/revoke`,
    undefined,
    adminRevokedSessionsResponseSchema,
  );
}

/**
 * Ejecuta GET same-origin y valida la respuesta sin almacenarla en caché.
 *
 * @typeParam TEsquema - Esquema TypeBox que define exactamente la respuesta aceptada.
 * @param ruta - Ruta relativa `/api/v1` atendida por el proxy interno.
 * @param esquema - Contrato de salida compartido con el servidor.
 * @returns Respuesta cuya forma coincide con el esquema indicado.
 * @throws ErrorApiAuth cuando falla la red, el estado HTTP o la validación de salida.
 */
async function solicitarApi<TEsquema extends TSchema>(
  ruta: string,
  esquema: TEsquema,
): Promise<Static<TEsquema>> {
  const respuesta = await fetch(ruta, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  }).catch(() => {
    throw new ErrorApiAuth('NETWORK_ERROR', 0);
  });

  return leerRespuesta(respuesta, esquema);
}

/**
 * Obtiene CSRF en memoria y ejecuta una mutación por el proxy same-origin.
 *
 * @typeParam TEsquema - Esquema TypeBox de la respuesta exitosa.
 * @typeParam TCuerpo - Tipo del cuerpo que se serializa sin persistir en el navegador.
 * @param ruta - Ruta relativa del API que recibe la operación.
 * @param cuerpo - Datos de entrada validados por el servidor; `undefined` indica cuerpo vacío.
 * @param esquema - Contrato runtime para descartar campos inesperados en la respuesta.
 * @param metodo - Verbo de escritura permitido por el contrato de esta operación.
 * @returns Respuesta que coincide con el contrato runtime.
 */
async function enviarJson<TEsquema extends TSchema, TCuerpo>(
  ruta: string,
  cuerpo: TCuerpo,
  esquema: TEsquema,
  metodo: MetodoEscritura = 'POST',
): Promise<Static<TEsquema>> {
  const respuesta = await enviarSolicitudJson(ruta, cuerpo, metodo);

  return leerRespuesta(respuesta, esquema);
}

/**
 * Ejecuta una mutación que contractualmente responde sin cuerpo HTTP.
 *
 * @typeParam TCuerpo - Tipo del cuerpo que solo se transmite por POST same-origin.
 * @param ruta - Ruta relativa del API que recibe la operación.
 * @param cuerpo - Solicitud serializada o `undefined` para un cuerpo vacío.
 * @param metodo - Verbo de escritura permitido por el contrato de esta operación.
 * @returns Promesa resuelta solo ante la respuesta 204 prevista.
 * @throws ErrorApiAuth si la red, el estado o la respuesta vacía no son válidos.
 */
async function enviarJsonSinRespuesta<TCuerpo>(
  ruta: string,
  cuerpo: TCuerpo,
  metodo: MetodoEscritura = 'POST',
): Promise<void> {
  const respuesta = await enviarSolicitudJson(ruta, cuerpo, metodo);
  if (!respuesta.ok) {
    throw await traducirErrorHttp(respuesta);
  }
  if (respuesta.status !== 204) {
    throw new ErrorApiAuth('INVALID_RESPONSE', 502);
  }
}

/**
 * Obtiene CSRF y crea una solicitud same-origin sin conservar datos de credenciales.
 *
 * @typeParam TCuerpo - Tipo del cuerpo JSON que se enviará en la mutación.
 * @param ruta - Ruta relativa del API que recibe la operación.
 * @param cuerpo - Datos de entrada o `undefined` para un cuerpo vacío.
 * @param metodo - Verbo de escritura admitido; por defecto utiliza POST.
 * @returns Respuesta HTTP sin interpretar para validación posterior.
 */
async function enviarSolicitudJson<TCuerpo>(
  ruta: string,
  cuerpo: TCuerpo,
  metodo: MetodoEscritura,
): Promise<Response> {
  const csrf = await obtenerTokenCsrf();
  const encabezados = new Headers({
    'x-csrf-token': csrf,
    ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
  });
  const respuesta = await fetch(ruta, {
    method: metodo,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: encabezados,
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  }).catch(() => {
    throw new ErrorApiAuth('NETWORK_ERROR', 0);
  });

  return respuesta;
}

/**
 * Obtiene el token CSRF no cacheable y valida su forma antes de autorizar una escritura.
 *
 * @returns Token aleatorio que permanece solo en memoria mientras se prepara el POST.
 * @throws ErrorApiAuth si el endpoint no responde o su salida no cumple el contrato.
 */
async function obtenerTokenCsrf(): Promise<string> {
  const respuesta = await fetch('/api/v1/auth/csrf', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  }).catch(() => {
    throw new ErrorApiAuth('CSRF_UNAVAILABLE', 0);
  });
  try {
    return (await leerRespuesta(respuesta, csrfResponseSchema)).token;
  } catch {
    throw new ErrorApiAuth('CSRF_UNAVAILABLE', 500);
  }
}

/**
 * Valida una respuesta HTTP contra un contrato TypeBox sin propagar datos arbitrarios.
 *
 * @typeParam TEsquema - Esquema runtime que determina los datos que pueden salir del cliente.
 * @param respuesta - Respuesta same-origin recibida del API o del proxy interno.
 * @param esquema - Esquema compartido para este código de éxito.
 * @returns JSON validado con el tipo estático que deriva del esquema.
 * @throws ErrorApiAuth por error HTTP, JSON inválido, campos extra o forma incompatible.
 */
async function leerRespuesta<TEsquema extends TSchema>(
  respuesta: Response,
  esquema: TEsquema,
): Promise<Static<TEsquema>> {
  if (!respuesta.ok) {
    throw await traducirErrorHttp(respuesta);
  }

  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    throw new ErrorApiAuth('INVALID_RESPONSE', 502);
  }

  if (!Value.Check(esquema, cuerpo)) {
    throw new ErrorApiAuth('INVALID_RESPONSE', 502);
  }

  return cuerpo;
}

/**
 * Extrae solo códigos de error públicos con sintaxis fija y descarta el texto del servidor.
 *
 * @param respuesta - Respuesta HTTP que contiene un error potencialmente no confiable.
 * @returns Error localizado que conserva únicamente código estable y estado.
 */
async function traducirErrorHttp(respuesta: Response): Promise<ErrorApiAuth> {
  let codigo = 'REQUEST_FAILED';
  try {
    const cuerpo: unknown = await respuesta.json();
    if (Value.Check(publicErrorResponseSchema, cuerpo) && /^[A-Z0-9_]{1,64}$/u.test(cuerpo.code)) {
      codigo = cuerpo.code;
    }
  } catch {
    codigo = 'REQUEST_FAILED';
  }

  return new ErrorApiAuth(codigo, respuesta.status);
}
