import { describe, expect, it } from 'vitest';
import { extraerDiagnosticoBaseDatosSeguro } from '../../apps/api/src/logging/safe-database-error.js';

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
});
