'use client';

import { useState, type ChangeEvent, type FormEvent, type JSX, type SyntheticEvent } from 'react';
import type {
  CredencialesMySqlAdmin,
  EntornoPerfilConexionAdmin,
  PerfilConexionAdminContrato,
  ResultadoPruebaPerfilAdminContrato,
  SolicitudActualizarPerfilConexionAdmin,
  SolicitudCrearPerfilConexionAdmin,
} from '@portal-soporte/contracts/clients';
import {
  actualizarPerfilConexionAdmin,
  crearPerfilConexionAdmin,
  listarPerfilesConexionAdmin,
  probarPerfilConexionAdmin,
  reemplazarCredencialesPerfilAdmin,
} from '../../lib/client-admin-api';

type TipoPerfil = SolicitudCrearPerfilConexionAdmin['tipo'];

interface ValoresCredenciales {
  /** Usuario MySQL que se cifra y no vuelve a exponerse. */
  readonly mysqlUsername: string;
  /** Contraseña MySQL temporal de alta o reemplazo. */
  readonly mysqlPassword: string;
  /** Autoridad certificadora opcional para TLS MySQL. */
  readonly tlsCa: string;
  /** Certificado cliente opcional, emparejado con la llave cliente. */
  readonly tlsCert: string;
  /** Llave privada TLS cliente temporal. */
  readonly tlsKey: string;
  /** Cuenta del gateway SSH. */
  readonly sshUsername: string;
  /** Modalidad de autenticación SSH seleccionada para el gateway. */
  readonly sshAuthentication: 'PRIVATE_KEY' | 'PASSWORD';
  /** Llave privada PEM/OpenSSH o PPK v2 RSA temporal. */
  readonly sshPrivateKey: string;
  /** Nombre local del archivo SSH seleccionado; nunca contiene su material. */
  readonly sshKeyFileName: string;
  /** Passphrase opcional de la llave privada SSH. */
  readonly sshPassphrase: string;
  /** Contraseña SSH temporal para el modo compatible con Workbench. */
  readonly sshPassword: string;
}

const CREDENCIALES_VACIAS: ValoresCredenciales = {
  mysqlUsername: '',
  mysqlPassword: '',
  tlsCa: '',
  tlsCert: '',
  tlsKey: '',
  sshUsername: '',
  sshAuthentication: 'PRIVATE_KEY',
  sshPrivateKey: '',
  sshKeyFileName: '',
  sshPassphrase: '',
  sshPassword: '',
};

/** Propiedades para administrar conexiones dentro del contexto de un cliente. */
interface PropiedadesAdministracionPerfiles {
  /** Identificador estable del cliente al que pertenecen los perfiles. */
  readonly clientId: string;
  /** Impide sondear conexiones cuando el cliente está desactivado. */
  readonly clienteActivo: boolean;
}

