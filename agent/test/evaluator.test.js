import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEvaluations } from '../src/evaluator.js';
import { fakeDb, baseConfig, claimCtx, modelOutput, silentLog, fixture } from './helpers.js';

const llmReturning = (out = modelOutput(), model = 'gemini-test') => {
  const calls = [];
  return { calls, generate: async (p) => { calls.push(p); return { json: out, model }; } };
};

/** claim_submissions devuelve los lotes indicados en orden y luego vacío. */
const queue = (...batches) => () => batches.shift() ?? [];

test('éxito: reclama, evalúa y guarda con complete_evaluation', async () => {
  const db = fakeDb({ claim_submissions: queue([claimCtx()]), complete_evaluation: 'evaluada' });
  const llm = llmReturning();
  const stats = await runEvaluations({ db, llm, config: baseConfig(), log: silentLog });
  assert.deepEqual(stats, { claimed: 1, evaluated: 1, review: 0, stale: 0, failed: 0, timedOut: 0 });
  const [{ args }] = db.callsTo('complete_evaluation');
  assert.equal(args.p_submission, 'sub-1');
  assert.equal(args.p_count, 1);
  assert.equal(args.p_grade, 2.9);
  assert.equal(args.p_model, 'gemini-test');
  assert.equal(args.p_needs_review, false);
  assert.equal(args.p_feedback.version, 1);
  assert.equal(llm.calls.length, 1);
});

test('descarga entrega, enunciado y referencia; falla opcional no bloquea', async () => {
  const ctx = claimCtx({
    submission: { content_text: null, file_path: 's/a/u/1-tarea.docx', file_name: 'tarea.docx' },
    activity: { statement_path: 's/a/enunciado/e.txt', statement_name: 'e.txt' },
    key: { reference_path: 's/a/referencia/r.pdf', reference_name: 'r.pdf' },
  });
  const db = fakeDb({ claim_submissions: queue([ctx]), complete_evaluation: 'evaluada' }, {
    'entregas/s/a/u/1-tarea.docx': { buffer: fixture('tarea.docx'), mime: 'application/octet-stream' },
    'materiales/s/a/enunciado/e.txt': { buffer: Buffer.from('Enunciado en archivo'), mime: 'text/plain' },
    // referencia ausente → advertencia, no error
  });
  const llm = llmReturning();
  const stats = await runEvaluations({ db, llm, config: baseConfig(), log: silentLog });
  assert.equal(stats.evaluated, 1);
  const all = llm.calls[0].parts.map((p) => p.text ?? '').join('\n');
  assert.match(all, /Respuesta 1: una variable & su valor/);
  assert.match(all, /Enunciado en archivo/);
  assert.match(all, /Archivo: entrega\.docx/);
});

test('stale: el estudiante reenvió durante la evaluación', async () => {
  const db = fakeDb({ claim_submissions: queue([claimCtx()]), complete_evaluation: 'stale' });
  const stats = await runEvaluations({ db, llm: llmReturning(), config: baseConfig(), log: silentLog });
  assert.equal(stats.stale, 1);
  assert.equal(stats.failed, 0);
  assert.equal(db.callsTo('fail_evaluation').length, 0);
});

test('revisión: baja confianza se cuenta como revisión', async () => {
  const db = fakeDb({ claim_submissions: queue([claimCtx()]), complete_evaluation: (a) => (a.p_needs_review ? 'revision' : 'evaluada') });
  const stats = await runEvaluations({ db, llm: llmReturning(modelOutput({ confianza: 0.2 })), config: baseConfig(), log: silentLog });
  assert.equal(stats.review, 1);
});

test('fallo del modelo ⇒ fail_evaluation con mensaje, sigue con las demás', async () => {
  const c1 = claimCtx({ submission: { id: 'a' } });
  const c2 = claimCtx({ submission: { id: 'b', submission_count: 3 } });
  let n = 0;
  const llm = { generate: async () => { n++; if (n === 1) throw new Error('Todos los proveedores de IA fallaron'); return { json: modelOutput(), model: 'm' }; } };
  const db = fakeDb({ claim_submissions: queue([c1, c2]), complete_evaluation: 'evaluada', fail_evaluation: null });
  const stats = await runEvaluations({ db, llm, config: baseConfig({ evalConcurrency: 1 }), log: silentLog });
  assert.equal(stats.failed, 1);
  assert.equal(stats.evaluated, 1);
  const [{ args }] = db.callsTo('fail_evaluation');
  assert.equal(args.p_submission, 'a');
  assert.match(args.p_error, /proveedores de IA fallaron/);
});

test('descarga de la entrega fallida ⇒ fail_evaluation (se reintentará)', async () => {
  const ctx = claimCtx({ submission: { file_path: 'no/existe.pdf', file_name: 'x.pdf' } });
  const db = fakeDb({ claim_submissions: queue([ctx]), fail_evaluation: null });
  const stats = await runEvaluations({ db, llm: llmReturning(), config: baseConfig(), log: silentLog });
  assert.equal(stats.failed, 1);
  assert.match(db.callsTo('fail_evaluation')[0].args.p_error, /descargar/);
});

test('archivo ilegible sin texto: no gasta IA, nota 0 y revisión docente', async () => {
  const ctx = claimCtx({ submission: { content_text: null, file_path: 'x/y/z/a.pptx', file_name: 'a.pptx' } });
  const db = fakeDb({ claim_submissions: queue([ctx]), complete_evaluation: 'revision' }, {
    'entregas/x/y/z/a.pptx': { buffer: Buffer.from('PK...'), mime: 'application/vnd.ms-powerpoint' },
  });
  const llm = llmReturning();
  const stats = await runEvaluations({ db, llm, config: baseConfig(), log: silentLog });
  assert.equal(llm.calls.length, 0);
  assert.equal(stats.review, 1);
  const { args } = db.callsTo('complete_evaluation')[0];
  assert.equal(args.p_grade, 0);
  assert.equal(args.p_needs_review, true);
  assert.match(args.p_feedback.resumen, /No fue posible leer/);
});

test('respeta el máximo por ejecución, la concurrencia y el deadline', async () => {
  const many = Array.from({ length: 10 }, (_, i) => claimCtx({ submission: { id: `s${i}` } }));
  const limits = [];
  const db = fakeDb({
    claim_submissions: (a) => { limits.push(a.p_limit); return many.splice(0, a.p_limit); },
    complete_evaluation: 'evaluada',
  });
  let active = 0; let peak = 0;
  const llm = { generate: async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return { json: modelOutput(), model: 'm' }; } };
  const stats = await runEvaluations({ db, llm, config: baseConfig({ maxEvaluationsPerRun: 5, evalConcurrency: 2 }), log: silentLog });
  assert.equal(stats.claimed, 5);
  assert.deepEqual(limits, [4, 1]);
  assert.equal(peak, 2);

  const db2 = fakeDb({ claim_submissions: queue([claimCtx()]) });
  const s2 = await runEvaluations({ db: db2, llm, config: baseConfig(), log: silentLog, deadline: Date.now() + 30_000 });
  assert.equal(s2.claimed, 0);
  assert.equal(db2.callsTo('claim_submissions').length, 0, 'con < 90 s restantes no reclama');
});
