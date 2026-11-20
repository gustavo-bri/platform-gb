// Reportes de notas: Excel por corte, CSV por corte e historial completo del semestre.
import { COMPONENTS, COMPONENT_LABEL, effectiveWeights, round } from './grading.js';
import { buildXlsx, buildCsv } from './xlsx.js';

const fmtDT = (d) => (d ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(d)) : '');
const pct = (n) => `${round(Number(n), 2)} %`;
const STATE_TEXT = {
  pendiente: 'Pendiente', en_proceso: 'En evaluación', en_revision: 'En revisión', error: 'Error IA',
  sin_entrega: 'Sin entrega', calificada: 'Calificada', provisional: 'Provisional',
};

function gradeCell(res, pass, decimals = 1) {
  if (!res) return '';
  if (res.counts && res.grade != null) return { v: round(res.grade, decimals), s: res.grade < pass ? 'low' : decimals === 1 ? 'n1' : 'n2' };
  return { v: STATE_TEXT[res.state] || res.state, s: 'muted' };
}

function header(bundle, title, extra) {
  const { subject } = bundle;
  return [
    [{ v: title, s: 'title' }],
    [{ v: `${subject.name}${subject.code ? ` (${subject.code})` : ''}${subject.group_name ? ` · Grupo ${subject.group_name}` : ''} · Semestre ${subject.semester} · Escala 0–${subject.grade_scale} · Aprueba con ${subject.pass_grade}`, s: 'muted' }],
    [{ v: `${extra ? `${extra} · ` : ''}Generado: ${fmtDT(new Date())}`, s: 'muted' }],
    [],
  ];
}

const studentsSorted = (gb) => [...gb.rows].sort((a, b) => (a.student.full_name || '').localeCompare(b.student.full_name || '', 'es'));

/** Filas de una hoja de corte. */
export function corteRows(bundle, gb, number) {
  const corte = gb.cortes.find((c) => c.number === number);
  const acts = gb.activities.filter((a) => a.corte_id === corte.id).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  const quizzes = acts.filter((a) => a.component === 'quiz');
  const eff = effectiveWeights([corte], gb.activities);
  const pass = Number(bundle.subject.pass_grade);
  const head = ['N°', 'Estudiante', 'Correo'];
  quizzes.forEach((q) => head.push(`${q.title} (${pct(eff[q.id]?.inCorte ?? 0)})`));
  head.push(`Quiz (${pct(corte.quiz_weight)})`);
  for (const comp of ['parcial', 'proyecto']) {
    const a = acts.find((x) => x.component === comp);
    head.push(`${COMPONENT_LABEL[comp]}${a ? `: ${a.title}` : ''} (${pct(corte[`${comp}_weight`])})`);
  }
  head.push('Nota del corte', '% evaluado', 'Observación');
  const rows = [...header(bundle, `Notas — Corte ${number} (${pct(corte.weight)} del semestre)`,
    `Pesos del corte: Quiz ${pct(corte.quiz_weight)} · Parcial ${pct(corte.parcial_weight)} · Proyecto ${pct(corte.proyecto_weight)}`),
  head.map((h) => ({ v: h, s: 'header' }))];
  studentsSorted(gb).forEach((r, i) => {
    const c = r.cortes.find((x) => x.number === number);
    const row = [i + 1, r.student.full_name || '', r.student.email || ''];
    quizzes.forEach((q) => row.push(gradeCell(r.items[q.id], pass)));
    row.push(c.quiz.grade == null ? { v: 'Sin quizzes', s: 'muted' } : { v: c.quiz.grade, s: c.quiz.grade < pass ? 'low' : 'n2' });
    for (const comp of ['parcial', 'proyecto']) {
      const a = acts.find((x) => x.component === comp);
      row.push(a ? gradeCell(r.items[a.id], pass) : { v: 'No creada', s: 'muted' });
    }
    const provisional = Object.entries(r.items).some(([id, it]) => it.provisional && acts.some((a) => a.id === id));
    row.push({ v: c.grade, s: c.grade < pass ? 'low' : 'bold2' }, { v: c.evaluatedPct, s: 'pct' },
      provisional ? 'Incluye notas provisionales (pendientes de revisión docente)' : c.evaluatedPct < 100 ? 'Corte en curso: pendientes cuentan 0' : '');
    rows.push(row);
  });
  const widths = [5, 30, 30, ...quizzes.map(() => 14), 12, 18, 18, 12, 11, 34];
  return { rows, widths, freeze: 5 };
}

export function summaryRows(bundle, gb) {
  const pass = Number(bundle.subject.pass_grade);
  const head = ['N°', 'Estudiante', 'Correo', ...gb.cortes.map((c) => `Corte ${c.number} (${pct(c.weight)})`), 'Definitiva', '% evaluado', 'Estado', 'Observación'];
  const rows = [...header(bundle, 'Resumen de notas del semestre'), head.map((h) => ({ v: h, s: 'header' }))];
  studentsSorted(gb).forEach((r, i) => {
    rows.push([
      i + 1, r.student.full_name || '', r.student.email || '',
      ...r.cortes.map((c) => ({ v: c.grade, s: c.grade < pass ? 'low' : 'n2' })),
      { v: r.final, s: r.final < pass ? 'low' : 'bold2' },
      { v: r.evaluatedPct, s: 'pct' },
      r.passed === null ? 'En curso' : r.passed ? 'Aprobado' : 'Reprobado',
      r.provisional ? 'Incluye notas provisionales' : '',
    ]);
  });
  return { rows, widths: [5, 30, 30, ...gb.cortes.map(() => 15), 12, 11, 12, 28], freeze: 5 };
}