/** Administra perfiles y prueba conexión con respuestas redactadas para ADMIN. */
export function AdministracionPerfilesConexion({
  clientId,
  clienteActivo,
}: PropiedadesAdministracionPerfiles): JSX.Element {
  const [perfiles, setPerfiles] = useState<readonly PerfilConexionAdminContrato[]>([]);
  const [cargados, setCargados] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [perfilOcupado, setPerfilOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<TipoPerfil>('MYSQL_TCP');
  const [entorno, setEntorno] = useState<EntornoPerfilConexionAdmin>('TEST');
  const [destino, setDestino] = useState('');
  const [gateway, setGateway] = useState('');
  const [baseDatos, setBaseDatos] = useState('');
  const [credenciales, setCredenciales] = useState<ValoresCredenciales>(CREDENCIALES_VACIAS);

  /** Carga solo los metadatos redactados y se usa al abrir o actualizar el panel. */
  async function cargarPerfiles(): Promise<void> {
    setCargando(true);
    setError(null);
    try {
      setPerfiles(await listarPerfilesConexionAdmin(clientId));
      setCargados(true);
    } catch (rechazo: unknown) {
      setError(mensajeError(rechazo));
    } finally {
      setCargando(false);
    }
  }

  /** Evita consultas innecesarias mientras el panel de perfiles permanece cerrado. */
  function manejarApertura(evento: SyntheticEvent<HTMLDetailsElement>): void {
    if (evento.currentTarget.open && !cargados && !cargando) {
      void cargarPerfiles();
    }
  }

  /** Limpia secretos SSH ocultos si la persona cambia el tipo a conexión directa. */
  function cambiarTipo(evento: ChangeEvent<HTMLSelectElement>): void {
    const siguiente = evento.currentTarget.value as TipoPerfil;
    setTipo(siguiente);
    if (siguiente === 'MYSQL_TCP') {
      setGateway('');
      setCredenciales((actuales) => ({
        ...actuales,
        sshUsername: '',
        sshAuthentication: 'PRIVATE_KEY',
        sshPrivateKey: '',
        sshKeyFileName: '',
        sshPassphrase: '',
        sshPassword: '',
      }));
    }
  }

  /** Valida, cifra y limpia las credenciales al completar alta o error. */
  async function crearPerfil(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      const entrada: SolicitudCrearPerfilConexionAdmin = {
        nombre,
        tipo,
        entorno,
        destinoMySqlId: destino,
        ...(tipo === 'MYSQL_SSH' ? { gatewaySshId: gateway } : {}),
        baseDatos,
        credenciales: construirCredenciales(credenciales, tipo),
      };
      await crearPerfilConexionAdmin(clientId, entrada);
      setNombre('');
      setDestino('');
      setGateway('');
      setBaseDatos('');
      await cargarPerfiles();
      setMensaje('Perfil de conexión registrado. Las credenciales no se muestran nuevamente.');
    } catch (rechazo: unknown) {
      setError(mensajeError(rechazo));
    } finally {
      setCredenciales(CREDENCIALES_VACIAS);
      setGuardando(false);
    }
  }

  /** Ejecuta el sondeo read-only y solo presenta el código controlado del backend. */
  async function probarPerfil(
    perfil: PerfilConexionAdminContrato,
  ): Promise<ResultadoPruebaPerfilAdminContrato | null> {
    setPerfilOcupado(perfil.id);
    setError(null);
    setMensaje(null);
    try {
      return await probarPerfilConexionAdmin(clientId, perfil.id);
    } catch (rechazo: unknown) {
      setError(mensajeError(rechazo));
      return null;
    } finally {
      setPerfilOcupado(null);
    }
  }

  /** Persiste metadatos allowlisted y vuelve a consultar la lista redactada. */
  async function actualizarPerfil(
    perfil: PerfilConexionAdminContrato,
    cambios: SolicitudActualizarPerfilConexionAdmin,
  ): Promise<void> {
    setPerfilOcupado(perfil.id);
    setError(null);
    setMensaje(null);
    try {
      await actualizarPerfilConexionAdmin(clientId, perfil.id, cambios);
      await cargarPerfiles();
      setMensaje('Configuración del perfil actualizada.');
    } catch (rechazo: unknown) {
      setError(mensajeError(rechazo));
    } finally {
      setPerfilOcupado(null);
    }
  }

  /** Reemplaza credenciales sin leer ni rellenar el sobre previamente almacenado. */
  async function reemplazarCredenciales(
    perfil: PerfilConexionAdminContrato,
    nuevasCredenciales: CredencialesMySqlAdmin,
  ): Promise<void> {
    setPerfilOcupado(perfil.id);
    setError(null);
    setMensaje(null);
    try {
      await reemplazarCredencialesPerfilAdmin(clientId, perfil.id, {
        credenciales: nuevasCredenciales,
      });
      setMensaje('Credenciales cifradas y sustituidas.');
    } catch (rechazo: unknown) {
      setError(mensajeError(rechazo));
    } finally {
      setPerfilOcupado(null);
    }
  }

  /** Actualiza el estado lógico del perfil sin eliminar sus referencias ni auditoría. */
  async function alternarEstado(perfil: PerfilConexionAdminContrato): Promise<void> {
    await actualizarPerfil(perfil, {
      estado: perfil.estado === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
    });
  }

  return (
    <section className="seccion-perfiles-conexion" aria-labelledby={`perfiles-${clientId}`}>
      <details onToggle={manejarApertura}>
        <summary id={`perfiles-${clientId}`}>Conexiones MySQL</summary>
        <div className="contenido-perfiles-conexion">
          <p className="texto-secundario">
            El servidor permite únicamente destinos configurados. Las pruebas ejecutan{' '}
            <code>SELECT 1</code>; nunca se muestra el usuario, la contraseña ni las llaves
            guardadas.
          </p>
          {!clienteActivo ? (
            <p className="nota-conectividad" role="status">
              El cliente está desactivado. Sus perfiles pueden consultarse, pero no se pueden
              probar.
            </p>
          ) : null}
          {error !== null ? (
            <p className="aviso-error" role="alert">
              {error}
            </p>
          ) : null}
          {mensaje !== null ? (
            <p className="aviso-exito" role="status">
              {mensaje}
            </p>
          ) : null}

          <form className="formulario formulario-perfil-conexion" onSubmit={crearPerfil}>
            <h5>Registrar perfil</h5>
            <div className="campo">
              <label htmlFor={`perfil-nombre-${clientId}`}>Nombre del perfil</label>
              <input
                id={`perfil-nombre-${clientId}`}
                minLength={2}
                maxLength={120}
                required
                value={nombre}
                onChange={(evento) => setNombre(evento.currentTarget.value)}
              />
            </div>
            <div className="campo">
              <label htmlFor={`perfil-tipo-${clientId}`}>Ruta de conexión</label>
              <select id={`perfil-tipo-${clientId}`} value={tipo} onChange={cambiarTipo}>
                <option value="MYSQL_TCP">MySQL directo</option>
                <option value="MYSQL_SSH">MySQL mediante SSH</option>
              </select>
            </div>
            <div className="campo">
              <label htmlFor={`perfil-entorno-${clientId}`}>Entorno del cliente</label>
              <select
                id={`perfil-entorno-${clientId}`}
                value={entorno}
                onChange={(evento) =>
                  setEntorno(evento.currentTarget.value as EntornoPerfilConexionAdmin)
                }
              >
                <option value="TEST">Pruebas</option>
                <option value="PRODUCTION">Producción</option>
              </select>
            </div>
            <div className="campo">
              <label htmlFor={`perfil-destino-${clientId}`}>ID de destino autorizado</label>
              <input
                id={`perfil-destino-${clientId}`}
                autoComplete="off"
                pattern="[a-z0-9][a-z0-9_-]*"
                maxLength={64}
                required
                value={destino}
                onChange={(evento) => setDestino(evento.currentTarget.value)}
              />
              <span className="ayuda-campo">
                Debe coincidir con una entrada allowlisted por operaciones en el servidor.
              </span>
            </div>
            {tipo === 'MYSQL_SSH' ? (
              <div className="campo">
                <label htmlFor={`perfil-gateway-${clientId}`}>ID de gateway SSH autorizado</label>
                <input
                  id={`perfil-gateway-${clientId}`}
                  autoComplete="off"
                  pattern="[a-z0-9][a-z0-9_-]*"
                  maxLength={64}
                  required
                  value={gateway}
                  onChange={(evento) => setGateway(evento.currentTarget.value)}
                />
              </div>
            ) : null}
            <div className="campo">
              <label htmlFor={`perfil-base-${clientId}`}>Base MySQL</label>
              <input
                id={`perfil-base-${clientId}`}
                autoComplete="off"
                pattern="[A-Za-z0-9_$-]+"
                maxLength={64}
                required
                value={baseDatos}
                onChange={(evento) => setBaseDatos(evento.currentTarget.value)}
              />
            </div>
            <CamposCredenciales
              tipo={tipo}
              valores={credenciales}
              cambiar={setCredenciales}
              sufijo={clientId}
            />
            <p className="ayuda-campo">
              El material se envía solo al servidor, se cifra antes de persistir y se elimina de
              este formulario al guardar. La custodia debe estar habilitada; si no, el servidor
              rechazará el alta.
            </p>
            <button
              className="boton-primario"
              type="submit"
              disabled={guardando}
              aria-busy={guardando}
            >
              {guardando ? 'Cifrando y guardando…' : 'Guardar perfil'}
            </button>
          </form>

          <div className="lista-perfiles-conexion" aria-live="polite">
            <h5>Perfiles registrados</h5>
            {cargando ? (
              <p className="texto-secundario" role="status">
                Cargando perfiles…
              </p>
            ) : null}
            {!cargando && cargados && perfiles.length === 0 ? (
              <p className="estado-vacio">Todavía no hay perfiles de conexión.</p>
            ) : null}
            {!cargando && !cargados ? (
              <button
                className="boton-secundario"
                type="button"
                onClick={() => void cargarPerfiles()}
              >
                Cargar perfiles
              </button>
            ) : null}
            {perfiles.map((perfil) => (
              <FilaPerfilConexion
                key={perfil.id}
                perfil={perfil}
                deshabilitado={perfilOcupado === perfil.id || guardando}
                clienteActivo={clienteActivo}
                probar={probarPerfil}
                guardar={actualizarPerfil}
                reemplazar={reemplazarCredenciales}
                alternarEstado={alternarEstado}
              />
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}

interface PropiedadesCamposCredenciales {
  /** Cambia la modalidad de SSH que determina si se solicita llave PEM. */
  readonly tipo: TipoPerfil;
  /** Valores temporales controlados; nunca se rellenan desde el API. */
  readonly valores: ValoresCredenciales;
  /** Sustituye el estado sensible al editar campos del formulario. */
  readonly cambiar: (valores: ValoresCredenciales) => void;
  /** Identificador usado para crear etiquetas y no duplicar IDs del DOM. */
  readonly sufijo: string;
}

/** Presenta los secretos de conexión solo en campos vacíos para alta o reemplazo. */
function CamposCredenciales({
  tipo,
  valores,
  cambiar,
  sufijo,
}: PropiedadesCamposCredenciales): JSX.Element {
  const [errorArchivoLlave, setErrorArchivoLlave] = useState<string | null>(null);

  /** Actualiza un campo temporal sin exponer el valor en nodos de estado ajenos. */
  function actualizar<K extends keyof ValoresCredenciales>(
    campo: K,
    valor: ValoresCredenciales[K],
  ): void {
    cambiar({ ...valores, [campo]: valor });
  }

  /** Lee una llave seleccionada sin mostrar su contenido y conserva solo su nombre visible.
   * @param evento Evento del selector local de archivos.
   * @returns Promesa resuelta cuando el archivo se leyó o se rechazó por tamaño.
   */
  async function cargarArchivoLlave(evento: ChangeEvent<HTMLInputElement>): Promise<void> {
    const selector = evento.currentTarget;
    const archivo = selector.files?.[0];
    selector.value = '';
    setErrorArchivoLlave(null);
    if (archivo === undefined) return;
    if (archivo.size === 0 || archivo.size > 16_384) {
      cambiar({ ...valores, sshPrivateKey: '', sshKeyFileName: '' });
      setErrorArchivoLlave('El archivo debe contener de 1 a 16 KiB.');
      return;
    }
    try {
      const contenido = await archivo.text();
      if (new TextEncoder().encode(contenido).byteLength > 16_384) {
        cambiar({ ...valores, sshPrivateKey: '', sshKeyFileName: '' });
        setErrorArchivoLlave('El archivo debe contener de 1 a 16 KiB.');
        return;
      }
      cambiar({ ...valores, sshPrivateKey: contenido, sshKeyFileName: archivo.name });
    } catch {
      cambiar({ ...valores, sshPrivateKey: '', sshKeyFileName: '' });
      setErrorArchivoLlave('No fue posible leer el archivo seleccionado.');
    }
  }

  /** Cambia el método de acceso y elimina inmediatamente el secreto del método anterior.
   * @param metodo Método escogido por la persona administradora.
   * @returns No devuelve valor; actualiza únicamente el estado temporal del formulario.
   */
  function cambiarAutenticacionSsh(metodo: 'PRIVATE_KEY' | 'PASSWORD'): void {
    cambiar({
      ...valores,
      sshAuthentication: metodo,
      sshPrivateKey: '',
      sshKeyFileName: '',
      sshPassphrase: '',
      sshPassword: '',
    });
    setErrorArchivoLlave(null);
  }

  return (
    <fieldset className="grupo-credenciales">
      <legend>Credenciales MySQL</legend>
      <div className="campo">
        <label htmlFor={`mysql-user-${sufijo}`}>Usuario MySQL</label>
        <input
          id={`mysql-user-${sufijo}`}
          autoComplete="off"
          required
          maxLength={128}
          value={valores.mysqlUsername}
          onChange={(evento) => actualizar('mysqlUsername', evento.currentTarget.value)}
        />
      </div>
      <div className="campo">
        <label htmlFor={`mysql-password-${sufijo}`}>Contraseña MySQL</label>
        <input
          id={`mysql-password-${sufijo}`}
          type="password"
          autoComplete="new-password"
          required
          maxLength={4096}
          value={valores.mysqlPassword}
          onChange={(evento) => actualizar('mysqlPassword', evento.currentTarget.value)}
        />
      </div>
      <div className="campo">
        <label htmlFor={`mysql-ca-${sufijo}`}>CA TLS (opcional)</label>
        <textarea
          id={`mysql-ca-${sufijo}`}
          autoComplete="off"
          maxLength={16384}
          rows={3}
          value={valores.tlsCa}
          onChange={(evento) => actualizar('tlsCa', evento.currentTarget.value)}
        />
      </div>
      <div className="campo">
        <label htmlFor={`mysql-cert-${sufijo}`}>Certificado cliente TLS (opcional)</label>
        <textarea
          id={`mysql-cert-${sufijo}`}
          autoComplete="off"
          maxLength={16384}
          rows={3}
          value={valores.tlsCert}
          onChange={(evento) => actualizar('tlsCert', evento.currentTarget.value)}
        />
      </div>
      <div className="campo">
        <label htmlFor={`mysql-key-${sufijo}`}>Llave TLS cliente (opcional)</label>
        <textarea
          id={`mysql-key-${sufijo}`}
          autoComplete="off"
          maxLength={16384}
          rows={3}
          value={valores.tlsKey}
          onChange={(evento) => actualizar('tlsKey', evento.currentTarget.value)}
        />
      </div>
      {tipo === 'MYSQL_SSH' ? (
        <>
          <p className="subtitulo-credenciales">Acceso SSH</p>
          <div className="campo">
            <label htmlFor={`ssh-user-${sufijo}`}>Usuario SSH</label>
            <input
              id={`ssh-user-${sufijo}`}
              autoComplete="off"
              required
              maxLength={128}
              value={valores.sshUsername}
              onChange={(evento) => actualizar('sshUsername', evento.currentTarget.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor={`ssh-auth-${sufijo}`}>Método de autenticación SSH</label>
            <select
              id={`ssh-auth-${sufijo}`}
              value={valores.sshAuthentication}
              onChange={(evento) =>
                cambiarAutenticacionSsh(evento.currentTarget.value as 'PRIVATE_KEY' | 'PASSWORD')
              }
            >
              <option value="PRIVATE_KEY">Llave privada</option>
              <option value="PASSWORD">Contraseña</option>
            </select>
          </div>
          {valores.sshAuthentication === 'PRIVATE_KEY' ? (
            <>
              <div className="campo">
                <label htmlFor={`ssh-key-${sufijo}`}>
                  Llave privada SSH (archivo PEM/OpenSSH o PPK v2 RSA)
                </label>
                <input
                  id={`ssh-key-${sufijo}`}
                  type="file"
                  accept=".pem,.key,.ppk"
                  aria-describedby={`ssh-key-help-${sufijo}`}
                  onChange={(evento) => void cargarArchivoLlave(evento)}
                />
                {valores.sshKeyFileName.length > 0 ? (
                  <span className="ayuda-campo" role="status">
                    Archivo seleccionado: {valores.sshKeyFileName}
                  </span>
                ) : null}
                {errorArchivoLlave !== null ? (
                  <span className="aviso-error" role="alert">
                    {errorArchivoLlave}
                  </span>
                ) : null}
                <span id={`ssh-key-help-${sufijo}`} className="ayuda-campo">
                  Se acepta PEM/OpenSSH y PuTTY PPK v2 RSA. PPK v3, DSA y otras variantes PPK no son
                  compatibles. El contenido no se muestra; el servidor valida y cifra la llave al
                  guardar.
                </span>
              </div>
              <div className="campo">
                <label htmlFor={`ssh-passphrase-${sufijo}`}>Passphrase SSH (opcional)</label>
                <input
                  id={`ssh-passphrase-${sufijo}`}
                  type="password"
                  autoComplete="new-password"
                  maxLength={1024}
                  value={valores.sshPassphrase}
                  onChange={(evento) => actualizar('sshPassphrase', evento.currentTarget.value)}
                />
              </div>
            </>
          ) : (
            <div className="campo">
              <label htmlFor={`ssh-password-${sufijo}`}>Contraseña SSH</label>
              <input
                id={`ssh-password-${sufijo}`}
                type="password"
                autoComplete="new-password"
                required
                maxLength={4096}
                value={valores.sshPassword}
                onChange={(evento) => actualizar('sshPassword', evento.currentTarget.value)}
              />
            </div>
          )}
        </>
      ) : null}
    </fieldset>
  );
}

interface PropiedadesFilaPerfil {
  /** DTO redactado entregado por el servidor para el cliente actual. */
  readonly perfil: PerfilConexionAdminContrato;
  /** Impide acciones simultáneas sobre este perfil. */
  readonly deshabilitado: boolean;
  /** Impide pruebas de conexión cuando el cliente está desactivado. */
  readonly clienteActivo: boolean;
  /** Ejecuta el sondeo read-only autorizado para ADMIN. */
  readonly probar: (
    perfil: PerfilConexionAdminContrato,
  ) => Promise<ResultadoPruebaPerfilAdminContrato | null>;
  /** Persiste cambios de metadatos sin recuperar credenciales. */
  readonly guardar: (
    perfil: PerfilConexionAdminContrato,
    cambios: SolicitudActualizarPerfilConexionAdmin,
  ) => Promise<void>;
  /** Sustituye credenciales en un endpoint separado y redactado. */
  readonly reemplazar: (
    perfil: PerfilConexionAdminContrato,
    credenciales: CredencialesMySqlAdmin,
  ) => Promise<void>;
  /** Alterna el estado lógico conservando historial y auditoría. */
  readonly alternarEstado: (perfil: PerfilConexionAdminContrato) => Promise<void>;
}

/** Presenta un perfil con edición separada de metadatos y credenciales secretas. */
function FilaPerfilConexion({
  perfil,
  deshabilitado,
  clienteActivo,
  probar,
  guardar,
  reemplazar,
  alternarEstado,
}: PropiedadesFilaPerfil): JSX.Element {
  const [resultado, setResultado] = useState<ResultadoPruebaPerfilAdminContrato | null>(null);
  const [errorFila, setErrorFila] = useState<string | null>(null);
  const [nombre, setNombre] = useState(perfil.nombre);
  const [entorno, setEntorno] = useState(perfil.entorno);
  const [destino, setDestino] = useState(perfil.destinoMySqlId);
  const [gateway, setGateway] = useState(perfil.gatewaySshId ?? '');
  const [baseDatos, setBaseDatos] = useState(perfil.baseDatos);
  const [nuevasCredenciales, setNuevasCredenciales] =
    useState<ValoresCredenciales>(CREDENCIALES_VACIAS);
  const [guardandoCredenciales, setGuardandoCredenciales] = useState(false);

  /** Prueba el perfil y traduce el código estable a un estado visible sin detalles del driver. */
  async function manejarPrueba(): Promise<void> {
    setErrorFila(null);
    setResultado(await probar(perfil));
  }

  /** Actualiza los metadatos del perfil tras validación HTML/API y confirma la operación. */
  async function manejarEdicion(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    const cambios: SolicitudActualizarPerfilConexionAdmin = {
      nombre,
      entorno,
      destinoMySqlId: destino,
      ...(perfil.tipo === 'MYSQL_SSH' ? { gatewaySshId: gateway } : {}),
      baseDatos,
    };
    await guardar(perfil, cambios);
  }

  /** Sustituye secretos solo tras una acción explícita y vacía los campos después. */
  async function manejarReemplazo(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setGuardandoCredenciales(true);
    setErrorFila(null);
    try {
      await reemplazar(perfil, construirCredenciales(nuevasCredenciales, perfil.tipo));
    } catch (rechazo: unknown) {
      setErrorFila(mensajeError(rechazo));
    } finally {
      setNuevasCredenciales(CREDENCIALES_VACIAS);
      setGuardandoCredenciales(false);
    }
  }

  return (
    <article className="fila-perfil-conexion" aria-labelledby={`perfil-${perfil.id}`}>
      <header>
        <div>
          <h6 id={`perfil-${perfil.id}`}>{perfil.nombre}</h6>
          <p className="texto-secundario">
            {perfil.tipo === 'MYSQL_SSH' ? 'MySQL por SSH' : 'MySQL directo'} ·{' '}
            {perfil.entorno === 'TEST' ? 'Pruebas' : 'Producción'} · {perfil.baseDatos}
          </p>
          <span className={`etiqueta-estado ${perfil.estado === 'ACTIVE' ? 'estado-active' : ''}`}>
            {perfil.estado === 'ACTIVE' ? 'Activo' : 'Desactivado'}
          </span>
        </div>
        <div className="acciones-perfil">
          <button
            className="boton-secundario"
            type="button"
            onClick={() => void manejarPrueba()}
            disabled={deshabilitado || !clienteActivo || perfil.estado !== 'ACTIVE'}
          >
            {deshabilitado ? 'Procesando…' : 'Probar conexión'}
          </button>
          <button
            className="boton-secundario"
            type="button"
            onClick={() => void alternarEstado(perfil)}
            disabled={deshabilitado}
          >
            {perfil.estado === 'ACTIVE' ? 'Desactivar perfil' : 'Reactivar perfil'}
          </button>
        </div>
      </header>
      {resultado !== null ? (
        <p
          className={resultado.code === 'CONNECTED' ? 'aviso-exito' : 'nota-conectividad'}
          role="status"
        >
          {traducirResultadoPrueba(resultado.code)} ·{' '}
          {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(
            new Date(resultado.completedAt),
          )}
        </p>
      ) : null}
      {errorFila !== null ? (
        <p className="aviso-error" role="alert">
          {errorFila}
        </p>
      ) : null}
      <details>
        <summary>Editar perfil y sustituir credenciales</summary>
        <div className="contenido-perfiles-conexion">
          <form className="formulario formulario-perfil-conexion" onSubmit={manejarEdicion}>
            <div className="campo">
              <label htmlFor={`editar-nombre-${perfil.id}`}>Nombre del perfil</label>
              <input
                id={`editar-nombre-${perfil.id}`}
                minLength={2}
                maxLength={120}
                required
                value={nombre}
                onChange={(evento) => setNombre(evento.currentTarget.value)}
              />
            </div>
            <div className="campo">
              <label htmlFor={`editar-entorno-${perfil.id}`}>Entorno del cliente</label>
              <select
                id={`editar-entorno-${perfil.id}`}
                value={entorno}
                onChange={(evento) =>
                  setEntorno(evento.currentTarget.value as EntornoPerfilConexionAdmin)
                }
              >
                <option value="TEST">Pruebas</option>
                <option value="PRODUCTION">Producción</option>
              </select>
            </div>
            <div className="campo">
              <label htmlFor={`editar-destino-${perfil.id}`}>ID de destino autorizado</label>
              <input
                id={`editar-destino-${perfil.id}`}
                pattern="[a-z0-9][a-z0-9_-]*"
                maxLength={64}
                required
                value={destino}
                onChange={(evento) => setDestino(evento.currentTarget.value)}
              />
            </div>
            {perfil.tipo === 'MYSQL_SSH' ? (
              <div className="campo">
                <label htmlFor={`editar-gateway-${perfil.id}`}>ID de gateway autorizado</label>
                <input
                  id={`editar-gateway-${perfil.id}`}
                  pattern="[a-z0-9][a-z0-9_-]*"
                  maxLength={64}
                  required
                  value={gateway}
                  onChange={(evento) => setGateway(evento.currentTarget.value)}
                />
              </div>
            ) : null}
            <div className="campo">
              <label htmlFor={`editar-base-${perfil.id}`}>Base MySQL</label>
              <input
                id={`editar-base-${perfil.id}`}
                pattern="[A-Za-z0-9_$-]+"
                maxLength={64}
                required
                value={baseDatos}
                onChange={(evento) => setBaseDatos(evento.currentTarget.value)}
              />
            </div>
            <button className="boton-secundario" type="submit" disabled={deshabilitado}>
              Guardar configuración
            </button>
          </form>
          <form className="formulario formulario-perfil-conexion" onSubmit={manejarReemplazo}>
            <h6>Sustituir credenciales</h6>
            <p className="ayuda-campo">
              Los campos inician vacíos. El Portal nunca recupera ni muestra las credenciales
              actuales.
            </p>
            <CamposCredenciales
              tipo={perfil.tipo}
              valores={nuevasCredenciales}
              cambiar={setNuevasCredenciales}
              sufijo={`reemplazo-${perfil.id}`}
            />
            <button
              className="boton-secundario"
              type="submit"
              disabled={deshabilitado || guardandoCredenciales}
              aria-busy={guardandoCredenciales}
            >
              {guardandoCredenciales ? 'Cifrando…' : 'Sustituir credenciales'}
            </button>
          </form>
        </div>
      </details>
    </article>
  );
}

/** Valida certificados y prepara secretos temporales para el contrato de alta o reemplazo.
 * @param valores Campos temporales de la interfaz; no se persisten en el navegador.
 * @param tipo Tipo de perfil MySQL que determina si requiere credenciales SSH.
 * @returns Paquete validado que la API cifra antes de persistir.
 * @throws Error si falta un par TLS o el método SSH seleccionado no está completo.
 */
function construirCredenciales(
  valores: ValoresCredenciales,
  tipo: TipoPerfil,
): CredencialesMySqlAdmin {
  const tieneCertificado = valores.tlsCert.length > 0;
  const tieneLlaveTls = valores.tlsKey.length > 0;
  if (tieneCertificado !== tieneLlaveTls) {
    throw new Error('Agrega juntos el certificado y la llave cliente TLS.');
  }
  let autenticacionSsh: CredencialesMySqlAdmin['ssh'] = undefined;
  if (tipo === 'MYSQL_SSH' && valores.sshAuthentication === 'PASSWORD') {
    if (valores.sshPassword.length === 0) {
      throw new Error('Agrega la contraseña SSH del gateway autorizado.');
    }
    autenticacionSsh = {
      username: valores.sshUsername,
      authentication: 'PASSWORD',
      password: valores.sshPassword,
    };
  } else if (tipo === 'MYSQL_SSH') {
    if (
      !/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----\r?$/mu.test(valores.sshPrivateKey) &&
      !/^PuTTY-User-Key-File-2: ssh-rsa\r?\n/u.test(valores.sshPrivateKey)
    ) {
      throw new Error('Selecciona una llave PEM/OpenSSH o PuTTY PPK v2 RSA compatible.');
    }
    autenticacionSsh = {
      username: valores.sshUsername,
      authentication: 'PRIVATE_KEY',
      privateKey: valores.sshPrivateKey,
      ...(valores.sshPassphrase.length === 0 ? {} : { passphrase: valores.sshPassphrase }),
    };
  }

  return {
    mysqlUsername: valores.mysqlUsername,
    mysqlPassword: valores.mysqlPassword,
    ...(valores.tlsCa.length === 0 && !tieneCertificado
      ? {}
      : {
          tls: {
            ...(valores.tlsCa.length === 0 ? {} : { ca: valores.tlsCa }),
            ...(tieneCertificado ? { cert: valores.tlsCert, key: valores.tlsKey } : {}),
          },
        }),
    ...(autenticacionSsh === undefined ? {} : { ssh: autenticacionSsh }),
  };
}

/** Traduce los códigos externos de API a mensajes breves sin registrar secretos. */
function mensajeError(error: unknown): string {
  return error instanceof Error ? error.message : 'No fue posible completar la operación.';
}

/** Explica el resultado del broker sin presentar destino, usuario, error de driver o secreto. */
function traducirResultadoPrueba(codigo: string): string {
  const mensajes: Readonly<Record<string, string>> = {
    CONNECTED: 'Conexión verificada.',
    CONNECTOR_BUSY: 'Hay otra prueba en curso.',
    DESTINATION_NOT_ALLOWED: 'El destino no está autorizado por la configuración del servidor.',
    INVALID_CREDENTIALS: 'Las credenciales o el formato de llave no son compatibles.',
    SSH_KEY_FORMAT_UNSUPPORTED: 'La llave SSH debe ser PEM/OpenSSH o PuTTY PPK v2 RSA.',
    SSH_KEY_INVALID: 'La llave SSH no se pudo validar; revisa formato y passphrase.',
    MYSQL_AUTHENTICATION_FAILED: 'MySQL rechazó las credenciales.',
    MYSQL_CONNECTION_FAILED: 'No fue posible conectar con MySQL.',
    MYSQL_TLS_FAILED: 'No se pudo validar el certificado TLS.',
    SSH_CONNECTION_FAILED: 'No fue posible abrir el túnel SSH autorizado.',
    SSH_HOST_KEY_REJECTED: 'La huella del servidor SSH no coincide con la autorizada.',
    SECRET_CUSTODY_DISABLED: 'La custodia de credenciales no está configurada.',
    SECRET_CUSTODY_UNAVAILABLE: 'La custodia segura no está disponible.',
    SECRET_PACKAGE_INVALID: 'No fue posible validar el material cifrado.',
    CONNECTION_TIMEOUT: 'La prueba excedió el tiempo permitido.',
  };
  return mensajes[codigo] ?? 'La prueba terminó con un resultado controlado.';
}
