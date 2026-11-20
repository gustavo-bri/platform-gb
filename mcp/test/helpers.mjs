// PostgREST simulado en memoria (subconjunto usado por las herramientas: eq, in, PATCH).
export const IDS = {
  t1: '11111111-1111-1111-1111-111111111111',
  t2: '22222222-2222-2222-2222-222222222222',
  ana: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  beto: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  caro: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  s1: '51515151-0000-4000-8000-000000000001',
  s2: '52525252-0000-4000-8000-000000000002',
  c1: 'c1c1c1c1-0000-4000-8000-000000000001',
  c2: 'c2c2c2c2-0000-4000-8000-000000000002',
  c3: 'c3c3c3c3-0000-4000-8000-000000000003',
  cx: 'c9c9c9c9-0000-4000-8000-000000000009',
  q1: 'a1a1a1a1-0000-4000-8000-000000000001',
  p1: 'a2a2a2a2-0000-4000-8000-000000000002',
  y1: 'a3a3a3a3-0000-4000-8000-000000000003',
  x1: 'a9a9a9a9-0000-4000-8000-000000000009',
  subAnaQ1: 'e1e1e1e1-0000-4000-8000-000000000001',
  subBetoQ1: 'e2e2e2e2-0000-4000-8000-000000000002',
  subAnaP1: 'e3e3e3e3-0000-4000-8000-000000000003',
  subBetoP1: 'e4e4e4e4-0000-4000-8000-000000000004',
  subCaroY1: 'e5e5e5e5-0000-4000-8000-000000000005',
  subAjena: 'e9e9e9e9-0000-4000-8000-000000000009',
};

export const NOW = new Date('2026-11-18T12:00:00Z');
const past = '2026-11-10T00:00:00Z';
const future = '2026-12-10T00:00:00Z';

