// Esquema de salida (ai_feedback v1 sin los campos que calcula el agente: nota, escala,
// entrega_tardia, modelo, version). Formato OpenAPI de Gemini (tipos en MAYÚSCULAS).

const S = { type: 'STRING' };
const N = { type: 'NUMBER' };

export const FEEDBACK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    resumen: S,
    criterios: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { nombre: S, peso: N, puntaje: N, evidencia: S, comentario: S },
        required: ['nombre', 'peso', 'puntaje', 'evidencia', 'comentario'],
      },
    },
    aciertos: { type: 'ARRAY', items: S },
    errores: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          descripcion: S,
          evidencia: S,
          como_corregir: S,
          severidad: { type: 'STRING', enum: ['alta', 'media', 'baja'] },
        },
        required: ['descripcion', 'evidencia', 'como_corregir', 'severidad'],
      },
    },
    recomendaciones: { type: 'ARRAY', items: S },
    confianza: N,
    requiere_revision: { type: 'BOOLEAN' },
    motivo_revision: { type: 'STRING', nullable: true },
    alertas: { type: 'ARRAY', items: S },
  },
  required: ['resumen', 'criterios', 'aciertos', 'errores', 'recomendaciones', 'confianza', 'requiere_revision', 'alertas'],
};
