// Utilidades compartidas por los clientes de IA: errores, reintentos y JSON tolerante.

export class LlmError extends Error {
  constructor(message, { status = null, retryable = false, fatal = false, schema = false, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.retryable = retryable;     // 429 / 5xx / red
    this.fatal = fatal;             // clave inválida: no tiene sentido probar otros modelos del mismo proveedor
    this.schema = schema;           // el modelo rechazó responseSchema
    this.retryAfterMs = retryAfterMs;
  }
}

export class NonTextualInputError extends Error {
  constructor(provider) {
    super(`${provider} solo acepta texto y la entrega incluye PDF o imágenes`);
    this.name = 'NonTextualInputError';
  }
}

export class InvalidOutputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidOutputError';
  }
}

export const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class OutOfTimeError extends Error {
  constructor(message = 'tiempo máximo de evaluación agotado') {
    super(message);
    this.name = 'OutOfTimeError';
  }
}

/** Lanza si la señal se abortó o si no cabe `needMs` antes del deadline. */
export function assertTime({ signal, deadline = Infinity, now = Date.now }, needMs = 0, what = 'continuar') {
  if (signal?.aborted) throw new OutOfTimeError(`tiempo máximo agotado; no se puede ${what}`);
  if (now() + needMs > deadline) throw new OutOfTimeError(`no queda tiempo para ${what} antes del límite de la ejecución`);
}

/** Señal de la petición: timeout propio + señal externa + deadline. */
export function requestSignal(timeoutMs, { signal, deadline = Infinity, now = Date.now } = {}) {
  const remaining = Math.max(1, Math.min(timeoutMs, deadline - now()));
  const t = AbortSignal.timeout(remaining);
  return signal ? AbortSignal.any([t, signal]) : t;
}

/** Espera antes del reintento n (0, 1, 2...): respeta Retry-After si existe; si no, backoff exponencial con jitter. */
export function backoffMs(attempt, retryAfterMs, random = Math.random) {
  if (retryAfterMs != null && retryAfterMs >= 0) return Math.min(retryAfterMs, 60_000);
  return Math.min(2000 * 2 ** attempt + Math.floor(random() * 1000), 30_000);
}

/** Lee Retry-After (segundos) o google.rpc.RetryInfo.retryDelay ("30s"). */
export function parseRetryAfter(res, body) {
  const h = res?.headers?.get?.('retry-after');
  if (h && /^\d+(\.\d+)?$/.test(h)) return Math.round(Number(h) * 1000);
  const details = body?.error?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      const m = /^(\d+(?:\.\d+)?)s$/.exec(d?.retryDelay ?? '');
      if (m) return Math.round(Number(m[1]) * 1000);
    }
  }
  return null;
}

/** Extrae un objeto JSON de la respuesta del modelo (tolera cercas ```json y texto alrededor). */
export function parseJsonLoose(text) {
  if (typeof text !== 'string' || !text.trim()) throw new InvalidOutputError('respuesta vacía');
  let t = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fenced) t = fenced[1].trim();
  try {
    const v = JSON.parse(t);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch { /* se intenta recortar */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      const v = JSON.parse(t.slice(a, b + 1));
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch { /* inválido */ }
  }
  throw new InvalidOutputError('el modelo no devolvió un JSON válido');
}

export async function readJsonBody(res) {
  const text = await res.text().catch(() => '');
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

/** Clasifica una respuesta HTTP no exitosa. */
export function httpError(provider, res, body, text) {
  const status = res.status;
  const msg = body?.error?.message || text?.slice(0, 300) || res.statusText || 'error desconocido';
  const retryable = status === 429 || status >= 500;
  return new LlmError(`${provider} HTTP ${status}: ${msg}`, {
    status,
    retryable,
    fatal: status === 401 || status === 403,
    schema: status === 400 && /schema|response_?schema|responseJsonSchema/i.test(msg),
    retryAfterMs: retryable ? parseRetryAfter(res, body) : null,
  });
}
