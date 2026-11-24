import { describe, expect, it } from 'vitest';
import {
  extraerDiagnosticoBaseDatosSeguro,
  extraerIdentidadErrorSegura,
} from '../../apps/api/src/logging/safe-database-error.js';

describe('diagnóstico seguro de errores PostgreSQL', () => {
  it('conserva SQLSTATE y tabla permitida sin propagar mensajes de la cadena causal', () => {
    const causa = Object.assign(new Error('detalle interno sintético'), {
      code: '42501',
      table_name: 'audit_events',
      position: '17',
    });
    const error = Object.assign(new Error('error encapsulado sintético'), {
      cause: causa,
      query: 'INSERT INTO "portal"."audit_events" ("id") VALUES ($1)',
    });

    const diagnostico = extraerDiagnosticoBaseDatosSeguro(error);

    expect(diagnostico).toEqual({
      databaseCode: '42501',
      databaseTable: 'audit_events',
      databaseOperation: 'INSERT',
      databasePosition: 17,
    });
    expect(JSON.stringify(diagnostico)).not.toContain('sintético');
  });

  it('omite tablas ajenas al esquema de autenticación y códigos con formato inválido', () => {
    const error = Object.assign(new Error('detalle interno sintético'), {
      code: 'no-sqlstate',
      table_name: 'customers',
    });

    expect(extraerDiagnosticoBaseDatosSeguro(error)).toEqual({});
  });

  it('detiene ciclos en la cadena causal sin revelar datos', () => {
    const error: { cause?: unknown; code: string; table_name: string } = {
      code: '23505',
      table_name: 'users',
    };
    error.cause = error;

    expect(extraerDiagnosticoBaseDatosSeguro(error)).toEqual({
      databaseCode: '23505',
      databaseTable: 'users',
    });
  });

  it('permite diagnosticar restricciones del perfil sin incluir valores del destino', () => {
    const error = Object.assign(new Error('violación para cliente-secreto.example'), {
      code: '23514',
      table_name: 'client_connection_profiles',
      query: 'UPDATE portal.client_connection_profiles SET destination_hostname = $1 WHERE id = $2',
    });

    const diagnostico = extraerDiagnosticoBaseDatosSeguro(error);

    expect(diagnostico).toEqual({
      databaseCode: '23514',
      databaseTable: 'client_connection_profiles',
      databaseOperation: 'UPDATE',
    });
    expect(JSON.stringify(diagnostico)).not.toContain('cliente-secreto.example');
    expect(JSON.stringify(diagnostico)).not.toContain('destination_hostname');
  });

  it('registra solo tipo y código estructurado de un error, nunca su mensaje', () => {
    const error = Object.assign(
      new Error('password=hunter2 host=cliente.example SELECT * FROM factura'),
      { code: 'ER_ACCESS_DENIED_ERROR' },
    );

    const diagnostico = extraerIdentidadErrorSegura(error);

    expect(diagnostico).toEqual({ errorType: 'Error', errorCode: 'ER_ACCESS_DENIED_ERROR' });
    expect(JSON.stringify(diagnostico)).not.toContain('hunter2');
    expect(JSON.stringify(diagnostico)).not.toContain('cliente.example');
    expect(JSON.stringify(diagnostico)).not.toContain('SELECT');
  });

  it('normaliza nombres y códigos de excepción no confiables', () => {
    const error = Object.assign(new Error('dato sensible'), {
      name: 'Error\npassword=expuesto',
      code: 'host=cliente.example',
    });

    expect(extraerIdentidadErrorSegura(error)).toEqual({ errorType: 'UnknownError' });
  });
});
