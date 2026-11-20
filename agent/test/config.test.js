import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, describeConfig, ConfigError } from '../src/config.js';
import { createDb } from '../src/supabase.js';
import { main } from '../src/index.js';
import { mockFetch, jsonResponse } from './helpers.js';

const env = (over = {}) => ({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'svc-secret', GEMINI_API_KEY: 'gem-secret', ...over });

test('config: valores por defecto y proveedores sin clave se ignoran', () => {
  const c = loadConfig(env({ GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', GMAIL_USER: 'p@gmail.com' }));
  assert.equal(c.supabaseUrl, 'https://x.supabase.co');
  assert.deepEqual(c.providers, ['gemini']);
  assert.equal(c.geminiModels[0], 'gemini-3.8-flash');
  assert.equal(c.groqModel, 'openai/gpt-oss-120b');
  assert.equal(c.gmailPass, 'abcdefghijklmnop', 'quita espacios de la contraseña de aplicación');
  assert.equal(c.mailEnabled, true);
  assert.equal(c.timezone, 'America/Bogota');
  assert.equal(c.emailDailyBudget, 450);
  assert.equal(c.dryRun, false);
  assert.equal(c.minConfidence, 0.6);
  const d = JSON.stringify(describeConfig(c));
  assert.ok(!d.includes('svc-secret') && !d.includes('gem-secret') && !d.includes('abcdefgh'), 'no expone claves');
});

test('config: errores claros', () => {
  assert.throws(() => loadConfig({}), (e) => e instanceof ConfigError && /SUPABASE_URL/.test(e.message) && /SUPABASE_SERVICE_ROLE_KEY/.test(e.message) && /GEMINI_API_KEY/.test(e.message));
  assert.throws(() => loadConfig(env({ LLM_PROVIDERS: 'openai' })), /desconocidos: openai/);
  assert.throws(() => loadConfig(env({ EMAIL_DAILY_BUDGET: 'mucho' })), /EMAIL_DAILY_BUDGET/);
  const g = loadConfig(env({ GEMINI_API_KEY: '', GROQ_API_KEY: 'q', DRY_RUN: 'true' }));
  assert.deepEqual(g.providers, ['groq']);
  assert.equal(g.dryRun, true);
  assert.equal(g.mailEnabled, false);
});

test('supabase: rpc con cabeceras, errores PostgREST legibles, descarga codificada', async () => {
  const f = mockFetch((url) => {
    if (url.endsWith('/rpc/ok')) return jsonResponse([{ a: 1 }]);
    if (url.endsWith('/rpc/void')) return new Response(null, { status: 204 });
    if (url.includes('/storage/')) return new Response(Buffer.from('PDF'), { status: 200, headers: { 'content-type': 'application/pdf; charset=binary' } });
    return jsonResponse({ message: 'permission denied for function x', hint: 'revisa grants' }, 403);
  });
  const db = createDb({ url: 'https://x.supabase.co/', serviceKey: 'k', fetchImpl: f });
  assert.deepEqual(await db.rpc('ok', { p: 1 }), [{ a: 1 }]);
  assert.equal(f.calls[0].url, 'https://x.supabase.co/rest/v1/rpc/ok');
  assert.equal(f.calls[0].init.headers.apikey, 'k');
  assert.equal(f.calls[0].init.headers.Authorization, undefined, 'clave nueva (no JWT) nunca va en Authorization');
  const fj = mockFetch(() => jsonResponse([]));
  await createDb({ url: 'https://x.supabase.co', serviceKey: 'eyJhbGciOi.legacy', fetchImpl: fj }).rpc('ok');
  assert.equal(fj.calls[0].init.headers.Authorization, 'Bearer eyJhbGciOi.legacy', 'clave heredada JWT también en Authorization');
  assert.deepEqual(f.calls[0].body, { p: 1 });
  assert.equal(await db.rpc('void'), null);
  await assert.rejects(db.rpc('mal'), /RPC mal falló \(HTTP 403\): permission denied for function x · revisa grants/);
  const dl = await db.download('entregas', 'a/b/c/171 mi tarea#1.pdf');
  assert.equal(f.calls.at(-1).url, 'https://x.supabase.co/storage/v1/object/entregas/a/b/c/171%20mi%20tarea%231.pdf');
  assert.equal(dl.mime, 'application/pdf');
  assert.equal(dl.buffer.toString(), 'PDF');
});

test('main: configuración inválida devuelve 1 sin lanzar', async () => {
  const lines = [];
  const code = await main({ env: {}, log: (l, m) => lines.push(m) });
  assert.equal(code, 1);
  assert.match(lines[0], /Configuración inválida/);
});

test('main: ejecución completa sin pendientes (DRY_RUN) devuelve 0', async () => {
  const f = mockFetch((url) => {
    if (url.includes('/rpc/emails_sent_since')) return jsonResponse(0);
    if (url.includes('/rpc/')) return jsonResponse([]);
    return jsonResponse({}, 404);
  });
  const lines = [];
  const code = await main({ env: env({ DRY_RUN: 'true' }), fetchImpl: f, log: (l, m) => lines.push(`${l} ${m}`) });
  assert.equal(code, 0);
  assert.ok(lines.some((l) => /Ejecución terminada/.test(l)));
  assert.ok(f.calls.some((c) => c.url.endsWith('/rpc/claim_submissions')));
  assert.ok(f.calls.some((c) => c.url.endsWith('/rpc/teacher_digests')));
  assert.ok(!lines.join('\n').includes('svc-secret'));
});
