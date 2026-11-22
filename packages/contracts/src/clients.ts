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

/** Identifica cliente y usuario SUPPORT en una concesión o revocación. */
export const clienteYUsuarioParamsSchema = Type.Object(
  {
    clientId: Type.String({ pattern: PATRON_UUID_CLIENTE }),
    userId: Type.String({ pattern: PATRON_UUID_CLIENTE }),
  },
  { additionalProperties: false, description: 'Identificadores de la asignación solicitada.' },
);

/** Tipo de parámetros de cliente y usuario para el acceso por cliente. */
export type ParametrosClienteUsuario = Static<typeof clienteYUsuarioParamsSchema>;

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

/** Tipos de conexión que el núcleo PS-005 soporta actualmente. */
export const tipoPerfilConexionAdminSchema = Type.Union([
  Type.Literal('MYSQL_TCP'),
  Type.Literal('MYSQL_SSH'),
]);

/** Entornos del sistema cliente disponibles para un perfil de conexión. */
export const entornoPerfilConexionAdminSchema = Type.Union([
  Type.Literal('PRODUCTION'),
  Type.Literal('TEST'),
]);

/** Tipo del ambiente declarativo asociado al perfil de conexión. */
export type EntornoPerfilConexionAdmin = Static<typeof entornoPerfilConexionAdminSchema>;

/** Credenciales MySQL protegidas en el servidor; jamás son parte de una respuesta. */
export const credencialesMySqlAdminSchema = Type.Object(
  {
    mysqlUsername: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_.@-]+$' }),
    mysqlPassword: Type.String({ minLength: 1, maxLength: 4096 }),
    tls: Type.Optional(
      Type.Object(
        {
          ca: Type.Optional(Type.String({ minLength: 1, maxLength: 16_384 })),
          cert: Type.Optional(Type.String({ minLength: 1, maxLength: 16_384 })),
          key: Type.Optional(Type.String({ minLength: 1, maxLength: 16_384 })),
        },
        { additionalProperties: false },
      ),
    ),
    ssh: Type.Optional(
      Type.Object(
        {
          username: Type.String({ minLength: 1, maxLength: 128 }),
          authentication: Type.Literal('PRIVATE_KEY'),
          privateKey: Type.String({
            minLength: 1,
            maxLength: 16_384,
            pattern:
              '^(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|PuTTY-User-Key-File-[0-9]+: [A-Za-z0-9-]+)',
            description:
              'Llave PEM/OpenSSH o PuTTY PPK v2 RSA; PPK v3, DSA y otros PPK no son compatibles.',
          }),
          passphrase: Type.Optional(Type.String({ maxLength: 1024 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  {
    additionalProperties: false,
    description:
      'Material temporal que el servidor cifra antes de persistir; SSH usa llave privada, no contraseña.',
  },
);

/** Tipo de credenciales que recibe una única operación de alta/reemplazo. */
export type CredencialesMySqlAdmin = Static<typeof credencialesMySqlAdminSchema>;

/** Entrada estricta para crear perfil y cifrar credenciales antes de guardar. */
export const crearPerfilConexionAdminSchema = Type.Object(
  {
    nombre: Type.String({ minLength: 2, maxLength: 120 }),
    tipo: tipoPerfilConexionAdminSchema,
    entorno: entornoPerfilConexionAdminSchema,
    destinoMySqlId: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9_-]*$' }),
    gatewaySshId: Type.Optional(
      Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9_-]*$' }),
    ),
    baseDatos: Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_$-]+$' }),
    credenciales: credencialesMySqlAdminSchema,
  },
  {
    additionalProperties: false,
    description:
      'Perfil administrativo; credenciales se reciben solo para cifrado y no se devuelven.',
  },
);

/** Tipo de entrada para la creación de un perfil de conexión. */
export type SolicitudCrearPerfilConexionAdmin = Static<typeof crearPerfilConexionAdminSchema>;

/** Cambios acotados a metadatos; las credenciales se reemplazan por un endpoint separado. */
export const actualizarPerfilConexionAdminSchema = Type.Object(
  {
    nombre: Type.Optional(Type.String({ minLength: 2, maxLength: 120 })),
    entorno: Type.Optional(entornoPerfilConexionAdminSchema),
    destinoMySqlId: Type.Optional(
      Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9_-]*$' }),
    ),
    gatewaySshId: Type.Optional(
      Type.Union([
        Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9_-]*$' }),
        Type.Null(),
      ]),
    ),
    baseDatos: Type.Optional(
      Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_$-]+$' }),
    ),
    estado: Type.Optional(estadoRegistroClienteSchema),
  },
  {
    additionalProperties: false,
    minProperties: 1,
    description: 'Actualiza metadatos sin aceptar ni devolver contraseñas o llaves.',
  },
);

