import type { RelojAuth, EscritorAuditoriaAuth } from '../../../../packages/core/src/auth/ports.js';
import type { ActorAccesoCliente } from '../../../../packages/core/src/clients/client-access-ports.js';
import type { ServicioAccesoCliente } from './client-access-service.js';
import { ErrorAccesoCliente } from './client-access-service.js';
import { ErrorPerfilesConexion, ServicioPerfilesConexion } from './connection-profile-service.js';
import { CatalogoLecturaRf1DesdeBroker } from './mysql-rf1-catalog.js';
import {
  generarVistaPreviaLote,
  type CatalogoLecturaRf1,
  type SolicitudVistaPreviaRf1,
  type VistaPreviaCfdiRf1,
} from '../../../../modules/rf-1/src/preview.js';
import type { SesionLecturaRf1 } from '../../../../packages/core/src/clients/secret-custody-ports.js';
import type {
  DocumentosFacturaRf1Contrato,
  SeleccionSociedadArchivoRf1Contrato,
} from '../../../../packages/contracts/src/clients.js';

/** Identidad de solicitud autenticada que debe revalidarse contra el estado PostgreSQL actual. */
export interface ActorVistaPreviaRf1 extends ActorAccesoCliente {
  /** UUID de usuario leído desde la sesión vigente. */
  readonly actorUserId: string;
  /** ID de correlación generado por Fastify para las auditorías de esta solicitud. */
  readonly requestId: string;
}

/** Entrada autorizada de archivos XML y contexto mínimo para crear una vista previa. */
export interface SolicitudServicioVistaPreviaRf1 {
  /** Identidad actual del usuario y solicitud autenticados. */
  readonly actor: ActorVistaPreviaRf1;
  /** Cliente cuyo permiso `rf-1:read` debe seguir vigente. */
  readonly clientId: string;
  /** Perfil activo perteneciente al cliente solicitado. */
  readonly profileId: string;
  /** Estatus funcional que se presentará, sin insertar factura. */
  readonly estatus: 'CONTABILIZADO' | 'PAGADA';
  /** Bytes de los CFDI originales recibidos en memoria y no persistidos. */
  readonly archivos: readonly Uint8Array[];
  /** Selecciones de catálogo por índice de archivo, validadas otra vez por el dominio. */
  readonly seleccionesSociedad?: readonly SeleccionSociedadArchivoRf1Contrato[];
  /** Referencias opcionales por CFDI, conservadas solo para la confirmación de inserción. */
  readonly documentos?: readonly DocumentosFacturaRf1Contrato[];
  /** Señal para cancelar el broker cuando vence o se cierra la petición. */
  readonly senal: AbortSignal;
}

/** Revalida acceso y perfil antes de leer el cuerpo y antes de abrir cualquier secreto. */
export class ServicioVistaPreviaRf1 {
  /** Compone los guards actuales, el catálogo de perfiles redactado y la auditoría del Portal. */
  public constructor(
    private readonly acceso: ServicioAccesoCliente,
    private readonly perfiles: ServicioPerfilesConexion,
    private readonly auditoria: EscritorAuditoriaAuth,
    private readonly reloj: RelojAuth,
  ) {}

  /** Comprueba cliente, asignación/capacidad y perfil activo antes de procesar el XML. */
  public async preautorizar(
    actor: ActorVistaPreviaRf1,
    clientId: string,
    profileId: string,
  ): Promise<void> {
    try {
      await this.acceso.exigir(actor, clientId, 'rf-1:read');
      const perfiles = await this.perfiles.listar(clientId);
      const perteneceYEstaActivo = perfiles.some(
        (perfil) =>
          perfil.id === profileId && perfil.clientId === clientId && perfil.estado === 'ACTIVE',
      );
      if (!perteneceYEstaActivo) {
        throw new ErrorAccesoCliente('CLIENT_ACCESS_DENIED', 403);
      }
    } catch (error: unknown) {
      if (error instanceof ErrorAccesoCliente && error.statusCode === 403) {
        await this.auditarDenegacion(actor, clientId);
      }
      throw error;
    }
  }

