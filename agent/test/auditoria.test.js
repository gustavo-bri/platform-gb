// Pruebas de las correcciones de la auditoría independiente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createDb, validateStoragePath } from '../src/supabase.js';
import { runEvaluations } from '../src/evaluator.js';
import { createGemini } from '../src/llm/gemini.js';
import { createLlm } from '../src/llm/index.js';
import { OutOfTimeError } from '../src/llm/common.js';
import { normalizeEvaluation, detectLeak, normWords, LEAK_ALERT } from '../src/evaluation.js';
import { buildPrompt } from '../src/prompt.js';
import { extractContent, readZipEntries, readZipEntry } from '../src/files.js';
import { mask, maskEmails } from '../src/privacy.js';
import { loadConfig, describeConfig } from '../src/config.js';
import { runNotifications, localHour } from '../src/notifier.js';
import { createMailer } from '../src/mailer.js';
import { main } from '../src/index.js';
import { mockFetch, jsonResponse, fakeDb, baseConfig, claimCtx, modelOutput, silentLog, makeZip, noSleep } from './helpers.js';

// ── 1. Recorrido de rutas ──────────────────────────────────────────────
test('download rechaza rutas con "..", vacías, codificadas o con barras invertidas, sin llamar a fetch', async () => {
  const f = mockFetch(() => new Response('secreto'));
  const db = createDb({ url: 'https://x.supabase.co', serviceKey: 'sb_secret_x', fetchImpl: f });
  const malas = [
    's/a/u/../../../../rest/v1/activity_keys', 's/a/u/./x.pdf', 's//a/x.pdf', '/s/a/x.pdf', 's/a/x.pdf/',
    's/a/%2e%2e/x', 's/a/%2E%2E/x', 's/a/.%2e/x', 's\\a\\..\\x', 's/a%2f..%2fx', 's/a/x%00.pdf', 's/a/\u0001.pdf', '..', '',
  ];
  for (const p of malas) await assert.rejects(db.download('entregas', p), /Ruta de archivo inválida/, `debe rechazar ${JSON.stringify(p)}`);
  await assert.rejects(db.download('otro', 's/a/x.pdf'), /Bucket no permitido/);
  assert.equal(f.calls.length, 0, 'ninguna petición salió con la clave secreta');
  // ruta válida con espacios y caracteres especiales sigue funcionando
  await db.download('entregas', 's/a/u/171-mi tarea (v2).pdf');
  assert.equal(new URL(f.calls[0].url).pathname, '/storage/v1/object/entregas/s/a/u/171-mi%20tarea%20(v2).pdf');
  assert.doesNotThrow(() => validateStoragePath('materiales', 'a/b/referencia/sol..final.pdf'), 'puntos dentro de un nombre son válidos');
});

test('el evaluador no descarga rutas maliciosas (entrega, enunciado, referencia) y registra el fallo', async () => {
  const downloads = [];
  const mk = (over) => {
    const db = fakeDb({ claim_submissions: ((b) => () => b.shift() ?? [])([[claimCtx(over)]]), fail_evaluation: null, complete_evaluation: 'evaluada' });
    db.download = async (b, p) => { downloads.push(`${b}/${p}`); return { buffer: Buffer.from('x'), mime: 'text/plain' }; };
    return db;
  };
  const llm = { generate: async () => ({ json: modelOutput(), model: 'm' }) };
  const db1 = mk({ submission: { file_path: 's/a/u/../../../rest/v1/activity_keys', file_name: 'x.txt' } });
  await runEvaluations({ db: db1, llm, config: baseConfig(), log: silentLog });
  assert.match(db1.callsTo('fail_evaluation')[0].args.p_error, /Ruta de archivo inválida/);
  const logs = [];
  const db2 = mk({ activity: { statement_path: 's/a/../../x', statement_name: 'e.txt' }, key: { reference_path: 's/a/%2e%2e/r', reference_name: 'r.txt' } });
  await runEvaluations({ db: db2, llm, config: baseConfig(), log: (l, m) => logs.push(m) });
  assert.equal(db2.callsTo('complete_evaluation').length, 1, 'enunciado/referencia inválidos se omiten con advertencia');
  assert.equal(logs.filter((m) => /Ruta de archivo inválida/.test(m)).length, 2);
  assert.equal(downloads.length, 0);
});

