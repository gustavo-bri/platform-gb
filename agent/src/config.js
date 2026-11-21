// Lectura y validación de variables de entorno del agente.
import { mask } from './privacy.js';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULT_GEMINI_MODELS =
  'gemini-3.8-flash,gemini-3.6-flash,gemini-flash-latest,gemini-2.5-flash,gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-2.5-flash-lite';

const str = (env, k, def = '') => {
  const v = env[k];
  return v == null || String(v).trim() === '' ? def : String(v).trim();
};

const num = (env, k, def, { min = -Infinity, max = Infinity } = {}) => {
  const raw = str(env, k, '');
  if (raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ConfigError(`La variable ${k} debe ser un número entre ${min} y ${max} (valor recibido: "${raw}").`);
  }
  return n;
};

const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);

export function loadConfig(env = process.env) {
  const errors = [];
  const supabaseUrl = str(env, 'SUPABASE_URL').replace(/\/+$/, '');
  const serviceKey = str(env, 'SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl) errors.push('Falta SUPABASE_URL (Supabase → Project Settings → API → Project URL).');
  else if (!/^https?:\/\//.test(supabaseUrl)) errors.push('SUPABASE_URL debe empezar por https://');
  if (!serviceKey) errors.push('Falta SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API → service_role).');

  const geminiKey = str(env, 'GEMINI_API_KEY');
  const groqKey = str(env, 'GROQ_API_KEY');
  const requested = list(str(env, 'LLM_PROVIDERS', 'gemini,groq').toLowerCase());
  const unknown = requested.filter((p) => !['gemini', 'groq'].includes(p));
  if (unknown.length) errors.push(`LLM_PROVIDERS contiene proveedores desconocidos: ${unknown.join(', ')} (válidos: gemini, groq).`);
  const providers = requested.filter((p) => (p === 'gemini' && geminiKey) || (p === 'groq' && groqKey));
  if (!providers.length) {
    errors.push('No hay ningún proveedor de IA con clave: define GEMINI_API_KEY (recomendado) y/o GROQ_API_KEY.');
  }

  if (errors.length) throw new ConfigError(`Configuración inválida:\n- ${errors.join('\n- ')}`);

  const gmailUser = str(env, 'GMAIL_USER');
  const gmailPass = str(env, 'GMAIL_APP_PASSWORD').replace(/\s+/g, '');

  return {
    supabaseUrl,
    serviceKey,
    geminiKey,
    geminiModels: list(str(env, 'GEMINI_MODELS', DEFAULT_GEMINI_MODELS)),
    groqKey,
    groqModel: str(env, 'GROQ_MODEL', 'openai/gpt-oss-120b'),
    providers,
    gmailUser,
    gmailPass,
    mailEnabled: Boolean(gmailUser && gmailPass),
    mailFromName: str(env, 'MAIL_FROM_NAME', 'Plataforma Educativa GB'),
    // A dónde llegan las respuestas de los estudiantes (por defecto, la misma cuenta que envía).
    mailReplyTo: str(env, 'MAIL_REPLY_TO', '') || gmailUser,
    appUrl: str(env, 'APP_URL', '').replace(/#.*$/, ''),
    timezone: str(env, 'TIMEZONE', 'America/Bogota'),
    emailDailyBudget: num(env, 'EMAIL_DAILY_BUDGET', 450, { min: 0, max: 2000 }),
    maxEvaluationsPerRun: num(env, 'MAX_EVALUATIONS_PER_RUN', 20, { min: 0, max: 500 }),
    evalConcurrency: num(env, 'EVAL_CONCURRENCY', 2, { min: 1, max: 10 }),
    runBudgetMs: num(env, 'RUN_BUDGET_MS', 480000, { min: 30000, max: 3600000 }),
    dryRun: /^(1|true|si|sí|yes)$/i.test(str(env, 'DRY_RUN', 'false')),
    minConfidence: num(env, 'MIN_CONFIDENCE', 0.6, { min: 0, max: 1 }),
    digestHour: num(env, 'DIGEST_HOUR', 7, { min: 0, max: 23 }),
    maxItemMs: num(env, 'MAX_ITEM_MS', 240000, { min: 10000, max: 600000 }),
  };
}

/** Copia segura para registrar en consola (sin claves). */
export function describeConfig(c) {
  return {
    supabaseUrl: c.supabaseUrl,
    providers: c.providers,
    geminiModels: c.geminiModels,
    groqModel: c.providers.includes('groq') ? c.groqModel : undefined,
    correo: c.dryRun ? 'DRY_RUN (solo registro)' : c.mailEnabled ? `Gmail (${mask(c.gmailUser)})` : 'desactivado (faltan credenciales)',
    appUrl: c.appUrl || '(sin APP_URL: los correos no tendrán enlace)',
    timezone: c.timezone,
    emailDailyBudget: c.emailDailyBudget,
    maxEvaluationsPerRun: c.maxEvaluationsPerRun,
    evalConcurrency: c.evalConcurrency,
    minConfidence: c.minConfidence,
    digestHour: c.digestHour,
  };
}
