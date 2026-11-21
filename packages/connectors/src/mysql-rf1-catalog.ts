import type {
  SesionLecturaRf1,
  SociedadLecturaRf1,
} from '../../core/src/clients/secret-custody-ports.js';

/** Consulta preparada fija permitida dentro de una sesión de lectura RF-1. */
export type ConsultaFijaRf1 =
  | 'SELECT sociedad, ambienteSap FROM sap_sociedad WHERE rfc = ? LIMIT 101'
  | 'SELECT idProveedor FROM sap_proveedor WHERE rfc = ? AND sociedad = ? AND ambienteSap = ? LIMIT 2'
  | 'SELECT 1 AS encontrado FROM factura WHERE uuid = ? LIMIT 1';

/** Ejecuta únicamente uno de los SELECT RF-1 permitidos con parámetros ligados. */
export interface EjecutorLecturaMysqlRf1 {
  /**
   * Envía una consulta autorizada y nunca interpola valores en el SQL.
   * @param consulta Identificador SQL constante de RF-1.
   * @param parametros Valores que el driver liga como parámetros preparados.
   * @returns Filas limitadas del resultado MySQL.
   */
  ejecutar(consulta: ConsultaFijaRf1, parametros: readonly string[]): Promise<readonly unknown[]>;
}

const SQL_SOCIEDADES: ConsultaFijaRf1 =
  'SELECT sociedad, ambienteSap FROM sap_sociedad WHERE rfc = ? LIMIT 101';
const SQL_PROVEEDORES: ConsultaFijaRf1 =
  'SELECT idProveedor FROM sap_proveedor WHERE rfc = ? AND sociedad = ? AND ambienteSap = ? LIMIT 2';
const SQL_UUID: ConsultaFijaRf1 = 'SELECT 1 AS encontrado FROM factura WHERE uuid = ? LIMIT 1';
const RFC_VALIDO = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/u;
const UUID_VALIDO = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

/** Adapta consultas fijas a una sesión tipada y de duración limitada. */
export class SesionMysqlRf1 implements SesionLecturaRf1 {
  private cerrada = false;
  private ocupada = false;

  /**
   * Crea la sesión con ejecutor privado, cierre idempotente y cancelación compartida.
   * @param ejecutor Adaptador interno de SQL preparado y allowlisted.
   * @param cerrarConexion Cierre de conexión y recursos asociados.
   * @param senal Cancelación que controla la vida de la conexión.
   * @param tiempoMaximoMs Timeout máximo de cada consulta.
   * @param cancelar Aborto del socket ante timeout de una consulta.
   * @throws Error si el timeout no está dentro del rango permitido.
   */
  public constructor(
    private readonly ejecutor: EjecutorLecturaMysqlRf1,
    private readonly cerrarConexion: () => Promise<void>,
    private readonly senal: AbortSignal,
    private readonly tiempoMaximoMs: number,
    private readonly cancelar: () => void = () => undefined,
  ) {
    if (!Number.isSafeInteger(tiempoMaximoMs) || tiempoMaximoMs < 1 || tiempoMaximoMs > 15_000) {
      throw new Error('RF1_SESSION_POLICY_INVALID');
    }
    this.senal.addEventListener('abort', this.alAbortar, { once: true });
  }

  /**
   * Busca sociedades con RFC normalizado y límite explícito para evitar truncamiento silencioso.
   * @param rfcReceptor RFC del receptor del CFDI.
   * @returns Hasta cien sociedades con su ambiente SAP.
   * @throws Error con código estable ante RFC inválido, exceso o resultado mal formado.
   */
  public async buscarSociedadesPorRfc(rfcReceptor: string): Promise<readonly SociedadLecturaRf1[]> {
    const rfc = normalizarRfc(rfcReceptor);
    const filas = await this.consultar(SQL_SOCIEDADES, [rfc]);
    if (filas.length > 100) {
      throw new Error('RF1_CATALOG_RESULT_LIMIT');
    }
    return filas.map(leerSociedad);
  }

