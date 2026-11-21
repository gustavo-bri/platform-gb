import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGemini } from '../src/llm/gemini.js';
import { createGroq } from '../src/llm/groq.js';
import { createLlm } from '../src/llm/index.js';
import { NonTextualInputError, parseJsonLoose, backoffMs } from '../src/llm/common.js';
import { mockFetch, jsonResponse, noSleep, silentLog, baseConfig } from './helpers.js';

const prompt = { system: 'sys', parts: [{ type: 'text', text: 'hola' }] };
const geminiOk = (obj) => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] });
const modelsList = (names) => jsonResponse({ models: names.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) });

test('gemini: descubre modelos y usa el primero disponible de la lista preferida', async () => {
  const f = mockFetch((url) => {
    if (url.includes('/models?')) return modelsList(['gemini-2.5-flash', 'm-otro']);
    if (url.includes('gemini-2.5-flash:generateContent')) return geminiOk({ resumen: 'ok' });
    return jsonResponse({}, 404);
  });
  const g = createGemini({ apiKey: 'k', models: ['gemini-9-flash', 'gemini-2.5-flash'], fetchImpl: f, sleep: noSleep, log: silentLog });
  const r = await g.generate(prompt);
  assert.deepEqual(r, { json: { resumen: 'ok' }, model: 'gemini-2.5-flash' });
  const body = f.calls[1].body;
  assert.equal(f.calls[1].init.headers['x-goog-api-key'], 'k');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseSchema.type, 'OBJECT');
  assert.equal(body.generationConfig.temperature, 0.1);
  assert.equal(body.systemInstruction.parts[0].text, 'sys');
  // caché: un segundo generate no vuelve a listar
  await g.generate(prompt);
  assert.equal(f.calls.filter((c) => c.url.includes('/models?')).length, 1);
});

test('gemini: partes inline se envían como inline_data', async () => {
  const f = mockFetch((url) => (url.includes('/models?') ? modelsList(['m1']) : geminiOk({ a: 1 })));
  const g = createGemini({ apiKey: 'k', models: ['m1'], fetchImpl: f, sleep: noSleep });
  await g.generate({ system: 's', parts: [{ type: 'text', text: 't' }, { type: 'inline', mime: 'application/pdf', data: 'QUJD' }] });
  assert.deepEqual(f.calls[1].body.contents[0].parts[1], { inline_data: { mime_type: 'application/pdf', data: 'QUJD' } });
});

test('gemini: 500 genérico → un reintento respetando retryDelay, luego éxito', async () => {
  const waits = [];
  let n = 0;
  const f = mockFetch((url) => {
    if (url.includes('/models?')) return modelsList(['m1']);
    n++;
    if (n === 1) return jsonResponse({ error: { code: 500, message: 'interno', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' }] } }, 500);
    return geminiOk({ ok: true });
  });
  const g = createGemini({ apiKey: 'k', models: ['m1'], fetchImpl: f, sleep: async (ms) => waits.push(ms), log: silentLog, random: () => 0 });
  const r = await g.generate(prompt);
  assert.equal(r.json.ok, true);
  assert.deepEqual(waits, [7000]);
});

test('gemini: modelo saturado (503) o sin respuesta → cambia de modelo sin esperar y no insiste en la siguiente entrega', async () => {
  const waits = [];
  const f = mockFetch((url) => {
    if (url.includes('/models?')) return modelsList(['m1', 'm2']);
    if (url.includes('m1:')) return jsonResponse({ error: { message: 'This model is currently experiencing high demand.' } }, 503);
    return geminiOk({ ok: 2 });
  });
  const g = createGemini({ apiKey: 'k', models: ['m1', 'm2'], fetchImpl: f, sleep: async (ms) => waits.push(ms), log: silentLog });
  assert.equal((await g.generate(prompt)).model, 'm2');
  assert.equal((await g.generate(prompt)).model, 'm2');
  assert.deepEqual(waits, [], 'no espera ante saturación');
  assert.equal(f.calls.filter((c) => c.url.includes('m1:')).length, 1, 'el modelo saturado se intenta una sola vez por ejecución');
});

test('gemini: modelo que no responde (timeout) → pasa al siguiente modelo', async () => {
  const f = async (url, init) => {
    if (url.includes('/models?')) return modelsList(['lento', 'rapido']);
    if (url.includes('lento:')) {
      await new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('The operation was aborted due to timeout'))));
    }
    return geminiOk({ ok: 1 });
  };
  const g = createGemini({ apiKey: 'k', models: ['lento', 'rapido'], fetchImpl: f, sleep: noSleep, log: silentLog, timeoutMs: 50 });
  const keepAlive = setTimeout(() => {}, 5_000); // en producción la conexión de red mantiene vivo el proceso
  try {
    assert.equal((await g.generate(prompt, { deadline: Date.now() + 60_000 })).model, 'rapido');
  } finally { clearTimeout(keepAlive); }
});

test('cadena: si Gemini consume su tiempo, queda tiempo reservado para Groq (entregas de texto)', async () => {
  const { createLlm } = await import('../src/llm/index.js');
  const { OutOfTimeError } = await import('../src/llm/common.js');
  let geminiDeadline;
  const llm = createLlm({ config: {}, log: silentLog, providers: [
    { name: 'gemini', generate: async (_p, o) => { geminiDeadline = o.deadline; throw new OutOfTimeError(); } },
    { name: 'groq', generate: async () => ({ json: { ok: 1 }, model: 'groq-m' }) },
  ] });
  const deadline = Date.now() + 240_000;
  const r = await llm.generate(prompt, { deadline });
  assert.equal(r.model, 'groq-m');
  assert.ok(deadline - geminiDeadline >= 75_000, 'Gemini recibió un límite que deja ≥75 s para Groq');
});