/** Tipo de los campos editables de un perfil. */
export type SolicitudActualizarPerfilConexionAdmin = Static<
  typeof actualizarPerfilConexionAdminSchema
>;

/** Entrada para sustituir credenciales; TypeBox rechaza campos adicionales. */
export const reemplazarCredencialesPerfilAdminSchema = Type.Object(
  { credenciales: credencialesMySqlAdminSchema },
  { additionalProperties: false },
);

/** Tipo de entrada para reemplazar credenciales protegidas de un perfil. */
export type SolicitudReemplazarCredencialesPerfilAdmin = Static<
  typeof reemplazarCredencialesPerfilAdminSchema
>;

/** Parámetros de la ruta anidada bajo cliente y perfil. */
export const clienteYPerfilParamsSchema = Type.Object(
  {
    clientId: Type.String({ pattern: PATRON_UUID_CLIENTE }),
    profileId: Type.String({ pattern: PATRON_UUID_CLIENTE }),
  },
  { additionalProperties: false },
);

/** Tipo de parámetros de una ruta de perfil de conexión. */
export type ParametrosClientePerfil = Static<typeof clienteYPerfilParamsSchema>;

/** DTO público redactado del perfil de conexión. */
export const perfilConexionAdminSchema = Type.Object(
  {
    id: Type.String({ pattern: PATRON_UUID_CLIENTE }),
    clientId: Type.String({ pattern: PATRON_UUID_CLIENTE }),
    nombre: Type.String({ minLength: 2, maxLength: 120 }),
    tipo: tipoPerfilConexionAdminSchema,
    entorno: entornoPerfilConexionAdminSchema,
    destinoMySqlId: Type.String({ minLength: 1, maxLength: 64 }),
    gatewaySshId: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
    baseDatos: Type.String({ minLength: 1, maxLength: 64 }),
    estado: estadoRegistroClienteSchema,
    createdAt: Type.String({ pattern: PATRON_FECHA_CLIENTE }),
    updatedAt: Type.String({ pattern: PATRON_FECHA_CLIENTE }),
  },
  {
    additionalProperties: false,
    description: 'Respuesta sin nombre de usuario ni material secreto.',
  },
);

/** Tipo de la respuesta redactada de perfil de conexión. */
export type PerfilConexionAdminContrato = Static<typeof perfilConexionAdminSchema>;

/** Respuesta de prueba MySQL sin host, usuario, detalle de driver o secretos. */
export const resultadoPruebaPerfilAdminSchema = Type.Object(
  {
    code: Type.String({ pattern: '^[A-Z0-9_]{1,64}$' }),
    completedAt: Type.String({ pattern: PATRON_FECHA_CLIENTE }),
  },
  { additionalProperties: false },
);

/** Tipo de resultado público de una prueba de conexión redactada. */
export type ResultadoPruebaPerfilAdminContrato = Static<typeof resultadoPruebaPerfilAdminSchema>;

/** Lista redactada de perfiles asociados a un cliente. */
export const listaPerfilesConexionAdminSchema = Type.Array(perfilConexionAdminSchema);

/** Datos mínimos de un perfil que SUPPORT puede seleccionar sin ver detalles internos. */
export const perfilConexionAccesibleSchema = Type.Object(
  {
    id: Type.String({ pattern: PATRON_UUID_CLIENTE }),
    clientId: Type.String({ pattern: PATRON_UUID_CLIENTE }),
    nombre: Type.String({ minLength: 2, maxLength: 120 }),
    tipo: tipoPerfilConexionAdminSchema,
    entorno: entornoPerfilConexionAdminSchema,
    estado: estadoRegistroClienteSchema,
  },
  {
    additionalProperties: false,
    description: 'Perfil seleccionable sin alias de destino, base de datos o credenciales.',
  },
);

/** Lista de perfiles redactados disponibles para una operación autorizada. */
export const listaPerfilesConexionAccesiblesSchema = Type.Array(perfilConexionAccesibleSchema);