  /**
   * Busca proveedores por RFC emisor y el contexto SAP completo, sin filtros implícitos.
   * @param rfcEmisor RFC del emisor del CFDI.
   * @param sociedad Sociedad SAP seleccionada.
   * @param ambienteSap Ambiente vinculado a la sociedad.
   * @returns Cero, uno o dos proveedores para resolver duplicidad.
   * @throws Error con código estable ante parámetros inválidos o resultado mal formado.
   */
  public async buscarProveedoresPorContexto(
    rfcEmisor: string,
    sociedad: string,
    ambienteSap: string,
  ): Promise<readonly { readonly idProveedor: string }[]> {
    const rfc = normalizarRfc(rfcEmisor);
    const sociedadNormalizada = normalizarCodigo(sociedad, 4);
    const ambienteNormalizado = normalizarCodigo(ambienteSap, 3);
    const filas = await this.consultar(SQL_PROVEEDORES, [
      rfc,
      sociedadNormalizada,
      ambienteNormalizado,
    ]);
    if (filas.length > 2) {
      throw new Error('RF1_CATALOG_RESULT_LIMIT');
    }
    return filas.map(leerProveedor);
  }

  /**
   * Busca únicamente la existencia del UUID y nunca carga datos de la factura.
   * @param uuid UUID fiscal que se comparará.
   * @returns `true` si el identificador ya existe.
   * @throws Error con código estable si el UUID o el resultado no es válido.
   */
  public async existeUuid(uuid: string): Promise<boolean> {
    const normalizado = uuid.trim().toUpperCase();
    if (!UUID_VALIDO.test(normalizado)) {
      throw new Error('RF1_CATALOG_INPUT_INVALID');
    }
    const filas = await this.consultar(SQL_UUID, [normalizado]);
    return filas.length > 0;
  }

  /**
   * Cierra idempotentemente la conexión y desregistra la cancelación.
   * @returns Promesa que termina cuando se liberan los recursos.
   */
  public async cerrar(): Promise<void> {
    if (this.cerrada) {
      return;
    }
    this.cerrada = true;
    this.senal.removeEventListener('abort', this.alAbortar);
    await this.cerrarConexion();
  }

  /**
   * Valida el estado, serializa consultas y transforma fallos del driver en códigos estables.
   * @param consulta SQL constante seleccionado por un método semántico.
   * @param parametros Parámetros preparados asociados a la consulta.
   * @returns Filas limitadas de la consulta.
   * @throws Error sanitizado por sesión cerrada, cancelación, timeout o fallo de consulta.
   */
  private async consultar(
    consulta: ConsultaFijaRf1,
    parametros: readonly string[],
  ): Promise<readonly unknown[]> {
    this.exigirSesionDisponible();
    if (this.ocupada) {
      throw new Error('RF1_SESSION_BUSY');
    }
    this.ocupada = true;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      const vencimiento = new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => {
          this.cancelar();
          rechazar(new Error('RF1_QUERY_TIMEOUT'));
        }, this.tiempoMaximoMs);
      });
      return await Promise.race([this.ejecutor.ejecutar(consulta, parametros), vencimiento]);
    } catch (error: unknown) {
      const codigo = codigoSesion(error, this.senal.aborted);
      if (codigo === 'RF1_QUERY_TIMEOUT' || codigo === 'RF1_SESSION_ABORTED') {
        throw new Error(codigo);
      }
      throw new Error('RF1_QUERY_FAILED');
    } finally {
      if (temporizador !== undefined) {
        clearTimeout(temporizador);
      }
      this.ocupada = false;
    }
  }

  /** Rechaza consultas posteriores a cierre o cancelación externa. */
  private exigirSesionDisponible(): void {
    if (this.senal.aborted) {
      throw new Error('RF1_SESSION_ABORTED');
    }
    if (this.cerrada) {
      throw new Error('RF1_SESSION_CLOSED');
    }
  }

  /** Cierra la sesión cuando el broker cancela la conexión o vence su vida máxima. */
  private readonly alAbortar = (): void => {
    void this.cerrar().catch(() => undefined);
  };
}

