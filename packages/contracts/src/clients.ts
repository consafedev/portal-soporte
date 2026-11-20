import { Type, type Static } from '@sinclair/typebox';

/** Expresión UUID aplicada en parámetros de cliente y ambiente. */
const PATRON_UUID_CLIENTE =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
/** Forma UTC serializada que entrega el API para las fechas de auditoría. */
const PATRON_FECHA_CLIENTE = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$';

/** Estado lógico compartido por clientes y ambientes SAP. */
export const estadoRegistroClienteSchema = Type.Union(
  [Type.Literal('ACTIVE'), Type.Literal('DISABLED')],
  { description: 'Estado del cliente o ambiente, sin eliminación física.' },
);

/** Tipo de estado validado en runtime y compilación. */
export type EstadoRegistroClienteContrato = Static<typeof estadoRegistroClienteSchema>;

/** Respuesta pública de un cliente, deliberadamente ajena a sus secretos de conexión. */
export const clienteAdminSchema = Type.Object(
  {
    id: Type.String({ pattern: PATRON_UUID_CLIENTE, description: 'UUID inmutable del cliente.' }),
    nombre: Type.String({
      minLength: 2,
      maxLength: 120,
      description: 'Nombre visible del cliente.',
    }),
    estado: estadoRegistroClienteSchema,
    createdAt: Type.String({ pattern: PATRON_FECHA_CLIENTE, description: 'Fecha UTC de alta.' }),
    updatedAt: Type.String({ pattern: PATRON_FECHA_CLIENTE, description: 'Fecha UTC de cambio.' }),
  },
  { additionalProperties: false, description: 'Campos permitidos para administrar un cliente.' },
);

/** DTO serializado de administración de un cliente. */
export type ClienteAdminContrato = Static<typeof clienteAdminSchema>;

/** Respuesta pública de un ambiente SAP vinculado con un cliente. */
export const ambienteSapClienteAdminSchema = Type.Object(
  {
    id: Type.String({ pattern: PATRON_UUID_CLIENTE, description: 'UUID del ambiente SAP.' }),
    clientId: Type.String({ pattern: PATRON_UUID_CLIENTE, description: 'UUID de su cliente.' }),
    codigo: Type.String({ minLength: 1, maxLength: 32, pattern: '^[A-Z0-9][A-Z0-9_-]*$' }),
    nombre: Type.String({ minLength: 2, maxLength: 120 }),
    estado: estadoRegistroClienteSchema,
    createdAt: Type.String({ pattern: PATRON_FECHA_CLIENTE }),
    updatedAt: Type.String({ pattern: PATRON_FECHA_CLIENTE }),
  },
  {
    additionalProperties: false,
    description: 'Ambiente SAP de un cliente, independiente del entorno de despliegue del Portal.',
  },
);

/** DTO serializado para la administración de un ambiente SAP. */
export type AmbienteSapClienteAdminContrato = Static<typeof ambienteSapClienteAdminSchema>;

/** Entrada para dar de alta un cliente con nombre visible. */
export const crearClienteAdminSchema = Type.Object(
  { nombre: Type.String({ minLength: 2, maxLength: 120 }) },
  { additionalProperties: false, description: 'Datos no secretos para registrar un cliente.' },
);

/** Tipo de alta administrativa de cliente. */
export type SolicitudCrearClienteAdmin = Static<typeof crearClienteAdminSchema>;

/** Cambios permitidos en un cliente existente. */
export const actualizarClienteAdminSchema = Type.Object(
  {
    nombre: Type.Optional(Type.String({ minLength: 2, maxLength: 120 })),
    estado: Type.Optional(estadoRegistroClienteSchema),
  },
  {
    additionalProperties: false,
    minProperties: 1,
    description: 'Permite editar o desactivar lógicamente el cliente.',
  },
);

/** Tipo de modificación administrativa de cliente. */
export type SolicitudActualizarClienteAdmin = Static<typeof actualizarClienteAdminSchema>;

/** Entrada para registrar un código y nombre de ambiente SAP del cliente. */
export const crearAmbienteSapClienteAdminSchema = Type.Object(
  {
    codigo: Type.String({ minLength: 1, maxLength: 32, pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' }),
    nombre: Type.String({ minLength: 2, maxLength: 120 }),
  },
  { additionalProperties: false, description: 'Datos de catálogo SAP sin credenciales.' },
);

/** Tipo de alta de ambiente SAP. */
export type SolicitudCrearAmbienteSapClienteAdmin = Static<
  typeof crearAmbienteSapClienteAdminSchema
>;

/** Cambios permitidos para un ambiente SAP existente. */
export const actualizarAmbienteSapClienteAdminSchema = Type.Object(
  {
    codigo: Type.Optional(
      Type.String({ minLength: 1, maxLength: 32, pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' }),
    ),
    nombre: Type.Optional(Type.String({ minLength: 2, maxLength: 120 })),
    estado: Type.Optional(estadoRegistroClienteSchema),
  },
  {
    additionalProperties: false,
    minProperties: 1,
    description: 'Actualiza metadatos o estado de un ambiente SAP.',
  },
);

/** Tipo de modificación de ambiente SAP. */
export type SolicitudActualizarAmbienteSapClienteAdmin = Static<
  typeof actualizarAmbienteSapClienteAdminSchema
>;

/** Parámetro de ruta del cliente administrativo. */
export const clienteParamsSchema = Type.Object(
  { clientId: Type.String({ pattern: PATRON_UUID_CLIENTE, description: 'UUID del cliente.' }) },
  { additionalProperties: false, description: 'Identidad del cliente indicada en la ruta.' },
);

/** Tipo de los parámetros que contienen el identificador de cliente. */
export type ParametrosCliente = Static<typeof clienteParamsSchema>;

/** Parámetros que identifican el cliente y el ambiente bajo su ámbito. */
export const clienteYAmbienteParamsSchema = Type.Object(
  {
    clientId: Type.String({ pattern: PATRON_UUID_CLIENTE }),
    environmentId: Type.String({ pattern: PATRON_UUID_CLIENTE }),
  },
  { additionalProperties: false, description: 'Identificadores opacos en la ruta administrativa.' },
);

/** Tipo de los parámetros de cliente y ambiente SAP. */
export type ParametrosClienteAmbiente = Static<typeof clienteYAmbienteParamsSchema>;

/** Lista completa de clientes redactados permitida por el API. */
export const listaClientesAdminSchema = Type.Array(clienteAdminSchema, {
  description: 'Clientes visibles para ADMIN, sin perfiles ni credenciales.',
});

/** Lista de ambientes SAP del cliente indicado. */
export const listaAmbientesSapClienteAdminSchema = Type.Array(ambienteSapClienteAdminSchema, {
  description: 'Ambientes SAP ligados exclusivamente al cliente de la ruta.',
});

/** Envoltura de errores públicos para operaciones de clientes. */
export const errorClienteAdminSchema = Type.Object(
  {
    code: Type.String({ pattern: '^[A-Z0-9_]{1,64}$' }),
    message: Type.String({ minLength: 1, maxLength: 160 }),
  },
  {
    additionalProperties: false,
    description: 'Error estable sin datos de PostgreSQL ni secretos.',
  },
);
