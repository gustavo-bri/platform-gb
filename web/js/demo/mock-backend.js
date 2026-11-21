// Backend simulado: imita el cliente de sb.js con datos en localStorage y reglas equivalentes
// a las RLS/RPC de schema.sql. Lo usan el MODO DEMOSTRACIÓN (demo.html, window.__MOCK_SEED__ = 'demo')
// y las pruebas E2E (semilla mínima). Nunca se conecta a Supabase.
(() => {
  const SEED = window.__MOCK_SEED__ === 'demo' ? 'demo' : 'test';
  const KEY = SEED === 'demo' ? 'aula.demo.db.v1' : 'mockdb';
  const uuid = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const seed = () => (SEED === 'demo' ? window.__DEMO_DATA__() : {
    profiles: [
      { id: 'u-teacher', email: 'profe@gmail.com', full_name: 'Laura Gómez', role: 'docente', email_notifications: true },
      { id: 'u-ana', email: 'ana@gmail.com', full_name: 'Ana Pérez', role: 'estudiante', email_notifications: true },
      { id: 'u-beto', email: 'beto@gmail.com', full_name: 'Beto Ríos', role: 'estudiante', email_notifications: true },
    ],
    subjects: [], cortes: [], enrollments: [], activities: [], activity_keys: [], submissions: [], files: {},
  });
  // Si los datos no existen (primera visita o «Reiniciar datos»), se recrean al vuelo.
  const load = () => {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v) return v;
    const fresh = seed();
    localStorage.setItem(KEY, JSON.stringify(fresh));
    return fresh;
  };
  const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
  const fail = (m) => { const e = new Error(m); e.status = 400; throw e; };
  const me = () => sessionStorage.getItem('mockuser');
  load();
  const owns = (db, sid) => db.subjects.some((s) => s.id === sid && s.teacher_id === me());
  const enrolled = (db, sid) => db.enrollments.some((e) => e.subject_id === sid && e.student_id === me());
  const visible = {
    profiles: () => true,
    subjects: (db, r) => r.teacher_id === me() || enrolled(db, r.id),
    cortes: (db, r) => owns(db, r.subject_id) || enrolled(db, r.subject_id),
    enrollments: (db, r) => r.student_id === me() || owns(db, r.subject_id),
    activities: (db, r) => owns(db, r.subject_id) || (enrolled(db, r.subject_id) && r.published && new Date(r.opens_at) <= new Date()),
    activity_keys: (db, r) => owns(db, db.activities.find((a) => a.id === r.activity_id)?.subject_id),
    submissions: (db, r) => owns(db, db.activities.find((a) => a.id === r.activity_id)?.subject_id),
  };
  function studentView(db) {
    return db.submissions.filter((s) => s.student_id === me()).map((s) => ({
      id: s.id, activity_id: s.activity_id, student_id: s.student_id, content_text: s.content_text, file_path: s.file_path,
      file_name: s.file_name, file_size: s.file_size, submission_count: s.submission_count, submitted_at: s.submitted_at, is_late: s.is_late,
      status: s.status === 'evaluada' ? 'evaluada' : s.status === 'revision' ? 'en_revision' : 'en_proceso',
      grade: s.status === 'evaluada' ? (s.teacher_grade ?? s.ai_grade) : null,
      feedback: s.status === 'evaluada' ? s.ai_feedback : null,
      teacher_comment: s.status === 'evaluada' ? s.teacher_comment : null,
      graded_at: s.status === 'evaluada' ? (s.reviewed_at || s.evaluated_at) : null,
    }));
  }
  function applyFilters(rows, params) {
    let out = rows;
    for (const [k, v] of Object.entries(params)) {
      if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
      const val = String(v);
      if (val.startsWith('eq.')) out = out.filter((r) => String(r[k]) === val.slice(3));
      else if (val.startsWith('in.(')) { const set = val.slice(4, -1).split(','); out = out.filter((r) => set.includes(String(r[k]))); }
    }
    if (params.order) { const [col, dir] = params.order.split('.'); out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : -1) * (dir === 'desc' ? -1 : 1)); }
    if (params.limit) out = out.slice(0, Number(params.limit));
    return out;
  }
  // Modo demo: las entregas pendientes se "evalúan" a los ~8 s con una retroalimentación de ejemplo.
  function simulateEvaluations(db) {
    if (SEED !== 'demo') return false;
    let changed = false;
    for (const s of db.submissions) {
      if (s.status !== 'pendiente' || Date.now() - new Date(s.submitted_at) < 8000) continue;
      const act = db.activities.find((a) => a.id === s.activity_id);
      Object.assign(s, window.__DEMO_FEEDBACK__(act, s));
      changed = true;
    }
    return changed;
  }
  function select(table, params) {
    const db = load();
    if (simulateEvaluations(db)) save(db);
    let rows = table === 'student_submissions' ? studentView(db) : db[table].filter((r) => visible[table](db, r));
    rows = applyFilters(rows, params).map((r) => ({ ...r }));
    const sel = params.select || '*';
    if (table === 'subjects' && sel.includes('enrollments(count)')) rows.forEach((r) => { r.enrollments = [{ count: db.enrollments.filter((e) => e.subject_id === r.id).length }]; r.activities = db.activities.filter((a) => a.subject_id === r.id); });
    if (table === 'enrollments' && sel.includes('subject:subjects')) rows.forEach((r) => { r.subject = db.subjects.find((s) => s.id === r.subject_id); });
    if (table === 'enrollments' && sel.includes('student:profiles')) rows.forEach((r) => { r.student = db.profiles.find((p) => p.id === r.student_id); });
    return rows;
  }
  const rpc = {
    join_subject(db, { p_code }) {
      const s = db.subjects.find((x) => x.join_code === p_code.toUpperCase());
      if (!s) fail('Código de inscripción inválido.');
      if (!s.enrollment_open) fail('Las inscripciones de esta asignatura están cerradas.');
      if (!enrolled(db, s.id)) db.enrollments.push({ subject_id: s.id, student_id: me(), enrolled_at: now() });
      return s.id;
    },
    regenerate_join_code(db, { p_subject }) { const s = db.subjects.find((x) => x.id === p_subject); s.join_code = Math.random().toString(36).slice(2, 9).toUpperCase(); return s.join_code; },
    save_weights(db, { p_subject, p_cortes }) {
      if (p_cortes.reduce((t, c) => t + c.weight, 0) !== 100) fail('Los 3 cortes deben sumar 100%.');
      for (const c of p_cortes) Object.assign(db.cortes.find((x) => x.subject_id === p_subject && x.number === c.number), c);
      return null;
    },
    submit_activity(db, a) {
      const act = db.activities.find((x) => x.id === a.p_activity);
      if (!enrolled(db, act.subject_id)) fail('No estás inscrito en esta asignatura.');
      let s = db.submissions.find((x) => x.activity_id === act.id && x.student_id === me());
      if (s && s.submission_count >= act.max_submissions) fail(`Ya usaste los ${act.max_submissions} envío(s) permitidos para esta actividad.`);
      const fields = { content_text: a.p_text, file_path: a.p_file_path, file_name: a.p_file_name, file_size: a.p_file_size, submitted_at: now(), status: act.ai_enabled ? 'pendiente' : 'revision', ai_grade: null, ai_feedback: null, teacher_grade: null, teacher_comment: null, is_late: new Date() > new Date(act.due_at) };
      if (s) Object.assign(s, fields, { submission_count: s.submission_count + 1 });
      else { s = { id: uuid(), activity_id: act.id, student_id: me(), submission_count: 1, eval_attempts: 0, ...fields }; db.submissions.push(s); }
      return s.id;
    },
    review_submission(db, { p_submission, p_grade, p_comment, p_publish, p_count }) {
      const s = db.submissions.find((x) => x.id === p_submission);
      if (p_count != null && p_count !== s.submission_count) fail('El estudiante envió una nueva versión mientras revisabas. Vuelve a abrir la entrega.');
      Object.assign(s, { teacher_grade: p_grade, teacher_comment: p_comment || null, reviewed_at: now(), status: p_publish ? 'evaluada' : 'revision' });
      return null;
    },
    set_manual_grade(db, { p_activity, p_student, p_grade, p_comment }) {
      db.submissions.push({ id: uuid(), activity_id: p_activity, student_id: p_student, status: 'evaluada', teacher_grade: p_grade, teacher_comment: p_comment, reviewed_at: now(), submission_count: 1, eval_attempts: 0 });
      return null;
    },
    requeue_submission(db, { p_submission }) { Object.assign(db.submissions.find((x) => x.id === p_submission), { status: 'pendiente', eval_attempts: 0 }); return null; },
    mark_exported(db, { p_subject }) { const t = now(); db.subjects.find((x) => x.id === p_subject).exported_at = t; return t; },
    prepare_subject_deletion(db, { p_subject, p_confirm }) {
      const s = db.subjects.find((x) => x.id === p_subject);
      if (p_confirm.toLowerCase() !== s.name.toLowerCase()) fail('El nombre escrito no coincide con el de la asignatura.');
      if (!s.exported_at) fail('Antes de borrar debes descargar el historial completo de notas.');
      s.deletion_started_at = now();
      return null;
    },
    delete_subject(db, { p_subject }) {
      const s = db.subjects.find((x) => x.id === p_subject);
      if (!s.deletion_started_at) fail('El borrado no fue validado.');
      const acts = db.activities.filter((a) => a.subject_id === p_subject).map((a) => a.id);
      db.subjects = db.subjects.filter((x) => x.id !== p_subject);
      db.cortes = db.cortes.filter((x) => x.subject_id !== p_subject);
      db.enrollments = db.enrollments.filter((x) => x.subject_id !== p_subject);
      db.activities = db.activities.filter((x) => x.subject_id !== p_subject);
      db.submissions = db.submissions.filter((x) => !acts.includes(x.activity_id));
      return null;
    },
  };
  const tx = (fn) => async (...args) => { await new Promise((r) => setTimeout(r, 15)); const db = load(); const out = fn(db, ...args); save(db); return out; };
  const user = () => { const p = load().profiles.find((x) => x.id === me()); return p && { id: p.id, email: p.email, user_metadata: { full_name: p.full_name } }; };

  window.__SB_OVERRIDE__ = {
    url: 'mock://',
    auth: {
      get session() { return me() ? { access_token: 't', user: user(), expires_at: 9e9 } : null; },
      handleRedirect: () => null,
      getUser: async () => user(),
      signOut: async () => sessionStorage.removeItem('mockuser'),
      signInWithGoogle: () => { sessionStorage.setItem('mockuser', 'u-ana'); location.reload(); },
      onChange: () => () => {},
    },
    db: {
      select: async (t, p = {}) => { await new Promise((r) => setTimeout(r, 10)); return select(t, p); },
      single: async (t, p = {}) => select(t, p)[0] ?? null,
      insert: tx((db, table, row) => {
        const r = { id: uuid(), created_at: now(), ...row };
        if (table === 'subjects') {
          if (load().profiles.find((p) => p.id === me()).role !== 'docente') fail('No tienes permiso para realizar esta acción.');
          Object.assign(r, { join_code: SEED === 'test' ? 'K7M2QXA' : Math.random().toString(36).slice(2, 9).toUpperCase().replace(/[01OI]/g, 'X'), enrollment_open: true, exported_at: null, grade_scale: row.grade_scale ?? 5, pass_grade: row.pass_grade ?? 3 });
          [30, 30, 40].forEach((w, i) => db.cortes.push({ id: uuid(), subject_id: r.id, number: i + 1, weight: w, quiz_weight: 30, parcial_weight: 40, proyecto_weight: 30 }));
        }
        if (table === 'activities' && row.component !== 'quiz' && db.activities.some((a) => a.corte_id === row.corte_id && a.component === row.component)) fail('Este corte ya tiene esa actividad. Parcial y proyecto son únicos por corte.');
        db[table].push(r);
        return [r];
      }),
      upsert: tx((db, table, row) => { const i = db[table].findIndex((x) => x.activity_id === row.activity_id); if (i >= 0) Object.assign(db[table][i], row); else db[table].push(row); return [row]; }),
      update: tx((db, table, filters, patch) => { const rows = applyFilters(db[table], filters); rows.forEach((r) => Object.assign(r, patch)); return rows; }),
      remove: tx((db, table, filters) => { const rows = applyFilters(db[table], filters); db[table] = db[table].filter((r) => !rows.includes(r)); return null; }),
      rpc: tx((db, fn, args) => rpc[fn](db, args)),
    },
    storage: {
      upload: tx((db, bucket, path, file) => { db.files[`${bucket}/${path}`] = file.name; return { Key: path }; }),
      signedUrl: async (bucket, path) => `data:text/plain,${encodeURIComponent(path)}`,
      list: async () => [],
      listAll: async (bucket, prefix) => Object.keys(load().files).filter((k) => k.startsWith(`${bucket}/${prefix}`)).map((k) => k.slice(bucket.length + 1)),
      remove: tx((db, bucket, paths) => { paths.forEach((p) => delete db.files[`${bucket}/${p}`]); return []; }),
    },
  };
})();