/** Identificadores funcionales permitidos para acceso por cliente. */
export const capacidadClienteSchema = Type.Union(
  [Type.Literal('rf-1:read'), Type.Literal('rf-1:execute')],
  { description: 'Capacidad allowlisted; execute permanece deshabilitada en esta entrega.' },
);

/** Tipo de capacidad de cliente compartido entre API y aplicaciones. */
export type CapacidadClienteContrato = Static<typeof capacidadClienteSchema>;

/** Cliente operativo seleccionable, sin perfiles ni secretos de conexión. */
export const clienteAccesibleSchema = Type.Object(
  {
    id: Type.String({ pattern: PATRON_UUID_CLIENTE }),
    nombre: Type.String({ minLength: 2, maxLength: 120 }),
    estado: estadoRegistroClienteSchema,
  },
  { additionalProperties: false, description: 'Resumen seleccionable sin detalles de conexión.' },
);

/** Tipo público de cliente autorizado que puede seleccionar un usuario. */
export type ClienteAccesibleContrato = Static<typeof clienteAccesibleSchema>;

/** Colección de clientes accesibles sin ampliar datos respecto al DTO administrativo redactado. */
export const listaClientesAccesiblesSchema = Type.Array(clienteAccesibleSchema);

/** Resumen de asignación de SUPPORT limitado a identidad visible y fechas de vigencia. */
export const asignacionClienteAdminSchema = Type.Object(
  {
    userId: Type.String({ pattern: PATRON_UUID_CLIENTE }),
    displayName: Type.String({ minLength: 1, maxLength: 120 }),
    userActive: Type.Boolean(),
    grantedAt: Type.String({ pattern: PATRON_FECHA_CLIENTE }),
    revokedAt: Type.Union([Type.String({ pattern: PATRON_FECHA_CLIENTE }), Type.Null()]),
  },
  {
    additionalProperties: false,
    description: 'Asignación redactada; no incluye correo, credenciales ni actores internos.',
  },
);

/** Tipo de respuesta administrativa de una asignación usuario-cliente. */
export type AsignacionClienteAdminContrato = Static<typeof asignacionClienteAdminSchema>;

/** Lista de asignaciones visibles para el rol ADMIN. */
export const listaAsignacionesClienteAdminSchema = Type.Array(asignacionClienteAdminSchema);

