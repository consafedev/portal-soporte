import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  validarConfiguracionEfectivaSsh,
  validarSalidaHuellasHostSsh,
} from '../../scripts/test-database-ssh-identity.js';

const huellaAprobada = 'SHA256:kJFGr6h9jFCslHQC2Ej7Mc4/NTf2AEKTCFgLkaaJ7a0';

/**
 * Construye la salida simulada de ssh -G para el destino aprobado.
 * @param ajustes Overrides de configuración efectivos que el caso desea validar.
 * @returns Configuración SSH simulada con rutas locales estándar.
 */
function crearConfiguracionSsh(ajustes = ''): string {
  const conocidos = join(homedir(), '.ssh', 'known_hosts');
  const secundarios = join(homedir(), '.ssh', 'known_hosts2');
  const datosPrograma =
    process.env['ProgramData'] ?? process.env['PROGRAMDATA'] ?? 'C:\\ProgramData';
  const conocidosGlobales = join(datosPrograma, 'ssh', 'ssh_known_hosts');
  const secundariosGlobales = join(datosPrograma, 'ssh', 'ssh_known_hosts2');
  const lineas = [
    'hostname 10.18.170.44',
    'user daniel',
    'port 22',
    'stricthostkeychecking ask',
    `userknownhostsfile ${conocidos} ${secundarios}`,
    'globalknownhostsfile ' + conocidosGlobales + ' ' + secundariosGlobales,
    'knownhostscommand none',
    'canonicalizehostname false',
  ];
  for (const ajuste of ajustes.split('\n').filter(Boolean)) {
    const nombre = ajuste.split(/\s+/u, 1)[0];
    const indice = lineas.findIndex((linea) => linea.startsWith(`${nombre} `));
    if (indice >= 0) {
      lineas[indice] = ajuste;
    } else {
      lineas.push(ajuste);
    }
  }

  return lineas.join('\n');
}

describe('verificación de identidad SSH del runner PostgreSQL', () => {
  it('acepta el pin ED25519 aprobado en la salida de ssh-keygen', () => {
    expect(() =>
      validarSalidaHuellasHostSsh(`256 ${huellaAprobada} servidor (ED25519)`),
    ).not.toThrow();
  });

  it('acepta el pin ED25519 aprobado junto con claves conocidas de otros algoritmos', () => {
    expect(() =>
      validarSalidaHuellasHostSsh(
        `256 ${huellaAprobada} servidor (ED25519)\n256 SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb servidor (RSA)\n256 SHA256:ccccccccccccccccccccccccccccccccccccccccccc servidor (ECDSA)`,
      ),
    ).not.toThrow();
  });

  it.each([
    [
      'una clave ED25519 adicional',
      `256 ${huellaAprobada} servidor (ED25519)\n256 SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb servidor (ED25519)`,
    ],
    [
      'una clave ED25519 distinta',
      '256 SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb servidor (ED25519)',
    ],
    [
      'solo claves de otros algoritmos',
      '256 SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb servidor (RSA)',
    ],
    ['ninguna clave', ''],
  ])('rechaza %s aunque exista o se omita el pin ED25519', (_caso, salida) => {
    expect(() => validarSalidaHuellasHostSsh(salida)).toThrow(
      'La clave SSH local no coincide con la identidad fijada del servidor de pruebas.',
    );
  });

  it('acepta solo la configuración SSH efectiva que usa el host y almacén fijados', () => {
    expect(() => validarConfiguracionEfectivaSsh(crearConfiguracionSsh())).not.toThrow();
  });

  it.each([
    ['validación de host desactivada', 'stricthostkeychecking no'],
    ['almacén de host falso', 'userknownhostsfile NUL'],
    ['almacén global adicional no revisado', 'globalknownhostsfile C:\\ssh\\ssh_known_hosts'],
    ['comando dinámico de host keys', 'knownhostscommand powershell.exe'],
    [
      'almacén de host adicional no revisado',
      `userknownhostsfile ${join(homedir(), '.ssh', 'known_hosts')} ${join(homedir(), '.ssh', 'otro_hosts')}`,
    ],
    ['proxy SSH alterno', 'proxycommand ssh alterno'],
    ['alias de host inesperado', 'hostkeyalias otro-servidor'],
  ])('rechaza la configuración SSH con %s', (_caso, ajuste) => {
    expect(() => validarConfiguracionEfectivaSsh(crearConfiguracionSsh(ajuste))).toThrow(
      'La clave SSH local no coincide con la identidad fijada del servidor de pruebas.',
    );
  });
});