  /** Abre una sesión de solo lectura, ejecuta el parser RF-1 y cierra/audita el resultado. */
  public async ejecutar(
    solicitud: SolicitudServicioVistaPreviaRf1,
  ): Promise<readonly VistaPreviaCfdiRf1[]> {
    const { actor, clientId, profileId, senal } = solicitud;
    await this.preautorizar(actor, clientId, profileId);

    let sesion: SesionLecturaRf1;
    try {
      sesion = await this.perfiles.abrirLecturaRf1(clientId, profileId, senal);
    } catch (error: unknown) {
      if (error instanceof ErrorPerfilesConexion && error.code === 'PROFILE_NOT_FOUND') {
        await this.auditarDenegacion(actor, clientId);
        throw new ErrorAccesoCliente('CLIENT_ACCESS_DENIED', 403);
      }
      if (error instanceof ErrorPerfilesConexion) {
        await this.auditarFallo(actor, clientId, profileId, error.code);
      }
      throw error;
    }

    let resultados: readonly VistaPreviaCfdiRf1[];
    try {
      const catalogo = new CatalogoConUuidUnico(new CatalogoLecturaRf1DesdeBroker(sesion));
      const seleccionesPorArchivo = new Map(
        (solicitud.seleccionesSociedad ?? []).map((seleccion) => [
          seleccion.indiceArchivo,
          seleccion,
        ]),
      );
      const solicitudes: SolicitudVistaPreviaRf1[] = solicitud.archivos.map((xml, indice) => {
        const seleccion = seleccionesPorArchivo.get(indice);
        return {
          xml,
          estatus: solicitud.estatus,
          ...(seleccion === undefined
            ? {}
            : { sociedad: seleccion.sociedad, ambienteSap: seleccion.ambienteSap }),
        };
      });
      resultados = await generarVistaPreviaLote(solicitudes, catalogo);
    } finally {
      await sesion.cerrar().catch(() => {
        throw new ErrorPerfilesConexion('CONNECTION_FAILED', 502);
      });
    }

    await this.auditarResultado(actor, clientId, profileId, resultados);
    return resultados;
  }

  /** Registra un rechazo uniforme sin agregar identificadores de perfiles ni cuerpo recibido. */
  private async auditarDenegacion(actor: ActorVistaPreviaRf1, clientId: string): Promise<void> {
    await this.auditoria.registrar({
      actorUserId: actor.actorUserId,
      action: 'RF1_PREVIEW_DENIED',
      targetUserId: null,
      outcome: 'DENIED',
      metadata: { clientId, operation: 'rf-1:read', requestId: actor.requestId },
      createdAt: this.reloj.ahora(),
    });
  }

  /** Audita fallo de broker con un código estable y sin mensaje de driver o secretos. */
  private async auditarFallo(
    actor: ActorVistaPreviaRf1,
    clientId: string,
    profileId: string,
    code: string,
  ): Promise<void> {
    await this.auditoria.registrar({
      actorUserId: actor.actorUserId,
      action: 'RF1_PREVIEW_FAILED',
      targetUserId: null,
      outcome: 'FAILURE',
      metadata: { clientId, profileId, resultCode: code, requestId: actor.requestId },
      createdAt: this.reloj.ahora(),
    });
  }

  /** Audita solamente conteos de resultados y códigos, nunca los XML ni sus campos fiscales. */
  private async auditarResultado(
    actor: ActorVistaPreviaRf1,
    clientId: string,
    profileId: string,
    resultados: readonly VistaPreviaCfdiRf1[],
  ): Promise<void> {
    const fallaronConsultas = resultados.some(
      (resultado) => resultado.errorCode === 'RF1_CATALOG_UNAVAILABLE',
    );
    await this.auditoria.registrar({
      actorUserId: actor.actorUserId,
      action: 'RF1_PREVIEW_COMPLETED',
      targetUserId: null,
      outcome: fallaronConsultas ? 'FAILURE' : 'SUCCESS',
      metadata: {
        clientId,
        profileId,
        fileCount: resultados.length,
        readyCount: resultados.filter((resultado) => resultado.status === 'READY').length,
        selectionCount: resultados.filter((resultado) => resultado.status === 'NEEDS_SELECTION')
          .length,
        blockedCount: resultados.filter((resultado) => resultado.status === 'BLOCKED').length,
        resultCode: fallaronConsultas ? 'RF1_CATALOG_UNAVAILABLE' : 'PREVIEW_COMPLETED',
        requestId: actor.requestId,
      },
      createdAt: this.reloj.ahora(),
    });
  }
}

/** Impide que dos archivos del mismo lote se presenten ambos como UUID aún no existente. */
class CatalogoConUuidUnico implements CatalogoLecturaRf1 {
  private readonly uuidsConsultados = new Set<string>();

  /** Conserva el catálogo tipado del broker y aplica unicidad temporal para la solicitud. */
  public constructor(private readonly catalogo: CatalogoLecturaRf1) {}

  /** Delega la consulta limitada de sociedades sin alterar el contexto SAP. */
  public buscarSociedadesPorRfc(rfcReceptor: string) {
    return this.catalogo.buscarSociedadesPorRfc(rfcReceptor);
  }

  /** Delega la lectura de proveedor con RFC, sociedad y ambiente SAP preparados. */
  public buscarProveedoresPorContexto(rfcEmisor: string, sociedad: string, ambienteSap: string) {
    return this.catalogo.buscarProveedoresPorContexto(rfcEmisor, sociedad, ambienteSap);
  }

  /** Consulta el UUID en destino y rechaza repeticiones dentro del mismo lote. */
  public async existeUuid(uuid: string): Promise<boolean> {
    if (this.uuidsConsultados.has(uuid)) {
      return true;
    }
    const yaExiste = await this.catalogo.existeUuid(uuid);
    if (!yaExiste) {
      this.uuidsConsultados.add(uuid);
    }
    return yaExiste;
  }
}
