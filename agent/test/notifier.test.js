import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNotifications, localDay } from '../src/notifier.js';
import { createMailer } from '../src/mailer.js';
import { reminderEmail, feedbackEmail, digestEmail, newActivitiesEmail, esc } from '../src/templates.js';
import { fakeDb, baseConfig, silentLog } from './helpers.js';

const now = new Date('2026-11-19T03:30:00Z'); // 22:30 del 18 en Bogotá
const ana = { user_id: 'u-ana', email: 'ana@gmail.com', full_name: 'Ana Pérez' };
const beto = { user_id: 'u-beto', email: 'beto@gmail.com', full_name: 'Beto Ríos' };
const act = (id, extra = {}) => ({ activity_id: id, activity_title: `Actividad ${id}`, subject_name: 'Programación I', component: 'quiz', corte: 1, due_at: '2026-11-20T15:00:00Z', ...extra });

/** Simula notification_log con reservas reales. */
function dbWith({ feedback = [], reminders = [], nuevas = [], digests = [], sentBefore = 0 } = {}) {
  const log = new Set();
  const key = (a) => `${a.p_user}|${a.p_activity}|${a.p_kind}`;
  const db = fakeDb({
    emails_sent_since: sentBefore,
    feedback_notices: feedback,
    due_reminders: reminders,
    new_activity_notices: nuevas,
    teacher_digests: digests,
    claim_notification: (a) => { if (log.has(key(a))) return false; log.add(key(a)); return true; },
    release_notification: (a) => { log.delete(key(a)); return null; },
  });
  db.log = log;
  return db;
}

const transport = (fail = () => false) => {
  const sent = [];
  return { sent, sendMail: async (m) => { if (fail(m)) throw new Error('SMTP 421'); sent.push(m); return { messageId: String(sent.length) }; } };
};

test('reserva → envío en el orden retro → recordatorios → nuevas → resumen', async () => {
  const db = dbWith({
    feedback: [{ ...ana, ...act('a1'), submission_id: 's1', grade: 3.4, grade_scale: 5, summary: 'Falta el ejemplo.', kind: 'retro:1' }],
    reminders: [{ ...beto, ...act('a1'), kind: 'rec24:1763650800' }],
    nuevas: [{ ...beto, ...act('a2'), kind: 'nueva' }],
    digests: [{ user_id: 'u-profe', email: 'profe@gmail.com', full_name: 'Profe Uno', kind: 'resumen:2026-11-18', items: [{ subject: 'Programación I', subject_id: 'subj', activity: 'Quiz 1', activity_id: 'a1', student: 'Ana', status: 'revision' }] }],
  });
  const t = transport();
  const mailer = createMailer(baseConfig(), { transport: t });
  const stats = await runNotifications({ db, mailer, config: baseConfig(), log: silentLog, now });
  assert.equal(stats.sent, 4);
  assert.deepEqual([stats.retro, stats.recordatorio, stats.nueva, stats.resumen], [1, 1, 1, 1]);
  assert.deepEqual(t.sent.map((m) => m.to), ['ana@gmail.com', 'beto@gmail.com', 'beto@gmail.com', 'profe@gmail.com']);
  assert.match(t.sent[0].subject, /Retroalimentación lista/);
  assert.match(t.sent[1].subject, /^⏰ Quedan 24 h — Actividad a1 · Programación I$/);
  assert.equal(t.sent[0].from.address, 'profe@gmail.com');
  // resumen con día local de Bogotá (no UTC)
  assert.deepEqual(db.callsTo('teacher_digests')[0].args, { p_day: '2026-11-18' });
  assert.ok(db.log.has('u-profe|null|resumen:2026-11-18'));
});

test('duplicado: si la reserva ya existe no se envía', async () => {
  const db = dbWith({ reminders: [{ ...beto, ...act('a1'), kind: 'rec3:1' }] });
  db.log.add('u-beto|a1|rec3:1');
  const t = transport();
  const stats = await runNotifications({ db, mailer: createMailer(baseConfig(), { transport: t }), config: baseConfig(), log: silentLog, now });
  assert.equal(t.sent.length, 0);
  assert.equal(stats.duplicates, 1);
});

test('si el envío falla se libera la reserva y se sigue con los demás', async () => {
  const db = dbWith({ reminders: [{ ...ana, ...act('a1'), kind: 'rec24:1' }, { ...beto, ...act('a1'), kind: 'rec24:1' }] });
  const t = transport((m) => m.to === 'ana@gmail.com');
  const stats = await runNotifications({ db, mailer: createMailer(baseConfig(), { transport: t }), config: baseConfig(), log: silentLog, now });
  assert.equal(stats.failed, 1);
  assert.equal(stats.sent, 1);
  assert.ok(!db.log.has('u-ana|a1|rec24:1'), 'reserva liberada para reintentar');
  assert.ok(db.log.has('u-beto|a1|rec24:1'));
  assert.equal(db.callsTo('release_notification').length, 1);
});

