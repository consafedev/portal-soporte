import { Type, type Static } from '@sinclair/typebox';

/** Patrón UUID RFC 4122 empleado en parámetros y respuestas del API. */
const PATRON_UUID =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
/** Patrón acotado de correo ASCII para las entradas del API del portal. */
const PATRON_CORREO =
  "^(?=.{3,254}$)[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$";
/** Patrón de fechas UTC serializadas por la API como ISO 8601 terminado en Z. */
const PATRON_FECHA_UTC = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$';

/** Literales de los roles que pueden aparecer en solicitudes y respuestas. */
export const rolUsuarioSchema = Type.Union([Type.Literal('ADMIN'), Type.Literal('SUPPORT')], {
  description: 'Rol de usuario vigente del portal.',
});

/** Tipo de rol derivado del esquema de contrato compartido. */
export type RolUsuario = Static<typeof rolUsuarioSchema>;

/** Literales de los estados del ciclo de vida de las cuentas. */
export const estadoUsuarioSchema = Type.Union(
  [Type.Literal('PENDING_ACTIVATION'), Type.Literal('ACTIVE'), Type.Literal('DISABLED')],
  { description: 'Estado de activación y acceso de una cuenta.' },
);

/** Tipo de estado derivado del esquema de contrato compartido. */
export type EstadoUsuario = Static<typeof estadoUsuarioSchema>;

/** Propiedades de identidad que pueden exponerse a la persona autenticada. */
const propiedadesUsuarioPublico = {
  id: Type.String({ pattern: PATRON_UUID, description: 'Identificador UUID de la cuenta.' }),
  username: Type.String({
    minLength: 3,
    maxLength: 64,
    pattern: '^[A-Za-z0-9._-]+$',
    description: 'Nombre de usuario canónico de inicio de sesión.',
  }),
  displayName: Type.String({
    minLength: 1,
    maxLength: 120,
    description: 'Nombre visible de la persona.',
  }),
  role: rolUsuarioSchema,
} as const;

/** Respuesta mínima de identidad, sin correo ni datos de autenticación. */
export const publicUserResponseSchema = Type.Object(propiedadesUsuarioPublico, {
  additionalProperties: false,
  description: 'Identidad pública que puede consultar la persona autenticada.',
});

/** Tipo de identidad pública serializado en JSON. */
export type RespuestaUsuarioPublico = Static<typeof publicUserResponseSchema>;

/** Respuesta acotada para que ADMIN gestione cuentas del portal. */
export const adminUserResponseSchema = Type.Object(
  {
    ...propiedadesUsuarioPublico,
    email: Type.String({
      pattern: PATRON_CORREO,
      maxLength: 254,
      description: 'Correo normalizado.',
    }),
    emailVerifiedAt: Type.Union([Type.String({ pattern: PATRON_FECHA_UTC }), Type.Null()], {
      description: 'Fecha de verificación UTC o null si falta verificar.',
    }),
    status: estadoUsuarioSchema,
    createdAt: Type.String({ pattern: PATRON_FECHA_UTC, description: 'Fecha UTC de creación.' }),
  },
  {
    additionalProperties: false,
    description: 'Campos permitidos en la administración de cuentas por ADMIN.',
  },
);

/** Tipo del DTO administrativo serializado en JSON. */
export type RespuestaUsuarioAdmin = Static<typeof adminUserResponseSchema>;

/** Entrada para autenticar por username y contraseña. */
export const loginRequestSchema = Type.Object(
  {
    username: Type.String({
      minLength: 3,
      maxLength: 64,
      pattern: '^[A-Za-z0-9._-]+$',
      description: 'Username ASCII; se normaliza antes de buscar.',
    }),
    password: Type.String({
      minLength: 1,
      maxLength: 512,
      description: 'Contraseña original, sin recortar ni truncar.',
    }),
  },
  { additionalProperties: false, description: 'Credenciales para iniciar sesión.' },
);

/** Tipo de la solicitud validada de login. */
export type SolicitudLogin = Static<typeof loginRequestSchema>;

/** Solicitud de cambio voluntario de contraseña propia. */
export const changePasswordRequestSchema = Type.Object(
  {
    currentPassword: Type.String({ minLength: 1, maxLength: 512 }),
    newPassword: Type.String({ minLength: 15, maxLength: 256 }),
  },
  {
    additionalProperties: false,
    description: 'Cambio propio; exige reautenticación con la contraseña actual.',
  },
);

/** Tipo del cambio de contraseña propio. */
export type SolicitudCambioContrasena = Static<typeof changePasswordRequestSchema>;