// ── 2. Tiempo ──────────────────────────────────────────────────────────
test('gemini no espera un reintento que no cabe antes del deadline', async () => {
  const slept = [];
  const f = mockFetch((url) => (url.includes('/models?')
    ? jsonResponse({ models: [{ name: 'models/m1', supportedGenerationMethods: ['generateContent'] }, { name: 'models/m2', supportedGenerationMethods: ['generateContent'] }] })
    : jsonResponse({ error: { message: 'cuota', details: [{ retryDelay: '30s' }] } }, 429)));
  const g = createGemini({ apiKey: 'k', models: ['m1', 'm2'], fetchImpl: f, sleep: async (ms) => slept.push(ms), log: silentLog });
  await assert.rejects(g.generate({ system: 's', parts: [{ type: 'text', text: 't' }] }, { deadline: Date.now() + 10_000 }), OutOfTimeError);
  assert.deepEqual(slept, [], 'no duerme 30 s si solo quedan 10 s');
  assert.equal(f.calls.filter((c) => c.url.includes(':generateContent')).length, 1, 'no prueba más modelos sin tiempo');
});

test('la cadena de proveedores se detiene ante falta de tiempo o señal abortada', async () => {
  let groqCalls = 0;
  const llm = createLlm({ config: baseConfig(), providers: [
    { name: 'gemini', generate: async () => { throw new OutOfTimeError(); } },
    { name: 'groq', generate: async () => { groqCalls++; return { json: {}, model: 'g' }; } },
  ] });
  await assert.rejects(llm.generate({ system: '', parts: [] }), OutOfTimeError);
  assert.equal(groqCalls, 0);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(llm.generate({ system: '', parts: [] }, { signal: ac.signal }), OutOfTimeError);
});

test('una entrega que excede su tiempo máximo se aborta y va a fail_evaluation; no se guarda resultado tardío', async () => {
  let seenSignal;
  const llm = { generate: (p, opts) => { seenSignal = opts.signal; return new Promise(() => {}); } }; // la IA nunca responde
  const db = fakeDb({ claim_submissions: ((b) => () => b.shift() ?? [])([[claimCtx()]]), fail_evaluation: null, complete_evaluation: 'evaluada' });
  const stats = await runEvaluations({ db, llm, config: baseConfig({ maxItemMs: 50 }), log: silentLog });
  assert.equal(stats.timedOut, 1);
  assert.equal(seenSignal.aborted, true, 'la llamada a la IA recibió la señal abortada');
  assert.match(db.callsTo('fail_evaluation')[0].args.p_error, /Tiempo máximo de evaluación agotado/);
  assert.equal(db.callsTo('complete_evaluation').length, 0);
});

test('presupuesto por entrega = min(240 s, restante − 60 s)', async () => {
  let deadlineSeen;
  const llm = { generate: async (p, opts) => { deadlineSeen = opts.deadline; return { json: modelOutput(), model: 'm' }; } };
  const db = fakeDb({ claim_submissions: ((b) => () => b.shift() ?? [])([[claimCtx()]]), complete_evaluation: 'evaluada' });
  const t0 = Date.now();
  await runEvaluations({ db, llm, config: baseConfig(), log: silentLog, deadline: t0 + 150_000 });
  assert.ok(deadlineSeen - t0 <= 90_000 + 50 && deadlineSeen - t0 >= 89_000, `deadline de la entrega ≈ 90 s (fue ${deadlineSeen - t0})`);
});

test('index: notifica antes y después de evaluar (los recordatorios no dependen de la evaluación)', async () => {
  const f = mockFetch((url) => {
    if (url.includes('/rpc/emails_sent_since')) return jsonResponse(0);
    if (url.includes('/rpc/')) return jsonResponse([]);
    return jsonResponse({}, 404);
  });
  const code = await main({ env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GEMINI_API_KEY: 'g', DRY_RUN: 'true' }, fetchImpl: f, log: silentLog });
  assert.equal(code, 0);
  const seq = f.calls.map((c) => c.url.split('/rpc/')[1]).filter((n) => ['due_reminders', 'claim_submissions'].includes(n));
  assert.deepEqual(seq, ['due_reminders', 'claim_submissions', 'due_reminders']);
});

test('index: si la evaluación falla, los recordatorios se envían igual', async () => {
  const f = mockFetch((url) => {
    if (url.includes('/rpc/claim_submissions')) return jsonResponse({ message: 'boom' }, 500);
    if (url.includes('/rpc/emails_sent_since')) return jsonResponse(0);
    if (url.includes('/rpc/')) return jsonResponse([]);
    return jsonResponse({}, 404);
  });
  const code = await main({ env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GEMINI_API_KEY: 'g', DRY_RUN: 'true' }, fetchImpl: f, log: silentLog });
  assert.equal(code, 1);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/rpc/due_reminders')).length, 2);
});