export function detailRows(bundle, gb) {
  const head = ['Estudiante', 'Correo', 'Corte', 'Componente', 'Actividad', 'Fecha límite', 'Fecha de entrega', 'Tardía', 'Envíos',
    'Estado', 'Nota IA', 'Nota docente', 'Nota final', 'Confianza IA', 'Comentario docente', 'Resumen de retroalimentación', 'Modelo IA'];
  const rows = [...header(bundle, 'Detalle de actividades y entregas'), head.map((h) => ({ v: h, s: 'header' }))];
  const subIdx = new Map(bundle.submissions.map((s) => [`${s.activity_id}|${s.student_id}`, s]));
  const corteNum = Object.fromEntries(gb.cortes.map((c) => [c.id, c.number]));
  const acts = [...gb.activities].sort((a, b) => corteNum[a.corte_id] - corteNum[b.corte_id] || new Date(a.due_at) - new Date(b.due_at));
  for (const r of studentsSorted(gb)) {
    for (const a of acts) {
      const s = subIdx.get(`${a.id}|${r.student.id}`);
      const res = r.items[a.id];
      rows.push([
        r.student.full_name || '', r.student.email || '', corteNum[a.corte_id], COMPONENT_LABEL[a.component], a.title,
        fmtDT(a.due_at), fmtDT(s?.submitted_at), s?.is_late ? 'Sí' : '', s?.submission_count ?? '',
        STATE_TEXT[res?.state] || '', s?.ai_grade != null ? { v: Number(s.ai_grade), s: 'n1' } : '',
        s?.teacher_grade != null ? { v: Number(s.teacher_grade), s: 'n1' } : '',
        res?.counts && res.grade != null ? { v: res.grade, s: 'n1' } : '',
        s?.ai_confidence != null ? { v: Math.round(Number(s.ai_confidence) * 100), s: 'pct' } : '',
        { v: s?.teacher_comment || '', s: 'wrap' }, { v: s?.ai_feedback?.resumen || '', s: 'wrap' }, s?.ai_model || '',
      ]);
    }
  }
  return { rows, widths: [28, 28, 7, 11, 28, 16, 16, 7, 7, 14, 9, 11, 10, 11, 40, 60, 18], freeze: 5 };
}

export function configRows(bundle, gb) {
  const eff = effectiveWeights(gb.cortes, gb.activities);
  const rows = [...header(bundle, 'Configuración de evaluación'),
    ['Corte', '% del semestre', 'Quiz', 'Parcial', 'Proyecto'].map((v) => ({ v, s: 'header' })),
    ...gb.cortes.map((c) => [c.number, { v: Number(c.weight), s: 'pct' }, { v: Number(c.quiz_weight), s: 'pct' }, { v: Number(c.parcial_weight), s: 'pct' }, { v: Number(c.proyecto_weight), s: 'pct' }]),
    [],
    ['Corte', 'Componente', 'Actividad', 'Apertura', 'Fecha límite', '% en el corte', '% en el semestre'].map((v) => ({ v, s: 'header' })),
  ];
  for (const c of gb.cortes) {
    for (const comp of COMPONENTS) {
      for (const a of gb.activities.filter((x) => x.corte_id === c.id && x.component === comp)) {
        rows.push([c.number, COMPONENT_LABEL[comp], a.title, fmtDT(a.opens_at), fmtDT(a.due_at), { v: eff[a.id]?.inCorte ?? 0, s: 'pct' }, { v: eff[a.id]?.inSemester ?? 0, s: 'pct' }]);
      }
    }
  }
  rows.push([], [{ v: 'Reglas: actividad vencida sin entrega = 0; pendientes cuentan 0 en la nota acumulada; quizzes promediados por peso relativo; nota de actividad redondeada a 1 decimal, cortes y definitiva a 2.', s: 'muted' }]);
  return { rows, widths: [8, 14, 34, 18, 18, 14, 16] };
}

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);

export function corteWorkbook(bundle, gb, number) {
  const { rows, widths, freeze } = corteRows(bundle, gb, number);
  return {
    bytes: buildXlsx([{ name: `Corte ${number}`, rows, colWidths: widths, freeze }]),
    filename: `${slug(bundle.subject.name)}_${slug(bundle.subject.semester)}_corte${number}.xlsx`,
  };
}

export function corteCsv(bundle, gb, number) {
  const { rows } = corteRows(bundle, gb, number);
  return { text: buildCsv(rows.slice(4)), filename: `${slug(bundle.subject.name)}_${slug(bundle.subject.semester)}_corte${number}.csv` };
}

export function fullHistoryWorkbook(bundle, gb) {
  const sheets = [
    { name: 'Resumen', ...pick(summaryRows(bundle, gb)) },
    ...gb.cortes.map((c) => ({ name: `Corte ${c.number}`, ...pick(corteRows(bundle, gb, c.number)) })),
    { name: 'Detalle', ...pick(detailRows(bundle, gb)) },
    { name: 'Configuración', ...pick(configRows(bundle, gb)) },
  ];
  return { bytes: buildXlsx(sheets), filename: `HISTORIAL_${slug(bundle.subject.name)}_${slug(bundle.subject.semester)}.xlsx` };
}

const pick = ({ rows, widths, freeze }) => ({ rows, colWidths: widths, freeze });
