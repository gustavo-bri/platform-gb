// Validación y normalización de la respuesta del modelo al formato ai_feedback v1.
// La nota se calcula aquí de forma determinista; el modelo nunca la decide.
import { InvalidOutputError } from './llm/common.js';

const SEVERIDADES = new Set(['alta', 'media', 'baja']);
const MAX_ITEMS = 12;

export const MANIPULATION_ALERT = 'intento de manipulación de la evaluación';
export const LEAK_ALERT = 'posible revelación de la solución de referencia';
export const LEAK_NGRAM = 8;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n, d) => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d;
const toNum = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.').replace('%', '')) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v, max = 600) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));
const strList = (v, max = 600) => (Array.isArray(v) ? v : v ? [v] : [])
  .map((x) => (typeof x === 'object' && x !== null ? Object.values(x).join(' — ') : x))
  .map((x) => str(x, max)).filter(Boolean).slice(0, MAX_ITEMS);

// ── Filtro de tono ─────────────────────────────────────────────────────
const GENERIC_PRAISE = [
  /^¡?\s*(excelente|muy\s+buen|gran|buen|magn[ií]fico|incre[ií]ble|estupendo)\s+(trabajo|esfuerzo|intento|desempe[nñ]o)\b/i,
  /^¡?\s*(felicitaciones|felicidades|enhorabuena|bien\s+hecho|muy\s+bien|bravo|sigue\s+as[ií]|excelente)\s*[.!,]?\s*$/i,
  /^¡?\s*(felicitaciones|felicidades|enhorabuena|bien\s+hecho|bravo)\b/i,
];

/** Elimina elogios genéricos sin contenido y quita exclamaciones. */
export function sanitizeTone(text) {
  if (!text) return '';
  const sentences = String(text).split(/(?<=[.!?])\s+/);
  const kept = [];
  for (let s of sentences) {
    s = s.trim();
    if (!s) continue;
    if (GENERIC_PRAISE.some((re) => re.test(s))) continue;
    s = s.replace(/¡/g, '').replace(/!+/g, '.').replace(/^\s*(excelente|muy\s+bien)[,:]?\s+/i, '');
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (s.trim()) kept.push(s.trim());
  }
  return kept.join(' ').trim();
}

// ── Detección determinista de intentos de manipulación ────────────────
const INJECTION_PATTERNS = [
  /(ignora|olvida|omite|desatiende)\s+(todas\s+)?(las\s+)?(instrucciones|indicaciones|reglas)/i,
  /ignore\s+(all\s+)?(previous|prior|the\s+above)\s+(instructions|prompts?)/i,
  /\b(ponme|p[oó]nganme|asigna(me)?|dame|calif[ií]came\s+con)\s+(un[ao]?\s+)?(5([.,]0)?|10([.,]0)?|100|la\s+(nota|calificaci[oó]n)\s+m[aá]xima)\b/i,
  /(nota|calificaci[oó]n|puntaje)\s+(m[aá]xima|perfecta)\s+(a\s+esta|para\s+esta)/i,
  /\b(eres|act[uú]a\s+como)\s+un\s+(evaluador|profesor|docente)\s+(generoso|benevolente)/i,
  /\b(system\s*prompt|you\s+are\s+now|new\s+instructions|nuevas\s+instrucciones)\b/i,
];

