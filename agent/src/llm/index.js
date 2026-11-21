// Cadena de proveedores de IA según LLM_PROVIDERS (por defecto: gemini → groq).
import { createGemini } from './gemini.js';
import { createGroq } from './groq.js';
import { LlmError, NonTextualInputError, OutOfTimeError, assertTime } from './common.js';

export const FALLBACK_RESERVE_MS = 75_000;

export function createLlm({ config, fetchImpl = globalThis.fetch, sleep, log = () => {}, providers: injected }) {
  const providers = injected ?? config.providers.map((p) => (p === 'gemini'
    ? createGemini({ apiKey: config.geminiKey, models: config.geminiModels, fetchImpl, sleep, log })
    : createGroq({ apiKey: config.groqKey, model: config.groqModel, fetchImpl, sleep, log })));

  /** opts: { signal, deadline } — ningún proveedor empieza ni reintenta si no cabe antes del deadline. */
  async function generate(prompt, opts = {}) {
    const causes = [];
    const textOnly = (prompt?.parts ?? []).every((part) => part.type === 'text');
    for (const [i, p] of providers.entries()) {
      assertTime(opts, 5_000, `usar el proveedor ${p.name}`);
      // Si hay un respaldo que puede atender esta entrega, se le reserva tiempo para que alcance a actuar.
      const hasFallback = i < providers.length - 1 && (textOnly || providers.slice(i + 1).some((q) => q.name !== 'groq'));
      const deadline = opts.deadline ?? Infinity;
      const sub = hasFallback && deadline !== Infinity && deadline - Date.now() > FALLBACK_RESERVE_MS + 20_000
        ? { ...opts, deadline: deadline - FALLBACK_RESERVE_MS } : opts;
      try {
        return await p.generate(prompt, sub);
      } catch (err) {
        if (err instanceof OutOfTimeError && (sub === opts || opts.signal?.aborted)) throw err;
        if (err instanceof OutOfTimeError) {
          causes.push(`${p.name}: sin respuesta a tiempo`);
          log('warn', `Proveedor ${p.name} no respondió a tiempo; se usa el respaldo.`);
          continue;
        }
        if (err instanceof NonTextualInputError) causes.push(`${p.name}: omitido (${err.message})`);
        else {
          causes.push(`${p.name}: ${err.message}`);
          log('warn', `Proveedor ${p.name} falló; se prueba el siguiente si existe.`);
        }
      }
    }
    throw new LlmError(`Todos los proveedores de IA fallaron → ${causes.join(' || ')}`);
  }

  return { generate, providers };
}