test('presupuesto diario agotado: se detiene sin reservar', async () => {
  const reminders = Array.from({ length: 5 }, (_, i) => ({ ...ana, ...act(`a${i}`), kind: 'rec24:1' }));
  const db = dbWith({ reminders, sentBefore: 447 });
  const t = transport();
  const stats = await runNotifications({ db, mailer: createMailer(baseConfig(), { transport: t }), config: baseConfig({ emailDailyBudget: 450 }), log: silentLog, now });
  assert.equal(t.sent.length, 3);
  assert.equal(stats.budgetExhausted, true);
  assert.equal(db.log.size, 3, 'no quedan reservas sin envío');
  assert.equal(db.callsTo('new_activity_notices').length, 0);
});

test('actividades nuevas: un solo correo por estudiante con la lista', async () => {
  const db = dbWith({ nuevas: [{ ...ana, ...act('a1'), kind: 'nueva' }, { ...ana, ...act('a2'), kind: 'nueva' }, { ...beto, ...act('a1'), kind: 'nueva' }] });
  db.log.add('u-ana|a2|nueva'); // ya avisada antes: no debe repetirse en la lista
  const t = transport();
  const stats = await runNotifications({ db, mailer: createMailer(baseConfig(), { transport: t }), config: baseConfig(), log: silentLog, now });
  assert.equal(t.sent.length, 2);
  assert.equal(stats.nueva, 2);
  const anaMail = t.sent.find((m) => m.to === 'ana@gmail.com');
  assert.match(anaMail.html, /Actividad a1/);
  assert.doesNotMatch(anaMail.html, /Actividad a2/);
  const many = newActivitiesEmail({ full_name: 'Ana', items: [act('x'), act('y')] }, baseConfig());
  assert.match(many.subject, /2 actividades nuevas/);
});

test('sin credenciales ni DRY_RUN: omite con advertencia; DRY_RUN registra sin enviar', async () => {
  const db = dbWith({ reminders: [{ ...ana, ...act('a1'), kind: 'rec24:1' }] });
  const warns = [];
  const off = createMailer(baseConfig({ mailEnabled: false, gmailUser: '', gmailPass: '' }));
  const stats = await runNotifications({ db, mailer: off, config: baseConfig(), log: (l, m) => warns.push(m), now });
  assert.equal(stats.skipped, true);
  assert.match(warns[0], /GMAIL_USER/);
  assert.equal(db.calls.length, 0);

  const logs = [];
  const dry = createMailer(baseConfig({ dryRun: true, mailEnabled: false }), { log: (l, m) => logs.push(m) });
  const s2 = await runNotifications({ db, mailer: dry, config: baseConfig({ dryRun: true }), log: silentLog, now });
  assert.equal(s2.sent, 1);
  assert.match(logs[0], /\[DRY_RUN\] Correo a an\*\*\*@gmail\.com/);
  assert.ok(!logs.join().includes("ana@gmail.com"), "el log no expone el correo");
});

test('deadline agotado: no envía', async () => {
  const db = dbWith({ reminders: [{ ...ana, ...act('a1'), kind: 'rec24:1' }] });
  const t = transport();
  await runNotifications({ db, mailer: createMailer(baseConfig(), { transport: t }), config: baseConfig(), log: silentLog, now, deadline: Date.now() - 1 });
  assert.equal(t.sent.length, 0);
});

test('plantillas: escapan HTML, enlaces correctos, urgencia y fechas locales', () => {
  const cfg = baseConfig({ appUrl: 'https://app.example/' });
  const r = reminderEmail({ ...ana, ...act('a1', { activity_title: '<script>x</script>' }), kind: 'rec3:9' }, cfg);
  assert.match(r.subject, /^🚨 Últimas 3 horas/);
  assert.doesNotMatch(r.html, /<script>x/);
  assert.match(r.html, /&lt;script&gt;/);
  assert.match(r.html, /https:\/\/app\.example\/#\/actividad\/a1/);
  assert.match(r.text, /Hola, Ana:/);
  assert.match(r.text, /10:00/, 'fecha en hora de Bogotá (15:00 UTC → 10:00)');
  const f = feedbackEmail({ ...ana, ...act('a1'), grade: 3.45, grade_scale: 5, summary: 'Falta el ejemplo.' }, cfg);
  assert.match(f.html, /3,45 \/ 5/);
  const d = digestEmail({ full_name: 'Profe', items: [{ subject: 'P1', subject_id: 's9', activity: 'Q', student: 'Ana', status: 'error' }] }, cfg);
  assert.match(d.html, /#\/asignatura\/s9/);
  assert.match(d.html, /Error de evaluación/);
  assert.equal(esc(`"'&`), '&quot;&#39;&amp;');
  assert.equal(localDay(new Date('2026-11-19T04:59:00Z'), 'America/Bogota'), '2026-11-18');
});
