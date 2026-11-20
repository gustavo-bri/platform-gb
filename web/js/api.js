// Capa de datos de la aplicación: todas las llamadas a Supabase pasan por aquí.
import { createClient } from './sb.js';

const cfg = globalThis.APP_CONFIG || {};
export const sb = globalThis.__SB_OVERRIDE__ || createClient(cfg.supabaseUrl || 'http://localhost', cfg.supabaseAnonKey || 'anon');

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md', 'docx', 'zip', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs',
  'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'sql', 'json', 'xml', 'yaml', 'yml', 'csv', 'ipynb', 'psc', 'r', 'go', 'rb', 'php', 'kt', 'swift', 'sh'];
export const ACCEPT_ATTR = ACCEPTED_EXT.map((e) => `.${e}`).join(',');

const uid = () => sb.auth.session?.user?.id;
const inList = (ids) => `in.(${ids.join(',')})`;

export function safeFileName(name) {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const stem = (dot > 0 ? name.slice(0, dot) : name).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 70) || 'archivo';
  return ext ? `${stem}.${ext}` : stem;
}

export function validateFile(file) {
  if (!file) return null;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!ACCEPTED_EXT.includes(ext)) return `Formato .${ext} no admitido. Usa PDF, imagen, Word (.docx), texto, código o .zip.`;
  if (file.size > MAX_FILE_BYTES) return 'El archivo supera 10 MB.';
  if (file.size === 0) return 'El archivo está vacío.';
  return null;
}

// ── Perfil ────────────────────────────────────────────────────────────
export const getProfile = () => sb.db.single('profiles', { id: `eq.${uid()}` });
export const updateProfile = (patch) => sb.db.update('profiles', { id: `eq.${uid()}` }, patch);

// ── Asignaturas ───────────────────────────────────────────────────────
export async function listTeacherSubjects() {
  const subjects = await sb.db.select('subjects', {
    select: '*,enrollments(count),activities(id,due_at,published,title)', teacher_id: `eq.${uid()}`, order: 'created_at.desc',
  });
  const actIds = subjects.flatMap((s) => s.activities.map((a) => a.id));
  let pending = [];
  if (actIds.length) {
    pending = await sb.db.select('submissions', { select: 'activity_id,status,eval_attempts', activity_id: inList(actIds), status: 'in.(revision,error)' });
  }
  return subjects.map((s) => {
    const ids = new Set(s.activities.map((a) => a.id));
    return {
      ...s,
      studentCount: s.enrollments?.[0]?.count ?? 0,
      toReview: pending.filter((p) => ids.has(p.activity_id) && (p.status === 'revision' || p.eval_attempts >= 3)).length,
      nextDue: s.activities.filter((a) => a.published && new Date(a.due_at) > new Date()).sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0] || null,
    };
  });
}

export async function listStudentSubjects() {
  const enr = await sb.db.select('enrollments', { select: 'enrolled_at,subject:subjects(*)', student_id: `eq.${uid()}` });
  const subjects = enr.map((e) => e.subject).filter(Boolean);
  if (!subjects.length) return [];
  const teacherIds = [...new Set(subjects.map((s) => s.teacher_id))];
  const [teachers, cortes, activities, subs] = await Promise.all([
    sb.db.select('profiles', { select: 'id,full_name,email', id: inList(teacherIds) }),
    sb.db.select('cortes', { subject_id: inList(subjects.map((s) => s.id)) }),
    sb.db.select('activities', { subject_id: inList(subjects.map((s) => s.id)), order: 'due_at.asc' }),
    sb.db.select('student_submissions', {}),
  ]);
  return subjects.map((s) => ({
    ...s,
    teacher: teachers.find((t) => t.id === s.teacher_id),
    cortes: cortes.filter((c) => c.subject_id === s.id),
    activities: activities.filter((a) => a.subject_id === s.id),
    submissions: subs.filter((x) => activities.some((a) => a.id === x.activity_id && a.subject_id === s.id)),
  }));
}

export const createSubject = (data) => sb.db.insert('subjects', { ...data, teacher_id: uid() }).then((r) => r[0]);
export const updateSubject = (id, patch) => sb.db.update('subjects', { id: `eq.${id}` }, patch).then((r) => r[0]);
export const saveWeights = (subjectId, cortes) => sb.db.rpc('save_weights', { p_subject: subjectId, p_cortes: cortes });
export const regenerateCode = (subjectId) => sb.db.rpc('regenerate_join_code', { p_subject: subjectId });
export const joinSubject = (code) => sb.db.rpc('join_subject', { p_code: code });
export const removeStudent = (subjectId, studentId) => sb.db.remove('enrollments', { subject_id: `eq.${subjectId}`, student_id: `eq.${studentId}` });
export const markExported = (subjectId) => sb.db.rpc('mark_exported', { p_subject: subjectId });

/** Todo lo necesario para la vista de una asignatura (docente o estudiante). */
export async function getSubjectBundle(subjectId, role) {
  const subject = await sb.db.single('subjects', { id: `eq.${subjectId}` });
  if (!subject) return null;
  const [cortes, activities] = await Promise.all([
    sb.db.select('cortes', { subject_id: `eq.${subjectId}`, order: 'number.asc' }),
    sb.db.select('activities', { subject_id: `eq.${subjectId}`, order: 'due_at.asc' }),
  ]);
  if (role === 'docente') {
    const enr = await sb.db.select('enrollments', { select: 'enrolled_at,student:profiles(id,full_name,email,avatar_url)', subject_id: `eq.${subjectId}` });
    const students = enr.filter((e) => e.student).map((e) => ({ ...e.student, enrolled_at: e.enrolled_at }))
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'es'));
    const submissions = activities.length ? await sb.db.select('submissions', { activity_id: inList(activities.map((a) => a.id)) }) : [];
    return { subject, cortes, activities, students, submissions };
  }
  const [teacher, submissions] = await Promise.all([
    sb.db.single('profiles', { select: 'id,full_name,email', id: `eq.${subject.teacher_id}` }),
    activities.length ? sb.db.select('student_submissions', { activity_id: inList(activities.map((a) => a.id)) }) : [],
  ]);
  const me = sb.auth.session?.user;
  return { subject, cortes, activities, teacher, submissions, students: [{ id: me?.id, full_name: me?.user_metadata?.full_name, email: me?.email }] };
}