/** Solicitud de cambio voluntario de correo y reautenticación. */
export const emailChangeRequestSchema = Type.Object(
  {
    currentPassword: Type.String({ minLength: 1, maxLength: 512 }),
    newEmail: Type.String({ pattern: PATRON_CORREO, minLength: 3, maxLength: 254 }),
  },
  {
    additionalProperties: false,
    description: 'Cambio de correo pendiente hasta que se verifique el nuevo destino.',
  },
);

/** Tipo de solicitud para cambiar o verificar el correo propio. */
export type SolicitudCambioCorreo = Static<typeof emailChangeRequestSchema>;

/** Solicitud de inicio de recuperación sin revelar si el correo existe. */
export const recoveryRequestSchema = Type.Object(
  { email: Type.String({ pattern: PATRON_CORREO, minLength: 3, maxLength: 254 }) },
  { additionalProperties: false, description: 'Correo de recuperación normalizado.' },
);

/** Tipo de solicitud de recuperación de acceso. */
export type SolicitudRecuperacion = Static<typeof recoveryRequestSchema>;

/** Solicitud de completar recuperación o activación con token de un solo uso. */
export const completeTokenRequestSchema = Type.Object(
  {
    token: Type.String({
      minLength: 43,
      maxLength: 43,
      pattern: '^[A-Za-z0-9_-]{43}$',
      description: 'Token opaco recibido por correo y enviado solo en el cuerpo POST.',
    }),
    newPassword: Type.String({ minLength: 15, maxLength: 256 }),
  },
  {
    additionalProperties: false,
    description: 'Consumo de un token de recuperación o activación.',
  },
);

/** Tipo de finalización de recuperación o activación. */
export type SolicitudFinalizacionToken = Static<typeof completeTokenRequestSchema>;

/** Token CSRF aleatorio entregado por el endpoint de lectura no cacheable. */
export const csrfResponseSchema = Type.Object(
  {
    token: Type.String({
      minLength: 43,
      maxLength: 43,
      pattern: '^[A-Za-z0-9_-]{43}$',
      description: 'Token de doble envío que debe permanecer en memoria de la UI.',
    }),
  },
  { additionalProperties: false, description: 'Token CSRF para operaciones de escritura.' },
);

/** Tipo de respuesta del endpoint CSRF. */
export type RespuestaCsrf = Static<typeof csrfResponseSchema>;

/** Solicitud para que ADMIN invite a una cuenta sin asignar una contraseña. */
export const adminCreateUserSchema = Type.Object(
  {
    username: Type.String({
      minLength: 3,
      maxLength: 64,
      pattern: '^[A-Za-z0-9._-]+$',
      description: 'Username ASCII único, normalizado por el servidor.',
    }),
    email: Type.String({ pattern: PATRON_CORREO, minLength: 3, maxLength: 254 }),
    displayName: Type.String({ minLength: 1, maxLength: 120 }),
    role: rolUsuarioSchema,
  },
  {
    additionalProperties: false,
    description: 'Alta administrativa; la cuenta queda pendiente de activación.',
  },
);

/** Tipo de la solicitud de invitación administrativa. */
export type SolicitudAltaUsuarioAdmin = Static<typeof adminCreateUserSchema>;

/** Solicitud parcial de modificación de una cuenta existente. */
export const adminUpdateUserSchema = Type.Object(
  {
    username: Type.Optional(
      Type.String({ minLength: 3, maxLength: 64, pattern: '^[A-Za-z0-9._-]+$' }),
    ),
    email: Type.Optional(Type.String({ pattern: PATRON_CORREO, minLength: 3, maxLength: 254 })),
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    role: Type.Optional(rolUsuarioSchema),
    status: Type.Optional(estadoUsuarioSchema),
  },
  {
    additionalProperties: false,
    minProperties: 1,
    description: 'Modificación parcial, sujeta a reglas de rol y último administrador.',
  },
);

/** Tipo de la modificación parcial de usuario por ADMIN. */
export type SolicitudModificacionUsuarioAdmin = Static<typeof adminUpdateUserSchema>;

/** Parámetro de ruta que identifica una cuenta por UUID. */
export const userIdParamsSchema = Type.Object(
  { id: Type.String({ pattern: PATRON_UUID, description: 'UUID de la cuenta objetivo.' }) },
  { additionalProperties: false, description: 'Identificador de usuario en la ruta.' },
);

/** Respuesta estable de error público sin detalles de implementación. */
export const publicErrorResponseSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 64 }),
    message: Type.String({ minLength: 1, maxLength: 240 }),
  },
  { additionalProperties: false, description: 'Error controlado en español.' },
);

/** Tipo de error controlado serializado por la API. */
export type RespuestaErrorPublico = Static<typeof publicErrorResponseSchema>;
