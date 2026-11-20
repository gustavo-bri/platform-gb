// Cálculo de notas — módulo puro (sin DOM), compartido por la web, el MCP y las pruebas.
// Reglas en docs/ARQUITECTURA.md §7.

export const COMPONENTS = ['quiz', 'parcial', 'proyecto'];
export const COMPONENT_LABEL = { quiz: 'Quiz', parcial: 'Parcial', proyecto: 'Proyecto' };

export const round = (n, d = 2) => (n == null || Number.isNaN(n) ? null : Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d);

/**
 * Normaliza una entrega a {state, grade, provisional}.
 * mode 'docente': fila de `submissions` (status interno, ai_grade, teacher_grade).
 * mode 'estudiante': fila de `student_submissions` (status evaluada|en_revision|en_proceso, grade).
 */
export function submissionResult(sub, mode = 'docente') {
  if (!sub) return { state: 'sin_entrega', grade: null, provisional: false };
  if (mode === 'estudiante') {
    if (sub.status === 'evaluada' && sub.grade != null) return { state: 'calificada', grade: Number(sub.grade), provisional: false };
    if (sub.status === 'en_revision') return { state: 'en_revision', grade: null, provisional: false };
    return { state: 'en_proceso', grade: null, provisional: false };
  }
  const g = sub.teacher_grade ?? sub.ai_grade;
  if (sub.status === 'evaluada' && g != null) return { state: 'calificada', grade: Number(g), provisional: false };
  if (sub.status === 'revision') {
    return g != null ? { state: 'provisional', grade: Number(g), provisional: true } : { state: 'en_revision', grade: null, provisional: false };
  }
  if (sub.status === 'error') return { state: 'error', grade: null, provisional: false };
  return { state: 'en_proceso', grade: null, provisional: false };
}

/** Resultado de una actividad para un estudiante. counts=true si entra en el cálculo. */
export function activityResult(activity, sub, now = new Date(), mode = 'docente') {
  const r = submissionResult(sub, mode);
  const overdue = new Date(activity.due_at) <= now;
  if (r.grade != null) return { ...r, grade: round(r.grade, 1), counts: true, overdue };
  if (!sub && overdue) return { state: 'sin_entrega', grade: 0, provisional: false, counts: true, overdue };
  if (!sub) return { state: 'pendiente', grade: null, provisional: false, counts: false, overdue };
  return { ...r, counts: false, overdue };
}

/**
 * Libro de calificaciones.
 * @param {object} p
 * @param {{grade_scale:number, pass_grade:number}} p.subject
 * @param {Array} p.cortes  [{id, number, weight, quiz_weight, parcial_weight, proyecto_weight}]
 * @param {Array} p.activities [{id, corte_id, component, weight, due_at, published}]
 * @param {Array} p.students [{id, full_name, email}]
 * @param {Array} p.submissions filas con activity_id y student_id
 */
export function computeGradebook({ subject, cortes, activities, students, submissions, now = new Date(), mode = 'docente' }) {
  const scale = Number(subject.grade_scale ?? 5);
  const passGrade = Number(subject.pass_grade ?? scale * 0.6);
  const acts = activities.filter((a) => a.published !== false);
  const subIndex = new Map(submissions.map((s) => [`${s.activity_id}|${s.student_id}`, s]));
  const sortedCortes = [...cortes].sort((a, b) => a.number - b.number);

  const rows = students.map((student) => {
    let final = 0;
    let finalEval = 0;
    let provisional = false;
    const items = {};
    const corteRows = sortedCortes.map((corte) => {
      const cActs = acts.filter((a) => a.corte_id === corte.id);
      let corteGrade = 0;
      let corteEval = 0;
      const comps = {};
      for (const comp of COMPONENTS) {
        const compPct = Number(corte[`${comp}_weight`]);
        const list = cActs.filter((a) => a.component === comp);
        if (!list.length) { comps[comp] = { grade: null, evaluated: 0, count: 0 }; continue; }
        let totalW = 0; let earned = 0; let evalW = 0;
        for (const a of list) {
          const w = comp === 'quiz' ? Number(a.weight ?? 1) : 1;
          const res = activityResult(a, subIndex.get(`${a.id}|${student.id}`), now, mode);
          items[a.id] = res;
          totalW += w;
          if (res.counts) { earned += w * res.grade; evalW += w; if (res.provisional) provisional = true; }
        }
        const compGrade = earned / totalW;          // pendientes cuentan 0 (nota asegurada)
        const evaluated = evalW / totalW;           // fracción ya evaluada
        comps[comp] = { grade: round(compGrade, 2), evaluated, count: list.length };
        corteGrade += (compPct / 100) * compGrade;
        corteEval += (compPct / 100) * evaluated;
      }
      final += (Number(corte.weight) / 100) * corteGrade;
      finalEval += (Number(corte.weight) / 100) * corteEval;
      return {
        id: corte.id, number: corte.number, weight: Number(corte.weight),
        ...comps, grade: round(corteGrade, 2), evaluatedPct: round(corteEval * 100, 1),
        average: corteEval > 0 ? round(corteGrade / corteEval, 2) : null,
      };
    });
    const evaluatedPct = round(finalEval * 100, 1);
    const finalR = round(final, 2);
    return {
      student, cortes: corteRows, items, final: finalR, evaluatedPct,
      average: finalEval > 0 ? round(final / finalEval, 2) : null,       // promedio sobre lo evaluado
      provisional,
      passed: evaluatedPct >= 100 ? finalR >= passGrade : null,
      scale,
    };
  });
  return { rows, scale, passGrade, cortes: sortedCortes, activities: acts };
}

/** Pesos efectivos de cada actividad dentro del semestre (para mostrar "vale X%"). */
export function effectiveWeights(cortes, activities) {
  const out = {};
  for (const corte of cortes) {
    for (const comp of COMPONENTS) {
      const list = activities.filter((a) => a.corte_id === corte.id && a.component === comp && a.published !== false);
      const totalW = list.reduce((s, a) => s + (comp === 'quiz' ? Number(a.weight ?? 1) : 1), 0);
      for (const a of list) {
        const w = comp === 'quiz' ? Number(a.weight ?? 1) : 1;
        const inCorte = (Number(corte[`${comp}_weight`]) * w) / totalW;
        out[a.id] = { inCorte: round(inCorte, 2), inSemester: round((inCorte * Number(corte.weight)) / 100, 2) };
      }
    }
  }
  return out;
}

export function validateWeights(cortes) {
  const errors = [];
  const total = cortes.reduce((s, c) => s + Number(c.weight || 0), 0);
  if (Math.abs(total - 100) > 1e-9) errors.push(`Los 3 cortes deben sumar 100% (suman ${round(total, 2)}%).`);
  for (const c of cortes) {
    const s = Number(c.quiz_weight || 0) + Number(c.parcial_weight || 0) + Number(c.proyecto_weight || 0);
    if (Math.abs(s - 100) > 1e-9) errors.push(`Corte ${c.number}: quiz + parcial + proyecto debe sumar 100% (suma ${round(s, 2)}%).`);
  }
  return errors;
}
