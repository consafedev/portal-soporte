import {
  ErrorMapeoFacturaRf1,
  mapearFacturaParaInsercionRf1,
  type EntradaMapeoFacturaRf1,
  type FilaFacturaRf1,
} from './mysql-rf1-invoice-mapper.js';

/** Sentencias estáticas permitidas por la sesión de inserción RF-1. */
export type ConsultaFacturaRf1 =
  | typeof SQL_SOCIEDADES
  | typeof SQL_PROVEEDORES
  | typeof SQL_UUID
  | typeof SQL_INSERTAR
  | typeof SQL_VERIFICAR;

/** Resultado acotado de una ejecución preparada sin mensajes del driver. */
export interface ResultadoConsultaFacturaRf1 {
  /** Filas devueltas por una lectura fija, sin forma controlable por el caller. */
  readonly rows: readonly unknown[];
  /** Filas afectadas por la sentencia fija de inserción. */
  readonly affectedRows: number;
}

/** Ejecutor de transacción MySQL que solo reconoce sentencias RF-1 enumeradas. */
export interface EjecutorTransaccionFacturaRf1 {
  /** Inicia una transacción InnoDB individual para la factura actual. */
  iniciarTransaccion(): Promise<void>;
  /** Ejecuta una sentencia fija RF-1 con parámetros ligados. */
  ejecutar(
    consulta: ConsultaFacturaRf1,
    parametros: readonly (string | null)[],
  ): Promise<ResultadoConsultaFacturaRf1>;
  /** Confirma la única factura de la transacción actual. */
  confirmarTransaccion(): Promise<void>;
  /** Revierte la transacción activa. */
  revertirTransaccion(): Promise<void>;
  /** Aborta el socket cuando vence la operación o se cancela la solicitud. */
  abortar(): void;
  /** Cierra la sesión MySQL y libera sus recursos. */
  cerrar(): Promise<void>;
}

/** Resultado individual de una operación de inserción RF-1. */
export interface ResultadoInsercionFacturaRf1 {
  /** Estado verificable sin incluir errores del driver ni contenido fiscal. */
  readonly status:
    'INSERTADA_VERIFICADA' | 'YA_EXISTE' | 'RECHAZADA' | 'ERROR_REVERTIDO' | 'INDETERMINADO';
  /** Código estable para describir un rechazo controlado. */
  readonly errorCode?:
    | 'RF1_CONTEXT_MISMATCH'
    | 'RF1_CATALOG_UNAVAILABLE'
    | 'RF1_SUPPLIER_NOT_FOUND'
    | 'RF1_SUPPLIER_AMBIGUOUS'
    | 'RF1_INSERT_MAPPING_INVALID'
    | 'RF1_INSERT_DECIMAL_SCALE_UNSUPPORTED'
    | 'RF1_SESSION_BUSY';
}

const SQL_SOCIEDADES =
  'SELECT sociedad, ambienteSap FROM sap_sociedad WHERE rfc = ? LIMIT 101' as const;
const SQL_PROVEEDORES =
  'SELECT idProveedor FROM sap_proveedor WHERE rfc = ? AND sociedad = ? AND ambienteSap = ? LIMIT 2' as const;
const SQL_UUID = 'SELECT 1 AS encontrado FROM factura WHERE uuid = ? LIMIT 1' as const;
const SQL_INSERTAR =
  'INSERT INTO factura (uuid, nodocumentocontable, ejercicio, rfcReceptor, rfcEmisor, folio, serie, fecha, monedaFAC, totalFAC, subtotalFAC, importeIvaFAC, rutaXml, rutaPdf, estatus, version, fechaCarga, nea, tipoComprobante, metododepago, formadepago, numctapago, referencia, nodocumentopago, noa, creadoPor, nodocumentologistico, sociedad, retencionIsr, retencionIva, retencionIeps, moduloOrigen, detraccion_pe) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)' as const;
const SQL_VERIFICAR =
  'SELECT uuid, sociedad, estatus, totalFAC, creadoPor FROM factura WHERE uuid = ? LIMIT 1' as const;
const NUMERO_PARAMETROS_INSERT = 33;

/** Comprueba que SQL y aridad pertenezcan al conjunto estático de escritura RF-1. */
export function esConsultaFacturaRf1Permitida(
  consulta: string,
  cantidadParametros: number,
): consulta is ConsultaFacturaRf1 {
  return (
    (consulta === SQL_SOCIEDADES && cantidadParametros === 1) ||
    (consulta === SQL_PROVEEDORES && cantidadParametros === 3) ||
    (consulta === SQL_UUID && cantidadParametros === 1) ||
    (consulta === SQL_INSERTAR && cantidadParametros === NUMERO_PARAMETROS_INSERT) ||
    (consulta === SQL_VERIFICAR && cantidadParametros === 1)
  );
}

/** Ejecuta una sola factura con revalidación SAP, transacción y verificación posterior. */
export class SesionInsercionMysqlRf1 {
  private ocupado = false;
  private cerrada = false;
  private readonly tiempoMaximoConsultaMs: number;