/** Estado de una capacidad por cliente sin identificadores de sus actores internos. */
export const estadoCapacidadClienteAdminSchema = Type.Union(
  [
    Type.Object(
      {
        clientId: Type.String({ pattern: PATRON_UUID_CLIENTE }),
        capabilityId: Type.Literal('rf-1:read'),
        enabled: Type.Boolean(),
        changedAt: Type.Union([Type.String({ pattern: PATRON_FECHA_CLIENTE }), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        clientId: Type.String({ pattern: PATRON_UUID_CLIENTE }),
        capabilityId: Type.Literal('rf-1:execute'),
        enabled: Type.Boolean(),
        changedAt: Type.Union([Type.String({ pattern: PATRON_FECHA_CLIENTE }), Type.Null()]),
      },
      { additionalProperties: false },
    ),
  ],
  { description: 'Capacidad persistida; ejecución requiere además el gate global del servidor.' },
);

/** Tipo de respuesta con el estado actual de una capacidad por cliente. */
export type EstadoCapacidadClienteContrato = Static<typeof estadoCapacidadClienteAdminSchema>;

/** Estado completo de autorizaciones asignables para una vista administrativa. */
export const accesoClienteAdminSchema = Type.Object(
  {
    asignaciones: listaAsignacionesClienteAdminSchema,
    capacidades: Type.Array(estadoCapacidadClienteAdminSchema),
  },
  { additionalProperties: false, description: 'Accesos y capacidades vigentes de un cliente.' },
);

/** Tipo de respuesta agregada de administración de acceso por cliente. */
export type AccesoClienteAdminContrato = Static<typeof accesoClienteAdminSchema>;

/** Solicitud estricta para habilitar o deshabilitar una capacidad allowlisted. */
export const establecerCapacidadClienteSchema = Type.Object(
  { enabled: Type.Boolean() },
  { additionalProperties: false, description: 'Nuevo estado explícito de la capacidad.' },
);

/** Estatus permitidos para presentar una futura operación RF-1 sin ejecutarla. */
export const estatusVistaPreviaRf1Schema = Type.Union(
  [Type.Literal('CONTABILIZADO'), Type.Literal('PAGADA')],
  { description: 'Estatus de negocio que se muestra en preview; no habilita inserciones.' },
);

/** Tipo de estatus aceptado por la ruta de vista previa RF-1. */
export type EstatusVistaPreviaRf1Contrato = Static<typeof estatusVistaPreviaRf1Schema>;

/** Query estricta para seleccionar un perfil y estatus ya autorizados por el servidor. */
export const solicitudVistaPreviaRf1Schema = Type.Object(
  {
    profileId: Type.String({ pattern: PATRON_UUID_CLIENTE }),
    estatus: estatusVistaPreviaRf1Schema,
  },
  { additionalProperties: false, description: 'Identidad del perfil y estatus de preview.' },
);

/** Tipo de query permitido en una solicitud RF-1 de solo lectura. */
export type SolicitudVistaPreviaRf1Contrato = Static<typeof solicitudVistaPreviaRf1Schema>;

/** Sociedad SAP revelada solo después de una consulta autorizada al catálogo del cliente. */
const sociedadVistaPreviaRf1Schema = Type.Object(
  {
    sociedad: Type.String({ minLength: 1, maxLength: 64 }),
    ambienteSap: Type.String({ minLength: 1, maxLength: 32 }),
  },
  { additionalProperties: false },
);

/** Selección de catálogo que identifica un XML por su índice original en el lote. */
export const seleccionSociedadArchivoRf1Schema = Type.Object(
  {
    indiceArchivo: Type.Integer({ minimum: 0, maximum: 99 }),
    sociedad: Type.String({ minLength: 1, maxLength: 64 }),
    ambienteSap: Type.String({ minLength: 1, maxLength: 32 }),
  },
  {
    additionalProperties: false,
    description: 'Par sociedad/ambiente explícito ligado al índice del archivo CFDI.',
  },
);

/** Tipo estricto de selección societaria recibida por el endpoint RF-1 read-only. */
export type SeleccionSociedadArchivoRf1Contrato = Static<typeof seleccionSociedadArchivoRf1Schema>;

/** Colección acotada de selecciones, validada de nuevo contra el catálogo en el backend. */
export const seleccionesSociedadRf1Schema = Type.Array(seleccionSociedadArchivoRf1Schema, {
  minItems: 1,
  maxItems: 100,
  description: 'Selecciones explícitas indexadas en el mismo orden que los archivos recibidos.',
});

/** Campos fiscales serializables que puede presentar la vista previa sin XML original. */
const facturaVistaPreviaRf1Schema = Type.Object(
  {
    uuid: Type.String({ minLength: 36, maxLength: 36 }),
    rfcEmisor: Type.String({ minLength: 1, maxLength: 13 }),
    rfcReceptor: Type.String({ minLength: 1, maxLength: 13 }),
    fecha: Type.String({ minLength: 1, maxLength: 64 }),
    subtotal: Type.String({ minLength: 1, maxLength: 64 }),
    descuento: Type.String({ minLength: 1, maxLength: 64 }),
    moneda: Type.String({ minLength: 3, maxLength: 3 }),
    total: Type.String({ minLength: 1, maxLength: 64 }),
    referencia: Type.String({ maxLength: 256 }),
    tipoComprobante: Type.Literal('I'),
    importeIvaFAC: Type.String({ minLength: 1, maxLength: 64 }),
    retencionIsr: Type.String({ minLength: 1, maxLength: 64 }),
    retencionIva: Type.String({ minLength: 1, maxLength: 64 }),
    retencionIeps: Type.String({ minLength: 1, maxLength: 64 }),
    metodoPago: Type.Optional(Type.String({ maxLength: 8 })),
    formaPago: Type.Optional(Type.String({ maxLength: 8 })),
    serie: Type.Optional(Type.String({ maxLength: 25 })),
    folio: Type.Optional(Type.String({ maxLength: 40 })),
  },
  { additionalProperties: false, description: 'Datos tipados derivados del CFDI, nunca el XML.' },
);

/** Resolución contextual de sociedad/proveedor obtenida mediante lecturas RF-1 fijas. */
const resolucionVistaPreviaRf1Schema = Type.Object(
  {
    sociedad: Type.String({ minLength: 1, maxLength: 64 }),
    ambienteSap: Type.String({ minLength: 1, maxLength: 32 }),
    idProveedor: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);

/** Resultado público de un único CFDI, sin archivo, SQL, conexión ni secreto. */
export const resultadoArchivoVistaPreviaRf1Schema = Type.Object(
  {
    status: Type.Union([
      Type.Literal('READY'),
      Type.Literal('NEEDS_SELECTION'),
      Type.Literal('BLOCKED'),
    ]),
    errorCode: Type.Optional(Type.String({ pattern: '^[A-Z0-9_]{1,64}$' })),
    factura: Type.Optional(facturaVistaPreviaRf1Schema),
    sociedadesDisponibles: Type.Optional(
      Type.Array(sociedadVistaPreviaRf1Schema, { maxItems: 100 }),
    ),
    resolution: Type.Optional(resolucionVistaPreviaRf1Schema),
    estatus: Type.Optional(estatusVistaPreviaRf1Schema),
  },
  {
    additionalProperties: false,
    description: 'Previsualización redactada sin efectos de escritura.',
  },
);

/** Tipo serializable del resultado de preview de un XML. */
export type ResultadoArchivoVistaPreviaRf1Contrato = Static<
  typeof resultadoArchivoVistaPreviaRf1Schema
>;

/** Colección de resultados en el mismo orden en que se recibieron los archivos. */
export const resultadosVistaPreviaRf1Schema = Type.Array(resultadoArchivoVistaPreviaRf1Schema, {
  minItems: 1,
  maxItems: 100,
  description: 'Un resultado por archivo XML admitido, sin persistir el archivo original.',
});

/** Tipo de respuesta HTTP con resultados por CFDI en el lote de lectura. */
export type ResultadosVistaPreviaRf1Contrato = Static<typeof resultadosVistaPreviaRf1Schema>;

/** Respuesta del endpoint de vista previa con disponibilidad explícita de ejecución. */
export const respuestaVistaPreviaRf1Schema = Type.Object(
  {
    resultados: resultadosVistaPreviaRf1Schema,
    executionAvailable: Type.Boolean(),
    confirmationToken: Type.Union([Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' }), Type.Null()]),
  },
  {
    additionalProperties: false,
    description: 'Vista previa sin caché y confirmación opaca opcional de un solo uso.',
  },
);

/** Tipo de respuesta HTTP de preview y disponibilidad de inserción. */
export type RespuestaVistaPreviaRf1Contrato = Static<typeof respuestaVistaPreviaRf1Schema>;

/** Resultado permitido de ejecución por factura, sin detalles del conector ni credenciales. */
export const resultadoInsercionRf1Schema = Type.Object(
  {
    status: Type.Union([
      Type.Literal('INSERTADA_VERIFICADA'),
      Type.Literal('YA_EXISTE'),
      Type.Literal('RECHAZADA'),
      Type.Literal('ERROR_REVERTIDO'),
      Type.Literal('INDETERMINADO'),
    ]),
    errorCode: Type.Optional(Type.String({ pattern: '^RF1_[A-Z0-9_]{1,64}$' })),
  },
  { additionalProperties: false },
);

/** Colección de estados individuales devueltos tras solicitar ejecución RF-1. */
export const resultadosInsercionRf1Schema = Type.Array(resultadoInsercionRf1Schema, {
  minItems: 1,
  maxItems: 100,
});

/** Tipo de un resultado de inserción por factura. */
export type ResultadoInsercionRf1Contrato = Static<typeof resultadoInsercionRf1Schema>;

/** Tipo de lista de resultados de inserción RF-1. */
export type ResultadosInsercionRf1Contrato = Static<typeof resultadosInsercionRf1Schema>;

/** Tipo de entrada de escritura de una capacidad por cliente. */
export type SolicitudEstablecerCapacidadCliente = Static<typeof establecerCapacidadClienteSchema>;

/** Parámetros validados de una operación sobre capacidades del cliente. */
export const capacidadClienteParamsSchema = Type.Object(
  {
    clientId: Type.String({ pattern: PATRON_UUID_CLIENTE }),
    capabilityId: capacidadClienteSchema,
  },
  { additionalProperties: false },
);

/** Tipo de parámetros de ruta para una capacidad de cliente. */
export type ParametrosCapacidadCliente = Static<typeof capacidadClienteParamsSchema>;