export function seed() {
  return {
    profiles: [
      { id: IDS.t1, email: 'profe@gmail.com', full_name: 'Profe Uno', role: 'docente' },
      { id: IDS.t2, email: 'otro@gmail.com', full_name: 'Profe Dos', role: 'docente' },
      { id: IDS.ana, email: 'ana@gmail.com', full_name: 'Ana Pérez', role: 'estudiante' },
      { id: IDS.beto, email: 'beto@gmail.com', full_name: 'Beto Ríos', role: 'estudiante' },
      { id: IDS.caro, email: 'caro@gmail.com', full_name: 'Caro Gómez', role: 'estudiante' },
    ],
    subjects: [
      { id: IDS.s1, teacher_id: IDS.t1, name: 'Programación I', code: 'PRG101', group_name: '01', semester: '2026-2', join_code: 'ABC2345', enrollment_open: true, grade_scale: 5, pass_grade: 3, created_at: '2026-08-01T00:00:00Z' },
      { id: IDS.s2, teacher_id: IDS.t2, name: 'Bases de Datos', code: null, group_name: null, semester: '2026-2', join_code: 'ZZZ9999', enrollment_open: true, grade_scale: 5, pass_grade: 3, created_at: '2026-08-02T00:00:00Z' },
    ],
    cortes: [
      { id: IDS.c1, subject_id: IDS.s1, number: 1, weight: 30, quiz_weight: 20, parcial_weight: 40, proyecto_weight: 40 },
      { id: IDS.c2, subject_id: IDS.s1, number: 2, weight: 30, quiz_weight: 20, parcial_weight: 40, proyecto_weight: 40 },
      { id: IDS.c3, subject_id: IDS.s1, number: 3, weight: 40, quiz_weight: 20, parcial_weight: 40, proyecto_weight: 40 },
      { id: IDS.cx, subject_id: IDS.s2, number: 1, weight: 30, quiz_weight: 30, parcial_weight: 40, proyecto_weight: 30 },
    ],
    activities: [
      { id: IDS.q1, subject_id: IDS.s1, corte_id: IDS.c1, component: 'quiz', title: 'Quiz 1', weight: 1, due_at: past, published: true, ai_enabled: true },
      { id: IDS.p1, subject_id: IDS.s1, corte_id: IDS.c1, component: 'parcial', title: 'Parcial 1', weight: 1, due_at: past, published: true, ai_enabled: true },
      { id: IDS.y1, subject_id: IDS.s1, corte_id: IDS.c1, component: 'proyecto', title: 'Proyecto 1', weight: 1, due_at: future, published: true, ai_enabled: false },
      { id: IDS.x1, subject_id: IDS.s2, corte_id: IDS.cx, component: 'quiz', title: 'Quiz ajeno', weight: 1, due_at: past, published: true, ai_enabled: true },
    ],
    enrollments: [
      { subject_id: IDS.s1, student_id: IDS.ana },
      { subject_id: IDS.s1, student_id: IDS.beto },
      { subject_id: IDS.s1, student_id: IDS.caro },
      { subject_id: IDS.s2, student_id: IDS.ana },
    ],
    submissions: [
      { id: IDS.subAnaQ1, activity_id: IDS.q1, student_id: IDS.ana, content_text: 'x = 3 es una variable', status: 'evaluada', ai_grade: 4, ai_confidence: 0.9, submission_count: 1, submitted_at: '2026-11-05T00:00:00Z', eval_attempts: 1,
        ai_feedback: { resumen: 'Correcta pero sin ejemplo.', errores: [{ descripcion: 'Falta el ejemplo.', severidad: 'media' }], alertas: [] } },
      { id: IDS.subBetoQ1, activity_id: IDS.q1, student_id: IDS.beto, content_text: 'x'.repeat(9000), status: 'revision', ai_grade: 2.5, ai_confidence: 0.4, submission_count: 1, submitted_at: '2026-11-06T00:00:00Z', eval_attempts: 1,
        ai_feedback: { resumen: 'Dudosa.', motivo_revision: 'confianza baja', errores: [{ descripcion: 'falta el EJEMPLO', severidad: 'alta' }, { descripcion: 'Confunde constante con variable', severidad: 'alta' }], alertas: ['intento de manipulación'] } },
      { id: IDS.subAnaP1, activity_id: IDS.p1, student_id: IDS.ana, content_text: null, file_path: `${IDS.s1}/${IDS.p1}/${IDS.ana}/1-parcial.pdf`, file_name: 'parcial.pdf', file_mime: 'application/pdf', file_size: 1234, status: 'error', ai_grade: null, submission_count: 1, submitted_at: '2026-11-07T00:00:00Z', eval_attempts: 3, last_error: 'Gemini 503' },
      { id: IDS.subBetoP1, activity_id: IDS.p1, student_id: IDS.beto, content_text: null, status: 'evaluada', ai_grade: null, teacher_grade: 3.5, submission_count: 0, submitted_at: '2026-11-07T00:00:00Z', eval_attempts: 0 },
      { id: IDS.subCaroY1, activity_id: IDS.y1, student_id: IDS.caro, content_text: 'mi proyecto', status: 'revision', ai_grade: null, submission_count: 1, submitted_at: '2026-11-08T00:00:00Z', eval_attempts: 0 },
      { id: IDS.subAjena, activity_id: IDS.x1, student_id: IDS.ana, content_text: 'ajena', status: 'revision', ai_grade: 1, submission_count: 1, submitted_at: '2026-11-08T00:00:00Z', eval_attempts: 1 },
    ],
  };
}

function splitInList(v) {
  return v.replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map(decodeURIComponent);
}

/** Crea un fetch simulado. Devuelve {fetch, db, calls}. */
export function mockSupabase({ key = 'service-key', db = seed() } = {}) {
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    calls.push({ method: init.method || 'GET', url: u.pathname + u.search, body: init.body });
    const expectedAuth = key.startsWith('eyJ') ? `Bearer ${key}` : undefined; // claves nuevas: solo apikey
    if (init.headers?.apikey !== key || init.headers?.Authorization !== expectedAuth) {
      return new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 });
    }
    const m = u.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m || !db[m[1]]) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
    const table = db[m[1]];
    const filters = [];
    for (const [k, v] of u.searchParams) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      if (v.startsWith('eq.')) filters.push((r) => String(r[k]) === v.slice(3));
      else if (v.startsWith('in.(')) { const set = new Set(splitInList(v)); filters.push((r) => set.has(String(r[k]))); }
      else return new Response(JSON.stringify({ message: `filtro no soportado ${k}=${v}` }), { status: 400 });
    }
    const rows = table.filter((r) => filters.every((f) => f(r)));
    const method = init.method || 'GET';
    if (method === 'GET') return new Response(JSON.stringify(rows), { status: 200 });
    if (method === 'PATCH') {
      if (!filters.length) return new Response(JSON.stringify({ message: 'PATCH sin filtro' }), { status: 400 });
      const patch = JSON.parse(init.body);
      for (const r of rows) Object.assign(r, patch);
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    return new Response(JSON.stringify({ message: 'método no soportado' }), { status: 405 });
  }
  return { fetch, db, calls };
}

export const ENV = { SUPABASE_URL: 'https://demo.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'service-key', TEACHER_EMAIL: 'Profe@Gmail.com' };