  /** Crea una sesión fija para una conexión/perfil; no acepta SQL, host ni tabla variables. */
  public constructor(
    private readonly ejecutor: EjecutorTransaccionFacturaRf1,
    tiempoMaximoConsultaMs: number = 5_000,
  ) {
    if (
      !Number.isSafeInteger(tiempoMaximoConsultaMs) ||
      tiempoMaximoConsultaMs < 1 ||
      tiempoMaximoConsultaMs > 15_000
    ) {
      throw new Error('RF1_INSERT_POLICY_INVALID');
    }
    this.tiempoMaximoConsultaMs = tiempoMaximoConsultaMs;
  }

  /** Revalida catálogo/UUID e inserta una factura, con un único resultado por llamada. */
  public async insertar(entrada: EntradaMapeoFacturaRf1): Promise<ResultadoInsercionFacturaRf1> {
    if (this.cerrada) {
      return { status: 'RECHAZADA', errorCode: 'RF1_CATALOG_UNAVAILABLE' };
    }
    if (this.ocupado) {
      return { status: 'RECHAZADA', errorCode: 'RF1_SESSION_BUSY' };
    }

    let fila: FilaFacturaRf1;
    try {
      fila = mapearFacturaParaInsercionRf1(entrada);
    } catch (error: unknown) {
      return {
        status: 'RECHAZADA',
        errorCode:
          error instanceof ErrorMapeoFacturaRf1 && error.code === 'DECIMAL_SCALE_UNSUPPORTED'
            ? 'RF1_INSERT_DECIMAL_SCALE_UNSUPPORTED'
            : 'RF1_INSERT_MAPPING_INVALID',
      };
    }

    this.ocupado = true;
    try {
      let transaccionActiva = false;
      let insertarIniciado = false;
      let commitIniciado = false;
      try {
        await this.ejecutor.iniciarTransaccion();
        transaccionActiva = true;
        const contextoValido = await this.revalidarContexto(entrada);
        if (contextoValido !== null) {
          const rollbackCorrecto = await this.revertirSeguro();
          transaccionActiva = false;
          return rollbackCorrecto
            ? { status: 'RECHAZADA', errorCode: contextoValido }
            : { status: 'INDETERMINADO' };
        }

        const duplicado = await this.ejecutar(SQL_UUID, [fila.uuid]);
        if (duplicado.rows.length > 0) {
          const rollbackCorrecto = await this.revertirSeguro();
          transaccionActiva = false;
          return rollbackCorrecto ? { status: 'YA_EXISTE' } : { status: 'INDETERMINADO' };
        }

        insertarIniciado = true;
        const insercion = await this.ejecutar(SQL_INSERTAR, parametrosFila(fila));
        if (insercion.affectedRows !== 1) {
          throw new Error('RF1_INSERT_AFFECTED_ROWS_INVALID');
        }
        commitIniciado = true;
        await this.ejecutor.confirmarTransaccion();
        transaccionActiva = false;
      } catch (error: unknown) {
        if (commitIniciado) {
          await this.revertirSeguro();
          return { status: 'INDETERMINADO' };
        }
        if (!transaccionActiva) {
          return insertarIniciado
            ? { status: 'INDETERMINADO' }
            : { status: 'RECHAZADA', errorCode: 'RF1_CATALOG_UNAVAILABLE' };
        }
        const duplicado = codigoMySql(error) === 'ER_DUP_ENTRY';
        const rollbackCorrecto = await this.revertirSeguro();
        transaccionActiva = false;
        if (!rollbackCorrecto) {
          return { status: 'INDETERMINADO' };
        }
        if (duplicado) {
          return { status: 'YA_EXISTE' };
        }
        return insertarIniciado
          ? { status: 'ERROR_REVERTIDO' }
          : { status: 'RECHAZADA', errorCode: 'RF1_CATALOG_UNAVAILABLE' };
      }

      try {
        const verificacion = await this.ejecutar(SQL_VERIFICAR, [fila.uuid]);
        const filaVerificada = verificacion.rows[0];
        if (filaVerificada !== undefined && coincideFacturaVerificada(filaVerificada, fila)) {
          return { status: 'INSERTADA_VERIFICADA' };
        }
        return { status: 'INDETERMINADO' };
      } catch {
        return { status: 'INDETERMINADO' };
      }
    } finally {
      this.ocupado = false;
    }
  }

  /** Cierra la sesión de forma idempotente y borra cualquier transacción pendiente. */
  public async cerrar(): Promise<void> {
    if (this.cerrada) {
      return;
    }
    this.cerrada = true;
    await this.ejecutor.cerrar().catch(() => undefined);
  }

