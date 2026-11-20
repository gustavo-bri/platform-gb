// Cadena de proveedores de IA según LLM_PROVIDERS (por defecto: gemini → groq).
import { createGemini } from './gemini.js';
import { createGroq } from './groq.js';
import { LlmError, NonTextualInputError, OutOfTimeError, assertTime } from './common.js';

export function createLlm({ config, fetchImpl = globalThis.fetch, sleep, log = () => {}, providers: injected }) {
  const providers = injected ?? config.providers.map((p) => (p === 'gemini'
    ? createGemini({ apiKey: config.geminiKey, models: config.geminiModels, fetchImpl, sleep, log })
    : createGroq({ apiKey: config.groqKey, model: config.groqModel, fetchImpl, sleep, log })));

  /** opts: { signal, deadline } — ningún proveedor empieza ni reintenta si no cabe antes del deadline. */
  async function generate(prompt, opts = {}) {
    const causes = [];
    for (const p of providers) {
      assertTime(opts, 5_000, `usar el proveedor ${p.name}`);
      try {
        return await p.generate(prompt, opts);
      } catch (err) {
        if (err instanceof OutOfTimeError) throw err;
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
