import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeGradebook } from '../js/grading.js';
import { corteWorkbook, corteCsv, fullHistoryWorkbook } from '../js/reports.js';
import { crc32, buildCsv } from '../js/xlsx.js';

const now = new Date();
const past = new Date(Date.now() - 86400e3).toISOString();
const bundle = {
  subject: { name: 'Programación I: <Básica> & "Avanzada"', code: 'PRG101', semester: '2026-2', grade_scale: 5, pass_grade: 3, group_name: 'A' },
  cortes: [1, 2, 3].map((n) => ({ id: `c${n}`, number: n, weight: n === 3 ? 40 : 30, quiz_weight: 20, parcial_weight: 40, proyecto_weight: 40 })),
  activities: [
    { id: 'q1', corte_id: 'c1', component: 'quiz', title: 'Quiz 1 = variables', weight: 1, due_at: past, opens_at: past },
    { id: 'q2', corte_id: 'c1', component: 'quiz', title: 'Quiz 2', weight: 2, due_at: past, opens_at: past },
    { id: 'p1', corte_id: 'c1', component: 'parcial', title: 'Parcial 1', due_at: past, opens_at: past },
  ],
  students: [
    { id: 's1', full_name: 'Zoe Álvarez', email: 'zoe@gmail.com' },
    { id: 's2', full_name: 'Ana Ñúñez', email: 'ana@gmail.com' },
  ],
  submissions: [
    { activity_id: 'q1', student_id: 's1', status: 'evaluada', ai_grade: 4.5, ai_feedback: { resumen: 'Correcto; falta ejemplo.' }, submitted_at: past, submission_count: 1 },
    { activity_id: 'p1', student_id: 's1', status: 'revision', ai_grade: 2.0, ai_confidence: 0.4, submitted_at: past, submission_count: 1 },
    { activity_id: 'q2', student_id: 's2', status: 'evaluada', ai_grade: 3, teacher_grade: 3.8, teacher_comment: 'Revisado', submitted_at: past, submission_count: 2 },
  ],
};
const gb = computeGradebook({ ...bundle, now });

test('crc32 conocido', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('Excel por corte e historial completo se abren con openpyxl y tienen los valores correctos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xlsx-'));
  const c1 = corteWorkbook(bundle, gb, 1);
  const full = fullHistoryWorkbook(bundle, gb);
  const f1 = join(dir, c1.filename); const f2 = join(dir, full.filename);
  writeFileSync(f1, c1.bytes); writeFileSync(f2, full.bytes);
  const py = `
import openpyxl, json, sys
out = {}
for f in sys.argv[1:]:
    wb = openpyxl.load_workbook(f)
    out[f] = {ws.title: [[c for c in r] for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets}
print(json.dumps(out, default=str, ensure_ascii=False))`;
  const res = JSON.parse(execFileSync('python3', ['-c', py, f1, f2], { encoding: 'utf8' }));
  const corte = res[f1]['Corte 1'];
  assert.ok(corte[0][0].startsWith('Notas — Corte 1'));
  const headerRow = corte[4];
  assert.equal(headerRow[1], 'Estudiante');
  const ana = corte.find((r) => r[1] === 'Ana Ñúñez');
  const zoe = corte.find((r) => r[1] === 'Zoe Álvarez');
  assert.equal(ana[0], 1, 'orden alfabético');
  // Zoe: q1 4.5 (w1), q2 sin entrega 0 (w2) → quiz 1.5; parcial provisional 2.0 → corte = .2*1.5 + .4*2 = 1.1
  assert.equal(zoe[headerRow.indexOf('Quiz (20 %)')], 1.5);
  assert.equal(zoe[headerRow.indexOf('Nota del corte')], 1.1);
  assert.match(zoe[headerRow.length - 1], /provisionales/);
  const sheets = Object.keys(res[f2]);
  assert.deepEqual(sheets, ['Resumen', 'Corte 1', 'Corte 2', 'Corte 3', 'Detalle', 'Configuración']);
  const detalle = res[f2].Detalle;
  assert.ok(detalle.some((r) => r[0] === 'Ana Ñúñez' && r[11] === 3.8 && r[14] === 'Revisado'));
  assert.ok(res[f2].Resumen[0][0].includes('Resumen'));
});

test('CSV con BOM, punto y coma, coma decimal y fórmulas neutralizadas', () => {
  const { text } = corteCsv(bundle, gb, 1);
  assert.ok(text.startsWith('﻿'));
  assert.match(text, /Zoe Álvarez;zoe@gmail.com;4,5;/);
  assert.match(text, /"'Quiz 1 = variables|'=|Quiz 1 = variables/);
  const csv = buildCsv([['=HYPERLINK("x")', 'a;b', 1.25]]);
  assert.equal(csv, '﻿"\'=HYPERLINK(""x"")";"a;b";1,25\r\n');
});