  /** Comprueba la sociedad y el proveedor exactos en el contexto usado por la vista previa. */
  private async revalidarContexto(
    entrada: EntradaMapeoFacturaRf1,
  ): Promise<ResultadoInsercionFacturaRf1['errorCode'] | null> {
    const sociedades = await this.ejecutar(SQL_SOCIEDADES, [entrada.factura.rfcReceptor]);
    if (sociedades.rows.length === 0 || sociedades.rows.length > 100) {
      return 'RF1_CONTEXT_MISMATCH';
    }
    const sociedadesUnicas = new Set<string>();
    for (const valor of sociedades.rows) {
      const sociedad = leerTexto(valor, 'sociedad');
      const ambienteSap = leerTexto(valor, 'ambienteSap');
      if (sociedad === null || ambienteSap === null) {
        return 'RF1_CATALOG_UNAVAILABLE';
      }
      const llave = `${sociedad}\u0000${ambienteSap}`;
      if (sociedadesUnicas.has(llave)) {
        return 'RF1_CONTEXT_MISMATCH';
      }
      sociedadesUnicas.add(llave);
    }
    const contexto = entrada.resolution;
    if (!sociedadesUnicas.has(`${contexto.sociedad}\u0000${contexto.ambienteSap}`)) {
      return 'RF1_CONTEXT_MISMATCH';
    }

    const proveedores = await this.ejecutar(SQL_PROVEEDORES, [
      entrada.factura.rfcEmisor,
      contexto.sociedad,
      contexto.ambienteSap,
    ]);
    if (proveedores.rows.length === 0) {
      return 'RF1_SUPPLIER_NOT_FOUND';
    }
    if (proveedores.rows.length !== 1) {
      return 'RF1_SUPPLIER_AMBIGUOUS';
    }
    return leerTexto(proveedores.rows[0], 'idProveedor') === contexto.idProveedor
      ? null
      : 'RF1_CONTEXT_MISMATCH';
  }

  /** Ejecuta una sentencia preparada con un timeout acotado y cancela el socket al vencer. */
  private async ejecutar(
    consulta: ConsultaFacturaRf1,
    parametros: readonly (string | null)[],
  ): Promise<ResultadoConsultaFacturaRf1> {
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      const vencimiento = new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => {
          this.ejecutor.abortar();
          rechazar(new Error('RF1_WRITE_QUERY_TIMEOUT'));
        }, this.tiempoMaximoConsultaMs);
      });
      return await Promise.race([this.ejecutor.ejecutar(consulta, parametros), vencimiento]);
    } finally {
      if (temporizador !== undefined) {
        clearTimeout(temporizador);
      }
    }
  }

  /** Intenta rollback y devuelve solo si el driver confirmó que la transacción terminó. */
  private async revertirSeguro(): Promise<boolean> {
    try {
      await this.ejecutor.revertirTransaccion();
      return true;
    } catch {
      return false;
    }
  }
}

/** Construye los 33 parámetros en el mismo orden que la sentencia estática. */
function parametrosFila(fila: FilaFacturaRf1): readonly (string | null)[] {
  return [
    fila.uuid,
    fila.nodocumentocontable,
    fila.ejercicio,
    fila.rfcReceptor,
    fila.rfcEmisor,
    fila.folio,
    fila.serie,
    fila.fecha,
    fila.monedaFAC,
    fila.totalFAC,
    fila.subtotalFAC,
    fila.importeIvaFAC,
    fila.rutaXml,
    fila.rutaPdf,
    fila.estatus,
    fila.version,
    fila.fechaCarga,
    fila.nea,
    fila.tipoComprobante,
    fila.metododepago,
    fila.formadepago,
    fila.numctapago,
    fila.referencia,
    fila.nodocumentopago,
    fila.noa,
    fila.creadoPor,
    fila.nodocumentologistico,
    fila.sociedad,
    fila.retencionIsr,
    fila.retencionIva,
    fila.retencionIeps,
    fila.moduloOrigen,
    fila.detraccion_pe,
  ];
}

/** Comprueba la forma mínima del resultado sin convertir tipos desconocidos. */
function leerTexto(fila: unknown, propiedad: string): string | null {
  if (typeof fila !== 'object' || fila === null || !Object.hasOwn(fila, propiedad)) {
    return null;
  }
  const valor = (fila as Record<string, unknown>)[propiedad];
  return typeof valor === 'string' ? valor : null;
}

/** Compara únicamente campos de verificación del UUID, sin devolver la fila fiscal. */
function coincideFacturaVerificada(fila: unknown, esperado: FilaFacturaRf1): boolean {
  if (typeof fila !== 'object' || fila === null) {
    return false;
  }
  const valores = fila as Record<string, unknown>;
  return (
    valores['uuid'] === esperado.uuid &&
    valores['sociedad'] === esperado.sociedad &&
    valores['estatus'] === esperado.estatus &&
    String(valores['totalFAC']) === esperado.totalFAC &&
    valores['creadoPor'] === esperado.creadoPor
  );
}

/** Obtiene solo el código conocido necesario para clasificar la colisión de UUID. */
function codigoMySql(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  return typeof error.code === 'string' ? error.code : null;
}

/** Distingue el commit ambiguo para evitar afirmar rollback o reintentar a ciegas. */