// ── 3. Revelación de la solución ───────────────────────────────────────
const REF = 'La función recursiva debe verificar primero el caso base cuando n es igual a cero y retornar uno.';
const leakMeta = (studentText = 'mi función no tiene caso base') => ({ hasReference: true, hasRubric: false, warnings: [], studentText, privateTexts: [REF, 'Penalizar si no usa memoización en la versión iterativa del ejercicio dos'] });

test('normWords quita tildes, mayúsculas y puntuación', () => {
  assert.deepEqual(normWords('¡Función RECURSIVA, ñandú!'), ['funcion', 'recursiva', 'nandu']);
});

test('retroalimentación que copia ≥8 palabras de la referencia → alerta y revisión', () => {
  const out = modelOutput({ errores: [{ descripcion: 'Falta el caso base', evidencia: 'línea 2', como_corregir: 'La funcion recursiva debe verificar primero el caso base cuando n es igual a cero', severidad: 'alta' }] });
  const r = normalizeEvaluation(out, { meta: leakMeta() });
  assert.ok(r.feedback.alertas.includes(LEAK_ALERT));
  assert.equal(r.needsReview, true);
  assert.match(r.feedback.motivo_revision, /revelar la solución/);
});

test('notas privadas también cuentan; secuencias que ya escribió el estudiante no', () => {
  const notes = modelOutput({ recomendaciones: ['Recuerda: penalizar si no usa memoización en la versión iterativa del ejercicio.'] });
  assert.ok(normalizeEvaluation(notes, { meta: leakMeta() }).feedback.alertas.includes(LEAK_ALERT));
  const quoted = 'debe verificar primero el caso base cuando n es igual a cero';
  const own = modelOutput({ criterios: [{ nombre: 'Corrección', peso: 100, puntaje: 90, evidencia: `"${quoted}"`, comentario: 'Cumple.' }] });
  const r = normalizeEvaluation(own, { meta: leakMeta(`Mi solución: ${quoted} y luego multiplico.`) });
  assert.ok(!r.feedback.alertas.includes(LEAK_ALERT), 'citar al propio estudiante no es fuga');
  assert.equal(detectLeak({ resumen: 'x', criterios: [], errores: [], aciertos: [], recomendaciones: [] }, [], ''), false);
  assert.equal(r.needsReview, false);
});

test('prompt: meta.privateTexts incluye referencia, notas privadas y texto del archivo de referencia', () => {
  const ref = { parts: [{ type: 'text', text: 'Archivo: solucion_referencia.txt\nTEXTO DEL ARCHIVO' }], warnings: [], unreadable: false };
  const p = buildPrompt(claimCtx(), { reference: ref });
  assert.equal(p.meta.privateTexts.length, 3);
  assert.ok(p.meta.privateTexts.some((t) => t.includes('TEXTO DEL ARCHIVO')));
});

// ── 4. Bomba de descompresión ──────────────────────────────────────────
test('zip con 30 MB de ceros: se descarta con advertencia, sin lanzar', () => {
  const zeros = Buffer.alloc(30 * 1024 * 1024);
  assert.ok(zlib.deflateRawSync(zeros).length < 100_000);
  const zip = makeZip([{ name: 'bomba.txt', data: zeros }, { name: 'ok.py', data: 'print(1)' }]);
  const r = extractContent({ buffer: zip, name: 'p.zip' });
  assert.ok(r.warnings.some((w) => /bomba\.txt/.test(w)));
  assert.match(r.parts[0].text, /print\(1\)/);
  // tamaño declarado mentiroso (dice 10 B, se expande a 30 MB)
  const liar = makeZip([{ name: 'mentira.md', data: zeros, declaredSize: 10 }]);
  const entry = readZipEntries(liar)[0];
  assert.throws(() => readZipEntry(liar, entry), /bomba de descompresión/);
  const r2 = extractContent({ buffer: liar, name: 'p.zip' });
  assert.ok(r2.warnings.some((w) => /mentira\.md/.test(w)));
  assert.equal(r2.unreadable, true);
  // mentiroso que declara 4 MB y se expande a 30 MB (tope = min(declarado, 5 MB))
  const liar4 = makeZip([{ name: 'm.pdf', data: zeros, declaredSize: 4 * 1024 * 1024 }]);
  assert.throws(() => readZipEntry(liar4, readZipEntries(liar4)[0]), /bomba/);
});

