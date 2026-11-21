// Cliente de Google Gemini (API REST v1beta) con descubrimiento de modelos, reintentos y respaldo.
import {
  LlmError, InvalidOutputError, OutOfTimeError, defaultSleep, backoffMs, parseJsonLoose, readJsonBody, httpError,
  assertTime, requestSignal,
} from './common.js';
import { FEEDBACK_SCHEMA } from './schema.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const NON_TEXT_MODELS = /(image|tts|live|audio|embedding|veo|imagen|lyria|aqa|computer)/i;

export function createGemini({
  apiKey, models, fetchImpl = globalThis.fetch, sleep = defaultSleep, log = () => {},
  maxRetries = 1, timeoutMs = 60_000, random = Math.random, now = Date.now,
}) {
  let resolvedModels = null; // caché por ejecución
  // Modelos saturados o sin respuesta en esta ejecución: no se insiste con ellos en las siguientes entregas.
  const unhealthy = new Map();

  async function discoverModels(opts = {}) {
    if (resolvedModels) return resolvedModels;
    try {
      const res = await fetchImpl(`${BASE}/models?pageSize=1000`, {
        headers: { 'x-goog-api-key': apiKey },
        signal: requestSignal(20_000, { ...opts, now }),
      });
      const { json, text } = await readJsonBody(res);
      if (!res.ok) throw httpError('gemini', res, json, text);
      const available = (json?.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => String(m.name).replace(/^models\//, ''));
      const set = new Set(available);
      let chosen = models.filter((m) => set.has(m));
      if (!chosen.length) {
        chosen = available.filter((m) => /flash/i.test(m) && !NON_TEXT_MODELS.test(m));
        log('warn', `Ninguno de GEMINI_MODELS está disponible; se usarán: ${chosen.slice(0, 5).join(', ') || '(ninguno)'}`);
      }
      resolvedModels = chosen.length ? chosen : models;
    } catch (err) {
      if (err instanceof LlmError && err.fatal) throw err;
      log('warn', `No se pudo listar modelos de Gemini (${err.message}); se usa GEMINI_MODELS tal cual.`);
      resolvedModels = models;
    }
    return resolvedModels;
  }

  function buildBody({ system, parts }, useSchema) {
    return {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{
        role: 'user',
        parts: parts.map((p) => (p.type === 'inline'
          ? { inline_data: { mime_type: p.mime, data: p.data } }
          : { text: p.text })),
      }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        ...(useSchema ? { responseSchema: FEEDBACK_SCHEMA } : {}),
        maxOutputTokens: 8192,
      },
    };
  }

  async function callOnce(model, prompt, useSchema, opts) {
    assertTime({ ...opts, now }, 5_000, `llamar a ${model}`);
    let res;
    try {
      res = await fetchImpl(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(prompt, useSchema)),
        signal: requestSignal(timeoutMs, { ...opts, now }),
      });
    } catch (err) {
      if (opts.signal?.aborted || now() >= (opts.deadline ?? Infinity)) throw new OutOfTimeError(`tiempo agotado esperando a ${model}`);
      throw new LlmError(`gemini: error de red (${err.message})`, { retryable: true });
    }
    const { json, text } = await readJsonBody(res);
    if (!res.ok) throw httpError('gemini', res, json, text);
    const cand = json?.candidates?.[0];
    const out = (cand?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    if (!out.trim()) {
      const why = json?.promptFeedback?.blockReason || cand?.finishReason || 'sin contenido';
      throw new InvalidOutputError(`respuesta vacía o bloqueada (${why})`);
    }
    return parseJsonLoose(out);
  }

  async function tryModel(model, prompt, opts) {
    let useSchema = true;
    let retries = 0;
    let invalid = 0;
    for (;;) {
      try {
        const json = await callOnce(model, prompt, useSchema, opts);
        return json;
      } catch (err) {
        if (err instanceof LlmError && err.schema && useSchema) {
          log('warn', `${model}: rechazó responseSchema; se reintenta sin esquema.`);
          useSchema = false;
          continue;
        }
        // Saturación (503), cuota (429) o sin respuesta: cambiar de modelo de inmediato, sin esperar.
        const switchModel = err instanceof LlmError && (err.status === 503 || err.status === 429 || err.status == null);
        if (err instanceof LlmError && err.retryable && !switchModel && retries < maxRetries) {
          const wait = backoffMs(retries, err.retryAfterMs, random);
          assertTime({ ...opts, now }, wait + 5_000, `reintentar ${model}`); // no esperar si no cabe
          log('warn', `${model}: ${err.message}; reintento ${retries + 1}/${maxRetries} en ${Math.round(wait / 1000)} s.`);
          retries++;
          await sleep(wait);
          continue;
        }
        if (err instanceof InvalidOutputError && invalid < 1) {
          log('warn', `${model}: ${err.message}; se reintenta una vez.`);
          invalid++;
          continue;
        }
        throw err;
      }
    }
  }

  async function generate(prompt, opts = {}) {
    const all = await discoverModels(opts);
    const list = all.filter((m) => !unhealthy.has(m));
    const causes = [...all.filter((m) => unhealthy.has(m)).map((m) => `${m}: omitido (${unhealthy.get(m)})`)];
    for (const model of list) {
      try {
        const json = await tryModel(model, prompt, opts);
        return { json, model };
      } catch (err) {
        if (err instanceof OutOfTimeError) throw err;
        causes.push(`${model}: ${err.message}`);
        if (err instanceof LlmError && err.fatal) break; // clave inválida o sin permiso
        if (err instanceof LlmError && err.retryable) unhealthy.set(model, err.status ? `HTTP ${err.status}` : 'sin respuesta');
        log('warn', `Gemini ${model} falló (${err.message}); se prueba el siguiente modelo.`);
      }
    }
    throw new LlmError(`Gemini: todos los modelos fallaron → ${causes.join(' | ')}`);
  }

  return { name: 'gemini', generate, discoverModels };
}
