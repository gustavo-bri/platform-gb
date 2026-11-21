// Cliente Groq (API compatible con OpenAI). Solo texto: si hay PDF/imágenes se salta al siguiente proveedor.
import {
  LlmError, InvalidOutputError, NonTextualInputError, OutOfTimeError, defaultSleep, backoffMs, parseJsonLoose, readJsonBody,
  httpError, assertTime, requestSignal,
} from './common.js';

const URL = 'https://api.groq.com/openai/v1/chat/completions';

export function createGroq({
  apiKey, model, fetchImpl = globalThis.fetch, sleep = defaultSleep, log = () => {},
  maxRetries = 2, timeoutMs = 60_000, random = Math.random, now = Date.now,
}) {
  async function callOnce(prompt, opts) {
    assertTime({ ...opts, now }, 5_000, 'llamar a groq');
    const user = prompt.parts.map((p) => p.text).join('\n\n');
    let res;
    try {
      res = await fetchImpl(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${prompt.system}\n\nResponde únicamente con un objeto JSON válido.` },
            { role: 'user', content: user },
          ],
        }),
        signal: requestSignal(timeoutMs, { ...opts, now }),
      });
    } catch (err) {
      if (opts.signal?.aborted || now() >= (opts.deadline ?? Infinity)) throw new OutOfTimeError('tiempo agotado esperando a groq');
      throw new LlmError(`groq: error de red (${err.message})`, { retryable: true });
    }
    const { json, text } = await readJsonBody(res);
    if (!res.ok) throw httpError('groq', res, json, text);
    return parseJsonLoose(json?.choices?.[0]?.message?.content ?? '');
  }

  async function generate(prompt, opts = {}) {
    if (prompt.parts.some((p) => p.type !== 'text')) throw new NonTextualInputError('groq');
    let retries = 0;
    let invalid = 0;
    for (;;) {
      try {
        return { json: await callOnce(prompt, opts), model: `groq:${model}` };
      } catch (err) {
        if (err instanceof LlmError && err.retryable && retries < maxRetries) {
          const wait = backoffMs(retries, err.retryAfterMs, random);
          assertTime({ ...opts, now }, wait + 5_000, 'reintentar groq');
          log('warn', `groq: ${err.message}; reintento ${retries + 1}/${maxRetries}.`);
          retries++;
          await sleep(wait);
          continue;
        }
        if (err instanceof InvalidOutputError && invalid < 1) { invalid++; continue; }
        throw err;
      }
    }
  }

  return { name: 'groq', generate };
}