test('gemini: 429 cambia de modelo de inmediato; 404 también', async () => {
  const f = mockFetch((url) => {
    if (url.includes('/models?')) return jsonResponse({ error: { message: 'x' } }, 500); // listado falla → lista tal cual
    if (url.includes('m1:')) return jsonResponse({ error: { message: 'cuota' } }, 429);
    if (url.includes('m2:')) return jsonResponse({ error: { message: 'not found' } }, 404);
    return geminiOk({ ok: 3 });
  });
  const g = createGemini({ apiKey: 'k', models: ['m1', 'm2', 'm3'], fetchImpl: f, sleep: noSleep, log: silentLog });
  const r = await g.generate(prompt);
  assert.equal(r.model, 'm3');
  assert.equal(f.calls.filter((c) => c.url.includes('m1:')).length, 1, 'cuota agotada (429): cambia de modelo sin reintentar');
  assert.equal(f.calls.filter((c) => c.url.includes('m2:')).length, 1, '404 no se reintenta');
});

test('gemini: 400 por esquema → reintenta sin responseSchema', async () => {
  let n = 0;
  const f = mockFetch((url) => {
    if (url.includes('/models?')) return modelsList(['m1']);
    n++;
    return n === 1 ? jsonResponse({ error: { message: 'Invalid JSON payload: responseSchema not supported' } }, 400) : geminiOk({ ok: 1 });
  });
  const g = createGemini({ apiKey: 'k', models: ['m1'], fetchImpl: f, sleep: noSleep, log: silentLog });
  await g.generate(prompt);
  assert.ok(f.calls[1].body.generationConfig.responseSchema);
  assert.equal(f.calls[2].body.generationConfig.responseSchema, undefined);
});

test('gemini: JSON inválido → 1 reintento, luego siguiente modelo; ignora partes de razonamiento', async () => {
  const f = mockFetch((url) => {
    if (url.includes('/models?')) return modelsList(['m1', 'm2']);
    if (url.includes('m1:')) return jsonResponse({ candidates: [{ content: { parts: [{ text: 'no es json' }] } }] });
    return jsonResponse({ candidates: [{ content: { parts: [{ text: 'pensando...', thought: true }, { text: '```json\n{"v":2}\n```' }] } }] });
  });
  const g = createGemini({ apiKey: 'k', models: ['m1', 'm2'], fetchImpl: f, sleep: noSleep, log: silentLog });
  const r = await g.generate(prompt);
  assert.deepEqual(r, { json: { v: 2 }, model: 'm2' });
  assert.equal(f.calls.filter((c) => c.url.includes('m1:')).length, 2);
});

test('gemini: respuesta bloqueada y clave inválida', async () => {
  const blocked = mockFetch((url) => (url.includes('/models?') ? modelsList(['m1']) : jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } })));
  await assert.rejects(createGemini({ apiKey: 'k', models: ['m1'], fetchImpl: blocked, sleep: noSleep }).generate(prompt), /SAFETY/);
  const badKey = mockFetch(() => jsonResponse({ error: { message: 'API key not valid' } }, 403));
  await assert.rejects(createGemini({ apiKey: 'k', models: ['m1', 'm2'], fetchImpl: badKey, sleep: noSleep }).generate(prompt), /403/);
  assert.equal(badKey.calls.length, 1, 'clave inválida: no sigue probando');
});

test('groq: formato OpenAI y rechazo de partes inline', async () => {
  const f = mockFetch(() => jsonResponse({ choices: [{ message: { content: '{"resumen":"x"}' } }] }));
  const q = createGroq({ apiKey: 'gk', model: 'gq', fetchImpl: f, sleep: noSleep });
  const r = await q.generate(prompt);
  assert.deepEqual(r, { json: { resumen: 'x' }, model: 'groq:gq' });
  assert.equal(f.calls[0].body.response_format.type, 'json_object');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer gk');
  await assert.rejects(q.generate({ system: 's', parts: [{ type: 'inline', mime: 'application/pdf', data: 'x' }] }), NonTextualInputError);
});

test('cadena de proveedores: si gemini falla usa groq; si todo falla resume las causas', async () => {
  const failing = { name: 'gemini', generate: async () => { throw new Error('caído'); } };
  const ok = { name: 'groq', generate: async () => ({ json: { a: 1 }, model: 'groq:x' }) };
  const llm = createLlm({ config: baseConfig(), providers: [failing, ok], log: silentLog });
  assert.equal((await llm.generate(prompt)).model, 'groq:x');
  const nonText = { name: 'groq', generate: async () => { throw new NonTextualInputError('groq'); } };
  await assert.rejects(createLlm({ config: baseConfig(), providers: [failing, nonText] }).generate(prompt), /gemini: caído \|\| groq: omitido/);
});

test('utilidades: parseJsonLoose y backoff', () => {
  assert.deepEqual(parseJsonLoose('Aquí va:\n{"a":1}\nfin'), { a: 1 });
  assert.throws(() => parseJsonLoose('[1,2]'), /JSON válido/);
  assert.equal(backoffMs(0, null, () => 0), 2000);
  assert.equal(backoffMs(2, null, () => 0), 8000);
  assert.equal(backoffMs(0, 120000), 60000, 'Retry-After se limita a 60 s');
});
