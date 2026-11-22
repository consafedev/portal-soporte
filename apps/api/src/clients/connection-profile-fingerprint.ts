import { createHash } from 'node:crypto';
import type { PerfilConexionCliente } from '../../../../packages/core/src/clients/connection-profile-ports.js';

/**
 * Calcula una huella interna de la revisión operativa de un perfil sin exponerla al navegador.
 * @param perfil Metadatos server-side del perfil, sin seleccionar su sobre cifrado.
 * @returns Hash SHA-256 estable que cambia con destino, base, estado, tipo o revisión.
 * @effects No serializa secretos, certificados, claves ni credenciales.
 */
export function calcularHuellaPerfilConexion(perfil: PerfilConexionCliente): string {
  const contenido = JSON.stringify({
    id: perfil.id,
    clientId: perfil.clientId,
    tipo: perfil.tipo,
    entorno: perfil.entorno,
    destinoMySqlId: perfil.destinoMySqlId,
    gatewaySshId: perfil.gatewaySshId,
    baseDatos: perfil.baseDatos,
    estado: perfil.estado,
    createdAt: perfil.createdAt.toISOString(),
    updatedAt: perfil.updatedAt.toISOString(),
  });
  return `sha256:${createHash('sha256').update(contenido, 'utf8').digest('hex')}`;
}