/**
 * Normaliza y valida un RFC antes de ligarlo al SQL preparado.
 * @param valor RFC recibido desde el dominio o parser.
 * @returns RFC en mayúsculas y sin espacios exteriores.
 * @throws Error con código estable cuando el formato no es válido.
 */
function normalizarRfc(valor: string): string {
  const rfc = valor.trim().toUpperCase();
  if (!RFC_VALIDO.test(rfc)) {
    throw new Error('RF1_CATALOG_INPUT_INVALID');
  }
  return rfc;
}

/**
 * Normaliza códigos SAP limitados a su longitud y al alfabeto aprobado.
 * @param valor Código de sociedad o ambiente.
 * @param longitudMaxima Cantidad máxima de caracteres permitida.
 * @returns Código en mayúsculas y sin espacios exteriores.
 * @throws Error con código estable si el valor no pertenece al alfabeto permitido.
 */
function normalizarCodigo(valor: string, longitudMaxima: number): string {
  const codigo = valor.trim().toUpperCase();
  if (!new RegExp(`^[A-Z0-9]{1,${longitudMaxima}}$`, 'u').test(codigo)) {
    throw new Error('RF1_CATALOG_INPUT_INVALID');
  }
  return codigo;
}

/**
 * Valida el shape mínimo de una fila de sociedad y no conserva columnas adicionales.
 * @param valor Fila desconocida devuelta por el driver MySQL.
 * @returns Objeto reducido al código de sociedad y ambiente.
 * @throws Error con código estable si faltan valores o exceden las longitudes permitidas.
 */
function leerSociedad(valor: unknown): SociedadLecturaRf1 {
  if (
    !esRegistro(valor) ||
    typeof valor['sociedad'] !== 'string' ||
    valor['sociedad'].length < 1 ||
    valor['sociedad'].length > 4 ||
    typeof valor['ambienteSap'] !== 'string' ||
    valor['ambienteSap'].length < 1 ||
    valor['ambienteSap'].length > 3
  ) {
    throw new Error('RF1_CATALOG_RESULT_INVALID');
  }
  return { sociedad: valor['sociedad'], ambienteSap: valor['ambienteSap'] };
}

/**
 * Valida y reduce una fila de proveedor a su identificador público de catálogo.
 * @param valor Fila desconocida devuelta por el driver MySQL.
 * @returns Identificador del proveedor sin columnas adicionales.
 * @throws Error con código estable si el identificador no tiene forma válida.
 */
function leerProveedor(valor: unknown): { readonly idProveedor: string } {
  if (
    !esRegistro(valor) ||
    typeof valor['idProveedor'] !== 'string' ||
    valor['idProveedor'].length < 1 ||
    valor['idProveedor'].length > 10
  ) {
    throw new Error('RF1_CATALOG_RESULT_INVALID');
  }
  return { idProveedor: valor['idProveedor'] };
}

/**
 * Determina si el valor recibido es una fila de controlador sin columnas asumidas.
 * @param valor Valor desconocido del driver.
 * @returns Si es un objeto plano no nulo ni una lista.
 */
function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * Conserva solo errores internos estables y oculta mensajes y detalles del driver.
 * @param error Excepción original de la consulta.
 * @param cancelada Estado de cancelación compartido con el broker.
 * @returns Código sanitizado de timeout/cancelación o `undefined` para otros fallos.
 */
function codigoSesion(
  error: unknown,
  cancelada: boolean,
): 'RF1_QUERY_TIMEOUT' | 'RF1_SESSION_ABORTED' | undefined {
  if (error instanceof Error && error.message === 'RF1_QUERY_TIMEOUT') {
    return 'RF1_QUERY_TIMEOUT';
  }
  if (cancelada) {
    return 'RF1_SESSION_ABORTED';
  }
  return undefined;
}