export function detectInjection(text) {
  if (!text) return false;
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

// ── Detección de revelación de la solución ─────────────────────────────
/** Minúsculas, sin tildes ni puntuación → lista de palabras. */
export function normWords(text) {
  return String(text ?? '').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
}

function ngrams(text, n = LEAK_NGRAM) {
  const w = normWords(text);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

/** Textos de la retroalimentación que ve el estudiante. */
function feedbackTexts(f) {
  return [
    f.resumen,
    ...f.criterios.flatMap((c) => [c.evidencia, c.comentario]),
    ...f.errores.flatMap((e) => [e.descripcion, e.evidencia, e.como_corregir]),
    ...f.aciertos,
    ...f.recomendaciones,
  ].filter(Boolean);
}

/**
 * true si algún texto de la retroalimentación comparte una secuencia de ≥ 8 palabras normalizadas
 * con la solución de referencia o las notas privadas, y esa secuencia NO aparece en la entrega del estudiante.
 */
export function detectLeak(feedback, privateTexts = [], studentText = '') {
  if (!privateTexts.length) return false;
  const priv = new Set();
  for (const t of privateTexts) for (const g of ngrams(t)) priv.add(g);
  if (!priv.size) return false;
  const student = ngrams(studentText);
  for (const t of feedbackTexts(feedback)) {
    for (const g of ngrams(t)) if (priv.has(g) && !student.has(g)) return true;
  }
  return false;
}

// ── Normalización ──────────────────────────────────────────────────────
function normalizeCriterios(raw) {
  const list = (Array.isArray(raw) ? raw : []).filter((c) => c && typeof c === 'object').slice(0, MAX_ITEMS);
  if (!list.length) throw new InvalidOutputError('la evaluación no incluye criterios');
  const crit = list.map((c, i) => ({
    nombre: str(c.nombre ?? c.criterio ?? c.name, 120) || `Criterio ${i + 1}`,
    peso: Math.max(0, toNum(c.peso ?? c.weight) ?? 0),
    puntaje: clamp(toNum(c.puntaje ?? c.score) ?? 0, 0, 100),
    evidencia: str(c.evidencia ?? c.evidence),
    comentario: sanitizeTone(str(c.comentario ?? c.comment)),
  }));
  const total = crit.reduce((s, c) => s + c.peso, 0);
  for (const c of crit) c.peso = total > 0 ? (c.peso * 100) / total : 100 / crit.length;
  // redondeo de pesos conservando suma 100
  let acc = 0;
  crit.forEach((c, i) => {
    if (i === crit.length - 1) c.peso = round(100 - acc, 2);
    else { c.peso = round(c.peso, 2); acc += c.peso; }
    c.puntaje = round(c.puntaje, 1);
  });
  return crit;
}

function normalizeErrores(raw) {
  return (Array.isArray(raw) ? raw : []).filter((e) => e && typeof e === 'object').slice(0, MAX_ITEMS).map((e) => {
    const sev = str(e.severidad ?? e.severity, 10).toLowerCase();
    return {
      descripcion: str(e.descripcion ?? e.description),
      evidencia: str(e.evidencia ?? e.evidence),
      como_corregir: str(e.como_corregir ?? e.correccion ?? e.fix),
      severidad: SEVERIDADES.has(sev) ? sev : 'media',
    };
  }).filter((e) => e.descripcion);
}

/** Nota determinista: escala × Σ(peso·puntaje)/10000, redondeada a 1 decimal. */
export function computeGrade(criterios, scale) {
  const sum = criterios.reduce((s, c) => s + c.peso * c.puntaje, 0);
  return round(clamp((scale * sum) / 10000, 0, scale), 1);
}

/**
 * @param {object} raw  JSON devuelto por el modelo
 * @param {{scale:number, isLate?:boolean, model?:string, minConfidence?:number, meta?:object}} opts
 */
export function normalizeEvaluation(raw, { scale = 5, isLate = false, model = '', minConfidence = 0.6, meta = {} } = {}) {
  if (!raw || typeof raw !== 'object') throw new InvalidOutputError('respuesta del modelo no es un objeto');
  const criterios = normalizeCriterios(raw.criterios ?? raw.criteria);
  const alertas = strList(raw.alertas ?? raw.alerts, 300);
  const reasons = [];

  if (meta.studentText && detectInjection(meta.studentText) && !alertas.some((a) => /manipulaci/i.test(a))) {
    alertas.push(MANIPULATION_ALERT);
  }
  for (const w of meta.warnings ?? []) {
    if (/no_evaluable|no se pudo leer|vacío|no contiene/i.test(w)) alertas.push(str(w.replace(/^no_evaluable:\s*/, ''), 300));
  }

  let confianza = toNum(raw.confianza ?? raw.confidence);
  confianza = confianza == null ? 0.5 : clamp(confianza > 1 && confianza <= 100 ? confianza / 100 : confianza, 0, 1);

  if (raw.requiere_revision === true || raw.requiere_revision === 'true') reasons.push(str(raw.motivo_revision, 300) || 'El modelo solicitó revisión docente.');
  if (confianza < minConfidence) reasons.push(`Confianza baja de la IA (${round(confianza, 2)}).`);
  if (alertas.some((a) => /manipulaci/i.test(a))) reasons.push('Posible intento de manipular la evaluación.');
  if (alertas.some((a) => /copia/i.test(a))) reasons.push('Posible copia de la solución de referencia.');
  if (meta.submissionUnreadable) reasons.push('El archivo de la entrega no se pudo leer por completo.');
  if (meta.hasReference === false && meta.hasRubric === false) reasons.push('La actividad no tiene solución de referencia ni rúbrica.');

  const grade = computeGrade(criterios, scale);
  const feedback = {
    version: 1,
    resumen: sanitizeTone(str(raw.resumen ?? raw.summary, 1200)) || 'Evaluación generada sin resumen.',
    criterios,
    aciertos: strList(raw.aciertos ?? raw.strengths).map(sanitizeTone).filter(Boolean),
    errores: normalizeErrores(raw.errores ?? raw.errors),
    recomendaciones: strList(raw.recomendaciones ?? raw.recommendations).map(sanitizeTone).filter(Boolean),
    confianza: round(confianza, 2),
    requiere_revision: false,
    motivo_revision: null,
    alertas: [],
    nota: grade,
    escala: scale,
    entrega_tardia: Boolean(isLate),
    modelo: str(model, 80),
  };
  if (detectLeak(feedback, meta.privateTexts ?? [], meta.studentText ?? '')) {
    alertas.push(LEAK_ALERT);
    reasons.push('La retroalimentación podría revelar la solución de referencia o las notas privadas.');
  }
  const needsReview = reasons.length > 0;
  feedback.requiere_revision = needsReview;
  feedback.motivo_revision = needsReview ? [...new Set(reasons)].join(' ') : null;
  feedback.alertas = [...new Set(alertas)];
  return { feedback, grade, confidence: feedback.confianza, needsReview };
}
