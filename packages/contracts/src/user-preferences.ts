import { Type, type Static } from '@sinclair/typebox';

/** Valores explícitos de apariencia que puede elegir cada cuenta del portal. */
export const userThemePreferenceSchema = Type.Union(
  [Type.Literal('system'), Type.Literal('light'), Type.Literal('dark')],
  { description: 'Tema del sistema operativo, claro u oscuro.' },
);

/** Tipo del tema derivado del contrato compartido de preferencias. */
export type TemaPreferenciaUsuarioContrato = Static<typeof userThemePreferenceSchema>;

/** Respuesta mínima de la preferencia personal de apariencia. */
export const userPreferencesResponseSchema = Type.Object(
  { theme: userThemePreferenceSchema },
  {
    additionalProperties: false,
    description: 'Preferencia visual de la cuenta autenticada.',
  },
);

/** Tipo de la respuesta JSON de preferencias personales. */
export type RespuestaPreferenciasUsuario = Static<typeof userPreferencesResponseSchema>;

/** Entrada cerrada para actualizar las preferencias de la propia cuenta. */
export const updateUserPreferencesSchema = Type.Object(
  { theme: userThemePreferenceSchema },
  {
    additionalProperties: false,
    description: 'Tema visual solicitado para la cuenta autenticada.',
  },
);

/** Tipo del cuerpo PATCH de preferencias personales. */
export type SolicitudActualizarPreferenciasUsuario = Static<typeof updateUserPreferencesSchema>;
