import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGradebook, activityResult, effectiveWeights, validateWeights, submissionResult } from '../js/grading.js';

const now = new Date('2026-11-18T12:00:00Z');
const past = '2026-11-01T00:00:00Z';
const future = '2026-12-01T00:00:00Z';
const subject = { grade_scale: 5, pass_grade: 3 };
const cortes = [
  { id: 'c1', number: 1, weight: 30, quiz_weight: 20, parcial_weight: 40, proyecto_weight: 40 },
  { id: 'c2', number: 2, weight: 30, quiz_weight: 20, parcial_weight: 40, proyecto_weight: 40 },
  { id: 'c3', number: 3, weight: 40, quiz_weight: 20, parcial_weight: 40, proyecto_weight: 40 },
];
const student = { id: 's1', full_name: 'Ana' };

test('submissionResult distingue estados docente/estudiante', () => {
  assert.equal(submissionResult({ status: 'evaluada', ai_grade: 3, teacher_grade: 4 }).grade, 4);
  assert.equal(submissionResult({ status: 'revision', ai_grade: 3 }).state, 'provisional');
  assert.equal(submissionResult({ status: 'revision' }).state, 'en_revision');
  assert.equal(submissionResult({ status: 'pendiente' }).state, 'en_proceso');
  assert.equal(submissionResult({ status: 'en_revision' }, 'estudiante').grade, null);
  assert.equal(submissionResult({ status: 'evaluada', grade: 4.2 }, 'estudiante').grade, 4.2);
});

test('vencida sin entrega = 0; sin vencer = pendiente', () => {
  assert.deepEqual([activityResult({ due_at: past }, null, now).grade, activityResult({ due_at: past }, null, now).counts], [0, true]);
  const p = activityResult({ due_at: future }, null, now);
  assert.equal(p.counts, false); assert.equal(p.state, 'pendiente');
  const e = activityResult({ due_at: past }, { status: 'pendiente' }, now);
  assert.equal(e.counts, false, 'entregada a tiempo pero aún en evaluación no cuenta como 0');
});

test('semestre completo con quizzes ponderados', () => {
  const activities = [];
  const submissions = [];
  for (const c of cortes) {
    activities.push({ id: `${c.id}q1`, corte_id: c.id, component: 'quiz', weight: 1, due_at: past });
    activities.push({ id: `${c.id}q2`, corte_id: c.id, component: 'quiz', weight: 3, due_at: past });
    activities.push({ id: `${c.id}p`, corte_id: c.id, component: 'parcial', due_at: past });
    activities.push({ id: `${c.id}y`, corte_id: c.id, component: 'proyecto', due_at: past });
    submissions.push({ activity_id: `${c.id}q1`, student_id: 's1', status: 'evaluada', ai_grade: 5 });
    submissions.push({ activity_id: `${c.id}q2`, student_id: 's1', status: 'evaluada', ai_grade: 1 });
    submissions.push({ activity_id: `${c.id}p`, student_id: 's1', status: 'evaluada', ai_grade: 3, teacher_grade: 4 });
    submissions.push({ activity_id: `${c.id}y`, student_id: 's1', status: 'evaluada', ai_grade: 3.5 });
  }
  const gb = computeGradebook({ subject, cortes, activities, students: [student], submissions, now });
  const row = gb.rows[0];
  // quiz = (5*1 + 1*3)/4 = 2 ; corte = 0.2*2 + 0.4*4 + 0.4*3.5 = 3.4
  assert.equal(row.cortes[0].quiz.grade, 2);
  assert.equal(row.cortes[0].grade, 3.4);
  assert.equal(row.final, 3.4);
  assert.equal(row.evaluatedPct, 100);
  assert.equal(row.passed, true);
  assert.equal(row.provisional, false);
});

test('nota acumulada y % evaluado a mitad de semestre', () => {
  const activities = [
    { id: 'p1', corte_id: 'c1', component: 'parcial', due_at: past },
    { id: 'y1', corte_id: 'c1', component: 'proyecto', due_at: future },
    { id: 'q1', corte_id: 'c1', component: 'quiz', due_at: past },
    { id: 'p2', corte_id: 'c2', component: 'parcial', due_at: future },
    { id: 'borrador', corte_id: 'c2', component: 'quiz', due_at: past, published: false },
  ];
  const submissions = [{ activity_id: 'p1', student_id: 's1', status: 'evaluada', ai_grade: 4 }];
  const row = computeGradebook({ subject, cortes, activities, students: [student], submissions, now }).rows[0];
  // corte1: quiz vencido sin entrega 0 (20%), parcial 4 (40%), proyecto pendiente → nota 1.6, evaluado 60%
  assert.equal(row.cortes[0].grade, 1.6);
  assert.equal(row.cortes[0].evaluatedPct, 60);
  assert.equal(row.cortes[0].average, 2.67);
  // final = 0.3*1.6 = 0.48 ; evaluado = 0.3*0.6 = 18%
  assert.equal(row.final, 0.48);
  assert.equal(row.evaluatedPct, 18);
  assert.equal(row.passed, null, 'no se declara aprobado/reprobado con semestre incompleto');
  assert.ok(!('borrador' in row.items), 'actividades no publicadas no cuentan');
});

test('nota provisional en revisión se marca', () => {
  const activities = [{ id: 'p1', corte_id: 'c1', component: 'parcial', due_at: past }];
  const submissions = [{ activity_id: 'p1', student_id: 's1', status: 'revision', ai_grade: 2.5 }];
  const row = computeGradebook({ subject, cortes, activities, students: [student], submissions, now }).rows[0];
  assert.equal(row.provisional, true);
  assert.equal(row.cortes[0].parcial.grade, 2.5);
});

test('pesos efectivos y validación', () => {
  const activities = [
    { id: 'q1', corte_id: 'c1', component: 'quiz', weight: 1 },
    { id: 'q2', corte_id: 'c1', component: 'quiz', weight: 1 },
    { id: 'p1', corte_id: 'c1', component: 'parcial' },
  ];
  const w = effectiveWeights(cortes, activities);
  assert.deepEqual(w.q1, { inCorte: 10, inSemester: 3 });
  assert.deepEqual(w.p1, { inCorte: 40, inSemester: 12 });
  assert.equal(validateWeights(cortes).length, 0);
  assert.equal(validateWeights([{ ...cortes[0], weight: 50 }, cortes[1], cortes[2]]).length, 1);
});