export const getActivity = (id) => sb.db.single('activities', { id: `eq.${id}` });
export const getActivityKey = (id) => sb.db.single('activity_keys', { activity_id: `eq.${id}` });

async function uploadTo(bucket, path, file) {
  await sb.storage.upload(bucket, path, file);
  return path;
}

/** Crea o actualiza una actividad con su clave privada y archivos. */
export async function saveActivity({ id, subjectId, data, key, statementFile, referenceFile, removeStatement, removeReference }) {
  let activity;
  if (id) activity = (await sb.db.update('activities', { id: `eq.${id}` }, data))[0];
  else activity = (await sb.db.insert('activities', { ...data, subject_id: subjectId }))[0];
  const base = `${subjectId}/${activity.id}`;
  const prevKey = id ? await getActivityKey(activity.id) : null;

  if (statementFile) {
    const path = await uploadTo('materiales', `${base}/enunciado/${Date.now()}-${safeFileName(statementFile.name)}`, statementFile);
    if (activity.statement_path) await sb.storage.remove('materiales', [activity.statement_path]).catch(() => {});
    activity = (await sb.db.update('activities', { id: `eq.${activity.id}` }, { statement_path: path, statement_name: statementFile.name }))[0];
  } else if (removeStatement && activity.statement_path) {
    await sb.storage.remove('materiales', [activity.statement_path]).catch(() => {});
    activity = (await sb.db.update('activities', { id: `eq.${activity.id}` }, { statement_path: null, statement_name: null }))[0];
  }

  const keyRow = { activity_id: activity.id, ...key };
  if (referenceFile) {
    keyRow.reference_path = await uploadTo('materiales', `${base}/referencia/${Date.now()}-${safeFileName(referenceFile.name)}`, referenceFile);
    keyRow.reference_name = referenceFile.name;
    if (prevKey?.reference_path) await sb.storage.remove('materiales', [prevKey.reference_path]).catch(() => {});
  } else if (removeReference && prevKey?.reference_path) {
    await sb.storage.remove('materiales', [prevKey.reference_path]).catch(() => {});
    keyRow.reference_path = null; keyRow.reference_name = null;
  }
  await sb.db.upsert('activity_keys', keyRow, 'activity_id');
  return activity;
}

export async function deleteActivity(activity) {
  const prefix = `${activity.subject_id}/${activity.id}`;
  for (const bucket of ['materiales', 'entregas']) {
    const files = await sb.storage.listAll(bucket, prefix).catch(() => []);
    if (files.length) await sb.storage.remove(bucket, files);
  }
  await sb.db.remove('activities', { id: `eq.${activity.id}` });
}

export const fileUrl = (bucket, path, downloadName) => sb.storage.signedUrl(bucket, path, 900, downloadName);

// ── Entregas ──────────────────────────────────────────────────────────
export async function submitActivity(activity, { text, file, previousPath }) {
  let path = null;
  if (file) {
    path = `${activity.subject_id}/${activity.id}/${uid()}/${Date.now()}-${safeFileName(file.name)}`;
    await sb.storage.upload('entregas', path, file);
  }
  try {
    await sb.db.rpc('submit_activity', {
      p_activity: activity.id, p_text: text || null, p_file_path: path,
      p_file_name: file?.name || null, p_file_mime: file?.type || null, p_file_size: file?.size ?? null,
    });
  } catch (e) {
    if (path) await sb.storage.remove('entregas', [path]).catch(() => {});
    throw e;
  }
  if (previousPath && previousPath !== path) await sb.storage.remove('entregas', [previousPath]).catch(() => {});
}

export const reviewSubmission = (id, grade, comment, publish, count) => sb.db.rpc('review_submission', { p_submission: id, p_grade: grade, p_comment: comment, p_publish: publish, p_count: count ?? null });
export const setManualGrade = (activityId, studentId, grade, comment) => sb.db.rpc('set_manual_grade', { p_activity: activityId, p_student: studentId, p_grade: grade, p_comment: comment });
export const requeueSubmission = (id) => sb.db.rpc('requeue_submission', { p_submission: id });

/** Borrado definitivo en 2 fases: el servidor valida y bloquea; luego se borran archivos y filas. Reintentable. */
export async function deleteSubjectCompletely(subject, confirmName, onProgress = () => {}) {
  onProgress('Validando y bloqueando la asignatura…');
  await sb.db.rpc('prepare_subject_deletion', { p_subject: subject.id, p_confirm: confirmName });
  for (const bucket of ['materiales', 'entregas']) {
    onProgress(`Borrando archivos (${bucket})…`);
    const files = await sb.storage.listAll(bucket, subject.id);
    for (let i = 0; i < files.length; i += 100) await sb.storage.remove(bucket, files.slice(i, i + 100));
  }
  onProgress('Borrando la asignatura…');
  await sb.db.rpc('delete_subject', { p_subject: subject.id, p_confirm: confirmName });
}