test('docx con document.xml bomba (directo y dentro de zip) no revienta', () => {
  const bombXml = Buffer.concat([Buffer.from('<w:document><w:body><w:p><w:r><w:t>'), Buffer.alloc(20 * 1024 * 1024, 0x61), Buffer.from('</w:t></w:r></w:p></w:body></w:document>')]);
  const docx = makeZip([{ name: 'word/document.xml', data: bombXml }]);
  const r = extractContent({ buffer: docx, name: 'a.docx' });
  assert.equal(r.unreadable, true);
  assert.match(r.warnings[0], /5 MB/);
  const r2 = extractContent({ buffer: makeZip([{ name: 'informe.docx', data: docx, store: true }, { name: 'a.py', data: 'x=1' }]), name: 'p.zip' });
  assert.ok(r2.warnings.some((w) => /informe\.docx|document\.xml/.test(w)));
  assert.match(r2.parts[0].text, /x=1/);
});

// ── 5. Datos personales en logs ────────────────────────────────────────
test('mask y maskEmails', () => {
  assert.equal(mask('ana.perez@gmail.com'), 'an***@gmail.com');
  assert.equal(mask('a@x.co'), 'a***@x.co');
  assert.equal(mask('sin-arroba'), '***');
  assert.equal(maskEmails('550 5.1.1 <beto.rios@gmail.com>: no existe; cc ana@uni.edu.co'), '550 5.1.1 <be***@gmail.com>: no existe; cc an***@uni.edu.co');
  const c = loadConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GEMINI_API_KEY: 'g', GMAIL_USER: 'profe.uno@gmail.com', GMAIL_APP_PASSWORD: 'p' });
  assert.ok(!JSON.stringify(describeConfig(c)).includes('profe.uno@'));
});

test('errores SMTP en el log no exponen correos', async () => {
  const logs = [];
  const db = fakeDb({
    emails_sent_since: 0, feedback_notices: [], new_activity_notices: [], teacher_digests: [],
    due_reminders: [{ user_id: 'u', email: 'beto.rios@gmail.com', full_name: 'Beto', activity_id: 'a', activity_title: 'Q', subject_name: 'P', component: 'quiz', corte: 1, due_at: '2026-11-20T00:00:00Z', kind: 'rec24:1' }],
    claim_notification: true, release_notification: null,
  });
  const transport = { sendMail: async () => { throw new Error('550 Mailbox beto.rios@gmail.com unavailable'); } };
  await runNotifications({ db, mailer: createMailer(baseConfig(), { transport }), config: baseConfig(), log: (l, m) => logs.push(m), now: new Date('2026-11-19T15:00:00Z') });
  const all = logs.join('\n');
  assert.ok(!all.includes('beto.rios@'), all);
  assert.match(all, /be\*\*\*@gmail\.com/);
});

// ── 6. Hora del resumen diario ─────────────────────────────────────────
test('el resumen diario no sale antes de DIGEST_HOUR (hora local)', async () => {
  const mk = () => fakeDb({ emails_sent_since: 0, feedback_notices: [], due_reminders: [], new_activity_notices: [], teacher_digests: [], claim_notification: true });
  const mailer = createMailer(baseConfig(), { transport: { sendMail: async () => ({}) } });
  const madrugada = new Date('2026-11-19T08:00:00Z'); // 03:00 en Bogotá
  assert.equal(localHour(madrugada, 'America/Bogota'), 3);
  const db1 = mk();
  await runNotifications({ db: db1, mailer, config: baseConfig({ digestHour: 7 }), log: silentLog, now: madrugada });
  assert.equal(db1.callsTo('teacher_digests').length, 0);
  const db2 = mk();
  await runNotifications({ db: db2, mailer, config: baseConfig({ digestHour: 7 }), log: silentLog, now: new Date('2026-11-19T12:05:00Z') }); // 07:05
  assert.equal(db2.callsTo('teacher_digests').length, 1);
  const db3 = mk();
  await runNotifications({ db: db3, mailer, config: baseConfig({ digestHour: 0 }), log: silentLog, now: madrugada });
  assert.equal(db3.callsTo('teacher_digests').length, 1);
  assert.equal(loadConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GEMINI_API_KEY: 'g' }).digestHour, 7);
  assert.throws(() => loadConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GEMINI_API_KEY: 'g', DIGEST_HOUR: '25' }), /DIGEST_HOUR/);
});
