// Vistas del DOCENTE: asignaturas, actividades por corte, estudiantes, notas, ajustes y revisión de entregas.
import * as api from '../api.js';
import {
  html, raw, render, icon, $, $$, toast, openModal, confirmDialog, withBusy, formData, copyText, downloadBlob,
  fmtDateTime, fmtDate, fmtGrade, fmtPct, relTime, toLocalInput, fromLocalInput, fileSize, emptyState, skeleton,
  statusBadge, gradeClass, currentSemester, initials, firstName,
} from '../ui.js';
import { computeGradebook, effectiveWeights, validateWeights, COMPONENTS, COMPONENT_LABEL, round } from '../grading.js';
import { corteWorkbook, corteCsv, fullHistoryWorkbook } from '../reports.js';
import { XLSX_MIME } from '../xlsx.js';
import { feedbackView } from './feedback.js';

const appUrl = () => location.origin + location.pathname;
const loading = (app, title = '') => render(app, html`${title ? html`<h1 class="sr-only">${title}</h1>` : ''}${skeleton(4)}`);

function activityStatus(a, now = new Date()) {
  if (!a.published) return html`<span class="badge badge-muted">Borrador</span>`;
  if (new Date(a.opens_at) > now) return html`<span class="badge badge-info">Programada · abre ${fmtDateTime(a.opens_at)}</span>`;
  if (new Date(a.due_at) > now) return html`<span class="badge badge-ok">Abierta</span>`;
  return html`<span class="badge badge-muted">Cerrada</span>`;
}

// ═════════════════════════════════════════════════════════════════════
// INICIO
// ═════════════════════════════════════════════════════════════════════
export async function home(ctx) {
  const { app } = ctx;
  loading(app, 'Mis asignaturas');
  const subjects = await api.listTeacherSubjects();
  if (!ctx.isCurrent()) return;
  const semesters = [...new Set(subjects.map((s) => s.semester))].sort().reverse();
  let filter = 'todos';

  const paint = () => {
    const list = subjects.filter((s) => filter === 'todos' || s.semester === filter);
    const toReview = subjects.reduce((n, s) => n + s.toReview, 0);
    render(app, html`
      <div class="page-head">
        <div><h1>Mis asignaturas</h1><p>Hola, ${firstName(ctx.profile.full_name)}. ${toReview ? html`Tienes <strong>${toReview}</strong> entrega(s) esperando tu revisión.` : 'Todo al día.'}</p></div>
        <div class="row">
          ${semesters.length > 1 ? html`<label class="sr-only" for="sem">Semestre</label>
            <select id="sem" style="width:auto">${[html`<option value="todos">Todos los semestres</option>`, ...semesters.map((s) => html`<option value="${s}" ${filter === s ? 'selected' : ''}>${s}</option>`)]}</select>` : ''}
          <button class="btn btn-primary" type="button" id="new-subject">${icon('plus')} Nueva asignatura</button>
        </div>
      </div>
      ${subjects.length === 0
        ? emptyState('Crea tu primera asignatura', 'Cada asignatura tiene 3 cortes con quiz, parcial y proyecto. Tus estudiantes se inscriben con un código.', html`<button class="btn btn-primary" type="button" data-new>${icon('plus')} Crear asignatura</button>`)
        : html`<div class="grid">${list.map((s) => html`
          <a class="card card-link" href="#/asignatura/${s.id}">
            <div class="card-top">
              <h3>${s.name}</h3>
              ${s.toReview ? html`<span class="badge badge-warn">${s.toReview} por revisar</span>` : ''}
            </div>
            <div class="card-meta">
              <span>${icon('book')} ${s.semester}${s.code ? ` · ${s.code}` : ''}${s.group_name ? ` · Grupo ${s.group_name}` : ''}</span>
              <span>${icon('users')} ${s.studentCount} estudiante${s.studentCount === 1 ? '' : 's'}</span>
            </div>
            <div class="small muted">${s.nextDue ? html`${icon('clock')} Próxima entrega: <strong>${s.nextDue.title}</strong> · ${relTime(s.nextDue.due_at)}` : 'Sin entregas próximas'}</div>
          </a>`)}</div>`}`);
    $('#new-subject')?.addEventListener('click', () => subjectForm(ctx));
    $('[data-new]')?.addEventListener('click', () => subjectForm(ctx));
    $('#sem')?.addEventListener('change', (e) => { filter = e.target.value; paint(); });
  };
  paint();
}

function subjectFields(s = {}) {
  return html`
    <label class="field"><span>Nombre de la asignatura</span>
      <input type="text" name="name" required minlength="3" maxlength="120" value="${s.name || ''}" autocomplete="off" placeholder="Ej.: Programación I"></label>
    <div class="fields-2">
      <label class="field"><span>Semestre</span><input type="text" name="semester" required minlength="4" maxlength="20" value="${s.semester || currentSemester()}" placeholder="2026-2"></label>
      <label class="field"><span>Código <span class="hint">(opcional)</span></span><input type="text" name="code" maxlength="40" value="${s.code || ''}" placeholder="PRG101"></label>
      <label class="field"><span>Grupo <span class="hint">(opcional)</span></span><input type="text" name="group_name" maxlength="40" value="${s.group_name || ''}" placeholder="A"></label>
      <label class="field"><span>Escala de notas</span>
        <select name="grade_scale">${[5, 10, 100].map((v) => html`<option value="${v}" ${Number(s.grade_scale ?? 5) === v ? 'selected' : ''}>0 a ${v}</option>`)}</select></label>
      <label class="field"><span>Nota mínima aprobatoria</span><input type="number" name="pass_grade" required min="0.1" step="0.1" inputmode="decimal" value="${s.pass_grade ?? 3}"></label>
    </div>
    <label class="field"><span>Descripción <span class="hint">(opcional)</span></span><textarea name="description" maxlength="2000" rows="3">${s.description || ''}</textarea></label>
    <label class="check"><input type="checkbox" name="auto_publish" ${s.auto_publish === false ? '' : 'checked'}>
      <span>Publicar automáticamente la evaluación de la IA<small>Si lo desactivas, cada nota queda en revisión hasta que la apruebes. Las evaluaciones de baja confianza siempre pasan por tu revisión.</small></span></label>`;
}

function readSubjectForm(form) {
  const d = formData(form);
  const out = {
    name: d.name.trim(), semester: d.semester.trim(), code: d.code.trim() || null, group_name: d.group_name.trim() || null,
    description: d.description.trim() || null, grade_scale: Number(d.grade_scale), pass_grade: Number(d.pass_grade),
    auto_publish: form.auto_publish.checked,
  };
  if (out.pass_grade > out.grade_scale) throw new Error('La nota aprobatoria no puede superar la escala.');
  return out;
}

async function subjectForm(ctx) {
  const created = await openModal({
    title: 'Nueva asignatura', submitLabel: 'Crear asignatura', body: subjectFields(),
    onSubmit: async (form) => api.createSubject(readSubjectForm(form)),
  });
  if (created?.id) { toast('Asignatura creada con sus 3 cortes.', 'success'); ctx.navigate(`/asignatura/${created.id}`); }
}

// ═════════════════════════════════════════════════════════════════════
// ASIGNATURA
// ═════════════════════════════════════════════════════════════════════
export async function subject(ctx) {
  const { app } = ctx;
  const [id, tab = 'actividades'] = ctx.params;
  loading(app, 'Asignatura');
  const b = await api.getSubjectBundle(id, 'docente');
  if (!ctx.isCurrent()) return;
  if (!b) { render(app, emptyState('Asignatura no encontrada', 'Puede que haya sido borrada o que no tengas acceso.', html`<a class="btn btn-primary" href="#/">Volver</a>`)); return; }
  const gb = computeGradebook({ ...b, now: new Date() });
  const s = b.subject;
  const toReview = b.submissions.filter((x) => x.status === 'revision' || (x.status === 'error' && x.eval_attempts >= 3)).length;
  const tabs = [['actividades', 'Actividades', 'book'], ['estudiantes', `Estudiantes (${b.students.length})`, 'users'], ['notas', 'Calificaciones', 'chart'], ['ajustes', 'Ajustes', 'settings']];
  render(app, html`
    <nav class="crumbs" aria-label="Ruta"><a href="#/">${icon('back')} Mis asignaturas</a></nav>
    <div class="page-head">
      <div>
        <h1>${s.name}</h1>
        <p>${s.semester}${s.code ? ` · ${s.code}` : ''}${s.group_name ? ` · Grupo ${s.group_name}` : ''} · Escala 0–${fmtGrade(s.grade_scale, 0)} · Aprueba con ${fmtGrade(s.pass_grade)}</p>
      </div>
      <div class="row">
        ${toReview ? html`<span class="badge badge-warn">${toReview} por revisar</span>` : ''}
        <span class="chip" title="Código de inscripción">${icon('key')} <span class="code-chip">${s.join_code}</span>
          <button class="btn-icon" type="button" id="copy-link" aria-label="Copiar enlace de inscripción">${icon('link')}</button></span>
      </div>
    </div>
    <nav class="tabs" aria-label="Secciones de la asignatura">
      ${tabs.map(([k, label, ic]) => html`<a href="#/asignatura/${id}/${k}" ${tab === k ? raw('aria-current="page"') : ''}>${icon(ic)} ${label}</a>`)}
    </nav>
    <div id="tab"></div>`);
  $('#copy-link').addEventListener('click', () => copyText(`${appUrl()}#/unirse/${s.join_code}`));
  const el = $('#tab');
  const views = { actividades: tabActivities, estudiantes: tabStudents, notas: tabGrades, ajustes: tabSettings };
  return views[tab](el, b, gb, ctx);
}

// ── Pestaña: actividades ─────────────────────────────────────────────
function tabActivities(el, b, gb, ctx) {
  const eff = effectiveWeights(b.cortes, b.activities);
  const counts = {};
  for (const x of b.submissions) {
    counts[x.activity_id] ??= { total: 0, review: 0, graded: 0 };
    if (x.content_text || x.file_path) counts[x.activity_id].total++;
    if (x.status === 'revision' || (x.status === 'error' && x.eval_attempts >= 3)) counts[x.activity_id].review++;
    if (x.status === 'evaluada') counts[x.activity_id].graded++;
  }
  const n = b.students.length;
  render(el, html`
    ${b.students.length === 0 ? html`<div class="callout" style="margin-bottom:16px">${icon('users')}<p>Aún no hay estudiantes. Comparte el código <strong class="code-chip">${b.subject.join_code}</strong> o el enlace de inscripción (botón ${icon('link')} arriba).</p></div>` : ''}
    <div class="stack">
      ${b.cortes.map((c) => html`
        <section class="card corte" aria-labelledby="corte-${c.number}">
          <div class="corte-head">
            <h2 id="corte-${c.number}">Corte ${c.number}</h2>
            <span class="badge badge-primary">${fmtPct(c.weight)} del semestre</span>
          </div>
          ${COMPONENTS.map((comp) => {
            const list = b.activities.filter((a) => a.corte_id === c.id && a.component === comp);
            const canAdd = comp === 'quiz' || list.length === 0;
            return html`
              <div class="comp">
                <div class="comp-head">
                  <h3>${COMPONENT_LABEL[comp]} <span class="badge badge-muted">${fmtPct(c[`${comp}_weight`])} del corte</span></h3>
                  ${canAdd ? html`<button class="btn btn-secondary btn-sm" type="button" data-add="${comp}" data-corte="${c.id}">${icon('plus')} ${comp === 'quiz' ? (list.length ? 'Otro quiz' : 'Crear quiz') : `Crear ${COMPONENT_LABEL[comp].toLowerCase()}`}</button>` : ''}
                </div>
                ${list.length === 0 ? html`<p class="comp-empty">${comp === 'quiz' ? 'Sin quizzes. Puedes crear uno o varios; se promedian según su peso.' : `Sin ${COMPONENT_LABEL[comp].toLowerCase()}. Es una única actividad por corte.`}</p>` : ''}
                ${list.map((a) => {
                  const k = counts[a.id] || { total: 0, review: 0 };
                  return html`
                    <div class="act">
                      <div>
                        <a class="act-title" href="#/actividad/${a.id}">${a.title}</a>
                        <div class="act-meta">
                          ${activityStatus(a)}
                          <span>${icon('clock')} ${fmtDateTime(a.due_at)}</span>
                          <span>${k.total}/${n} entregas</span>
                          ${k.review ? html`<span class="badge badge-warn">${k.review} por revisar</span>` : ''}
                          <span>Vale ${fmtPct(eff[a.id]?.inSemester ?? 0)} de la nota final</span>
                          ${a.ai_enabled ? '' : html`<span class="badge badge-muted">Calificación manual</span>`}
                        </div>
                      </div>
                      <div class="act-actions">
                        <button class="btn-icon" type="button" data-edit="${a.id}" aria-label="Editar ${a.title}">${icon('edit')}</button>
                        <button class="btn-icon" type="button" data-del="${a.id}" aria-label="Eliminar ${a.title}">${icon('trash')}</button>
                      </div>
                    </div>`;
                })}
              </div>`;
          })}
        </section>`)}
    </div>`);

  el.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (add) {
      const corte = b.cortes.find((c) => c.id === add.dataset.corte);
      if (await activityForm({ subject: b.subject, corte, component: add.dataset.add })) ctx.rerender();
    } else if (edit) {
      const a = b.activities.find((x) => x.id === edit.dataset.edit);
      if (await activityForm({ subject: b.subject, corte: b.cortes.find((c) => c.id === a.corte_id), component: a.component, activity: a })) ctx.rerender();
    } else if (del) {
      const a = b.activities.find((x) => x.id === del.dataset.del);
      const subs = b.submissions.filter((x) => x.activity_id === a.id).length;
      const ok = await confirmDialog({
        title: 'Eliminar actividad',
        message: `Se eliminará «${a.title}»${subs ? ` junto con ${subs} entrega(s) y sus notas` : ''}. Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
      });
      if (ok) await withBusy(null, async () => { await api.deleteActivity(a); toast('Actividad eliminada.', 'success'); ctx.rerender(); });
    }
  });
}

/** Formulario de creación/edición de actividad. Devuelve la actividad guardada o undefined. */
export async function activityForm({ subject, corte, component, activity: a = null }) {
  const key = a ? await api.getActivityKey(a.id).catch(() => null) : null;
  const now = new Date();
  const defOpen = a?.opens_at || now.toISOString();
  const defDue = a?.due_at || new Date(now.getTime() + 7 * 86400e3).toISOString();
  return openModal({
    title: `${a ? 'Editar' : 'Nuevo'} ${COMPONENT_LABEL[component].toLowerCase()} · Corte ${corte.number}`,
    submitLabel: a ? 'Guardar cambios' : 'Crear actividad',
    wide: true,
    body: html`
      <label class="field"><span>Título</span><input type="text" name="title" required minlength="3" maxlength="150" value="${a?.title || ''}" placeholder="${component === 'quiz' ? 'Quiz 1 — Variables y tipos' : `${COMPONENT_LABEL[component]} ${corte.number}`}"></label>
      <label class="field"><span>Enunciado / instrucciones</span><textarea name="instructions" required maxlength="20000" rows="6" placeholder="Describe con precisión qué debe entregar el estudiante y cómo.">${a?.instructions || ''}</textarea></label>
      <div class="field"><span>Archivo de enunciado <span class="hint">(opcional; PDF, imagen, Word, texto o .zip — máx. 10 MB)</span></span>
        ${a?.statement_name ? html`<div class="small">Actual: <strong>${a.statement_name}</strong> <label class="check" style="display:inline-flex;min-height:auto"><input type="checkbox" name="remove_statement"> Quitar</label></div>` : ''}
        <input type="file" name="statement_file" accept="${api.ACCEPT_ATTR}"></div>
      <label class="field"><span>Criterios de evaluación (rúbrica) <span class="hint">— visibles para el estudiante</span></span>
        <textarea name="rubric" maxlength="10000" rows="4" placeholder="Ej.: Corrección del algoritmo (50 %), Uso de estructuras adecuadas (30 %), Claridad y comentarios (20 %)">${a?.rubric || ''}</textarea></label>
      <fieldset class="private">
        <legend>${icon('key')} Solo para ti y el agente evaluador</legend>
        <label class="field"><span>Respuesta o solución de referencia</span>
          <textarea name="reference_solution" class="code" maxlength="60000" rows="6" placeholder="La respuesta de mayor precisión. El agente la usa como guía, aceptando soluciones alternativas válidas.">${key?.reference_solution || ''}</textarea></label>
        <div class="field"><span>Archivo de solución <span class="hint">(opcional)</span></span>
          ${key?.reference_name ? html`<div class="small">Actual: <strong>${key.reference_name}</strong> <label class="check" style="display:inline-flex;min-height:auto"><input type="checkbox" name="remove_reference"> Quitar</label></div>` : ''}
          <input type="file" name="reference_file" accept="${api.ACCEPT_ATTR}"></div>
        <label class="field"><span>Indicaciones privadas para el agente <span class="hint">(opcional)</span></span>
          <textarea name="grading_notes" maxlength="10000" rows="3" placeholder="Ej.: No penalizar nombres de variables. Exigir análisis de complejidad.">${key?.grading_notes || ''}</textarea></label>
      </fieldset>
      <div class="fields-2">
        <label class="field"><span>Disponible desde</span><input type="datetime-local" name="opens_at" required value="${toLocalInput(defOpen)}"></label>
        <label class="field"><span>Fecha límite</span><input type="datetime-local" name="due_at" required value="${toLocalInput(defDue)}"></label>
        ${component === 'quiz' ? html`<label class="field"><span>Peso entre quizzes del corte <span class="hint">(1 = igual a los demás)</span></span>
          <input type="number" name="weight" min="0.1" max="100" step="0.1" inputmode="decimal" required value="${a?.weight ?? 1}"></label>` : ''}
        <label class="field"><span>Envíos permitidos</span><input type="number" name="max_submissions" min="1" max="10" step="1" inputmode="numeric" required value="${a?.max_submissions ?? 1}">
          <span class="hint">Más de 1 permite corregir con la retroalimentación antes de la fecha límite.</span></label>
      </div>
      <label class="check"><input type="checkbox" name="accept_text" ${a?.accept_text === false ? '' : 'checked'}><span>Admite respuesta escrita</span></label>
      <label class="check"><input type="checkbox" name="accept_files" ${a?.accept_files === false ? '' : 'checked'}><span>Admite archivo adjunto</span></label>
      <label class="check"><input type="checkbox" name="allow_late" ${a?.allow_late ? 'checked' : ''}><span>Aceptar entregas tardías<small>Se marcan como tardías para que lo tengas en cuenta.</small></span></label>
      <label class="check"><input type="checkbox" name="ai_enabled" ${a?.ai_enabled === false ? '' : 'checked'}><span>Evaluación automática con IA<small>Si la desactivas, calificas tú cada entrega.</small></span></label>
      <label class="check"><input type="checkbox" name="published" ${a?.published === false ? '' : 'checked'}><span>Publicada<small>Los estudiantes la ven desde la fecha de apertura y reciben aviso por correo.</small></span></label>`,
    onSubmit: async (form) => {
      const d = formData(form);
      const opens = fromLocalInput(d.opens_at);
      const due = fromLocalInput(d.due_at);
      if (new Date(due) <= new Date(opens)) throw new Error('La fecha límite debe ser posterior a la fecha de apertura.');
      if (!form.accept_text.checked && !form.accept_files.checked) throw new Error('Activa al menos un tipo de entrega (texto o archivo).');
      const statementFile = form.statement_file.files[0];
      const referenceFile = form.reference_file.files[0];
      for (const f of [statementFile, referenceFile]) { const err = api.validateFile(f); if (err) throw new Error(err); }
      const data = {
        corte_id: corte.id, component, title: d.title.trim(), instructions: d.instructions.trim(), rubric: d.rubric.trim() || null,
        opens_at: opens, due_at: due, max_submissions: Number(d.max_submissions),
        weight: component === 'quiz' ? Number(d.weight) : 1,
        accept_text: form.accept_text.checked, accept_files: form.accept_files.checked, allow_late: form.allow_late.checked,
        ai_enabled: form.ai_enabled.checked, published: form.published.checked,
      };
      const keyData = { reference_solution: d.reference_solution.trim() || null, grading_notes: d.grading_notes.trim() || null };
      const hasRef = keyData.reference_solution || referenceFile || (key?.reference_path && !form.remove_reference?.checked);
      if (data.ai_enabled && !hasRef && !data.rubric && !form.dataset.warned) {
        form.dataset.warned = '1';
        throw new Error('Recomendación: agrega una solución de referencia o una rúbrica para que la IA evalúe con precisión. Si continúas sin ellas, cada evaluación irá a tu revisión. Pulsa de nuevo para guardar igualmente.');
      }
      const saved = await api.saveActivity({
        id: a?.id, subjectId: subject.id, data, key: keyData, statementFile, referenceFile,
        removeStatement: form.remove_statement?.checked, removeReference: form.remove_reference?.checked,
      });
      toast(a ? 'Actividad actualizada.' : 'Actividad creada.', 'success');
      return saved;
    },
  });
}

// ── Pestaña: estudiantes ─────────────────────────────────────────────
function tabStudents(el, b, gb, ctx) {
  const s = b.subject;
  const link = `${appUrl()}#/unirse/${s.join_code}`;
  const byId = Object.fromEntries(gb.rows.map((r) => [r.student.id, r]));
  render(el, html`
    <div class="two-col">
      <div>
        ${b.students.length === 0
          ? emptyState('Aún no hay estudiantes inscritos', 'Comparte el código o el enlace. Al entrar con su cuenta de Google quedan inscritos automáticamente.')
          : html`<div class="table-wrap"><table>
            <caption class="sr-only">Estudiantes inscritos</caption>
            <thead><tr><th scope="col">Estudiante</th><th scope="col">Inscripción</th><th scope="col" class="num">Nota acumulada</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
            <tbody>${b.students.map((st) => html`
              <tr>
                <td><div class="row" style="gap:10px;flex-wrap:nowrap"><span class="avatar" aria-hidden="true">${initials(st.full_name)}</span><div><strong>${st.full_name}</strong><div class="small muted">${st.email}</div></div></div></td>
                <td class="small">${fmtDate(st.enrolled_at)}</td>
                <td class="num"><span class="grade ${gradeClass(byId[st.id]?.final, s.pass_grade)}">${fmtGrade(byId[st.id]?.final, 2)}</span> <span class="small muted">(${fmtPct(byId[st.id]?.evaluatedPct)} evaluado)</span></td>
                <td><button class="btn-icon" type="button" data-remove="${st.id}" aria-label="Retirar a ${st.full_name}">${icon('trash')}</button></td>
              </tr>`)}</tbody></table></div>`}
      </div>
      <aside class="card stack">
        <h2>Inscripción</h2>
        <p class="muted">Tus estudiantes entran con su cuenta de Google y escriben este código (o abren el enlace).</p>
        <div class="chip" style="justify-content:space-between"><span class="code-chip" style="font-size:1.5rem">${s.join_code}</span>
          <button class="btn-icon" type="button" id="copy-code" aria-label="Copiar código">${icon('copy')}</button></div>
        <button class="btn btn-secondary" type="button" id="copy-link2">${icon('link')} Copiar enlace de inscripción</button>
        <label class="check"><input type="checkbox" id="enroll-open" ${s.enrollment_open ? 'checked' : ''}><span>Inscripciones abiertas<small>Ciérralas cuando tengas la lista completa.</small></span></label>
        <button class="btn btn-ghost" type="button" id="regen">${icon('refresh')} Generar un código nuevo</button>
      </aside>
    </div>`);
  $('#copy-code').addEventListener('click', () => copyText(s.join_code));
  $('#copy-link2').addEventListener('click', () => copyText(link));
  $('#enroll-open').addEventListener('change', async (e) => {
    try { await api.updateSubject(s.id, { enrollment_open: e.target.checked }); toast(e.target.checked ? 'Inscripciones abiertas.' : 'Inscripciones cerradas.', 'success'); } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
  });
  $('#regen').addEventListener('click', async (e) => {
    if (await confirmDialog({ title: 'Generar código nuevo', message: 'El código y el enlace actuales dejarán de funcionar. Los estudiantes ya inscritos no se ven afectados.', confirmLabel: 'Generar', danger: false })) {
      await withBusy(e.target.closest('button'), async () => { await api.regenerateCode(s.id); ctx.rerender(); });
    }
  });
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const st = b.students.find((x) => x.id === btn.dataset.remove);
    if (await confirmDialog({ title: 'Retirar estudiante', message: `${st.full_name} dejará de ver la asignatura. Sus entregas se conservan y vuelven a aparecer si se inscribe de nuevo.`, confirmLabel: 'Retirar' })) {
      await withBusy(btn, async () => { await api.removeStudent(s.id, st.id); toast('Estudiante retirado.', 'success'); ctx.rerender(); });
    }
  });
}

// ── Pestaña: calificaciones ──────────────────────────────────────────
async function downloadFullHistory(b, gb) {
  const { bytes, filename } = fullHistoryWorkbook(b, gb);
  downloadBlob(new Blob([bytes], { type: XLSX_MIME }), filename);
  const at = await api.markExported(b.subject.id);
  b.subject.exported_at = at;
  toast('Historial completo descargado.', 'success');
}

function tabGrades(el, b, gb, ctx) {
  let view = Number(sessionStorage.getItem(`aula.gview.${b.subject.id}`) || 1);
  const pass = Number(b.subject.pass_grade);
  const cell = (res, aId) => {
    if (!res) return '—';
    if (res.counts && res.grade != null) return html`<a class="grade ${gradeClass(res.grade, pass)}" href="#/actividad/${aId}">${fmtGrade(res.grade)}${res.provisional ? html`<span title="Provisional: pendiente de tu revisión">*</span>` : ''}</a>`;
    return statusBadge(res.state);
  };
  const paint = () => {
    sessionStorage.setItem(`aula.gview.${b.subject.id}`, String(view));
    const corte = gb.cortes.find((c) => c.number === view);
    const acts = corte ? gb.activities.filter((a) => a.corte_id === corte.id).sort((x, y) => COMPONENTS.indexOf(x.component) - COMPONENTS.indexOf(y.component) || new Date(x.due_at) - new Date(y.due_at)) : [];
    render(el, html`
      <div class="section-head">
        <div class="seg" role="group" aria-label="Vista de notas">
          ${[1, 2, 3].map((n) => html`<button type="button" data-view="${n}" aria-pressed="${view === n}">Corte ${n}</button>`)}
          <button type="button" data-view="0" aria-pressed="${view === 0}">Definitiva</button>
        </div>
        <div class="row">
          ${view ? html`
            <button class="btn btn-secondary btn-sm" type="button" id="xlsx">${icon('download')} Excel corte ${view}</button>
            <button class="btn btn-secondary btn-sm" type="button" id="csv">${icon('download')} CSV corte ${view}</button>` : ''}
          <button class="btn btn-primary btn-sm" type="button" id="full">${icon('download')} Historial completo (Excel)</button>
        </div>
      </div>
      ${b.students.length === 0 ? emptyState('Sin estudiantes', 'Las notas aparecerán cuando haya estudiantes inscritos.') : html`
      <div class="table-wrap"><table>
        <caption class="sr-only">${view ? `Notas del corte ${view}` : 'Notas definitivas'}</caption>
        <thead><tr>
          <th scope="col" class="sticky-col">Estudiante</th>
          ${view ? html`
            ${acts.map((a) => html`<th scope="col" class="num" title="${a.title}">${COMPONENT_LABEL[a.component]}<br><span style="text-transform:none;font-weight:500">${a.title.length > 22 ? `${a.title.slice(0, 21)}…` : a.title}</span></th>`)}
            <th scope="col" class="num">Quiz ${fmtPct(corte.quiz_weight)}</th><th scope="col" class="num">Corte ${view}</th><th scope="col" class="num">% evaluado</th>`
          : html`${gb.cortes.map((c) => html`<th scope="col" class="num">Corte ${c.number}<br><span style="text-transform:none">${fmtPct(c.weight)}</span></th>`)}
            <th scope="col" class="num">Definitiva</th><th scope="col" class="num">% evaluado</th><th scope="col">Estado</th>`}
        </tr></thead>
        <tbody>${[...gb.rows].sort((x, y) => (x.student.full_name || '').localeCompare(y.student.full_name || '', 'es')).map((r) => {
          const c = r.cortes.find((x) => x.number === view);
          return html`<tr>
            <th scope="row" class="sticky-col" style="text-transform:none;letter-spacing:0;font-size:.93rem;color:var(--text);background:var(--surface)">${r.student.full_name}</th>
            ${view ? html`
              ${acts.map((a) => html`<td class="num">${cell(r.items[a.id], a.id)}</td>`)}
              <td class="num">${c.quiz.grade == null ? '—' : html`<span class="grade">${fmtGrade(c.quiz.grade, 2)}</span>`}</td>
              <td class="num"><strong class="grade ${gradeClass(c.grade, pass)}">${fmtGrade(c.grade, 2)}</strong></td>
              <td class="num small">${fmtPct(c.evaluatedPct)}</td>`
            : html`${r.cortes.map((x) => html`<td class="num"><span class="grade ${gradeClass(x.grade, pass)}">${fmtGrade(x.grade, 2)}</span></td>`)}
              <td class="num"><strong class="grade ${gradeClass(r.final, pass)}">${fmtGrade(r.final, 2)}</strong>${r.provisional ? '*' : ''}</td>
              <td class="num small">${fmtPct(r.evaluatedPct)}</td>
              <td>${r.passed === null ? html`<span class="badge badge-muted">En curso</span>` : r.passed ? html`<span class="badge badge-ok">Aprueba</span>` : html`<span class="badge badge-danger">No aprueba</span>`}</td>`}
          </tr>`;
        })}</tbody>
      </table></div>
      <p class="small muted" style="margin-top:12px">Las actividades vencidas sin entrega cuentan 0. Las pendientes cuentan 0 en la nota acumulada y se informa el porcentaje ya evaluado. * = incluye notas provisionales pendientes de tu revisión.</p>`}`);
  };
  paint();
  el.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-view]');
    if (v) { view = Number(v.dataset.view); paint(); return; }
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'xlsx') { const { bytes, filename } = corteWorkbook(b, gb, view); downloadBlob(new Blob([bytes], { type: XLSX_MIME }), filename); }
    if (btn.id === 'csv') { const { text, filename } = corteCsv(b, gb, view); downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), filename); }
    if (btn.id === 'full') await withBusy(btn, () => downloadFullHistory(b, gb));
  });
}

// ── Pestaña: ajustes ─────────────────────────────────────────────────
function lastGradeChange(b) {
  let last = null;
  for (const x of b.submissions) for (const t of [x.submitted_at, x.evaluated_at, x.reviewed_at]) if (t && (!last || new Date(t) > last)) last = new Date(t);
  return last;
}

function tabSettings(el, b, gb, ctx) {
  const s = b.subject;
  const exportedOk = () => s.exported_at && (!lastGradeChange(b) || lastGradeChange(b) <= new Date(s.exported_at));
  render(el, html`
    <div class="stack">
      <form class="card" id="info-form" novalidate>
        <h2>Datos de la asignatura</h2>
        ${subjectFields(s)}
        <p class="inline-error" role="alert" hidden></p>
        <button class="btn btn-primary" type="submit">Guardar datos</button>
      </form>

      <form class="card" id="weights-form" novalidate>
        <h2>Ponderaciones</h2>
        <p class="muted">Peso de cada corte en el semestre y de quiz, parcial y proyecto dentro de cada corte. Cada fila de componentes y la columna de cortes deben sumar 100 %.</p>
        <div class="table-wrap"><table class="weights">
          <thead><tr><th scope="col">Corte</th><th scope="col" class="num">% del semestre</th><th scope="col" class="num">Quiz %</th><th scope="col" class="num">Parcial %</th><th scope="col" class="num">Proyecto %</th><th scope="col" class="num">Suma</th></tr></thead>
          <tbody>${b.cortes.map((c) => html`<tr data-n="${c.number}">
            <th scope="row" style="text-transform:none;font-size:.95rem;color:var(--text);background:var(--surface)">Corte ${c.number}</th>
            ${['weight', 'quiz_weight', 'parcial_weight', 'proyecto_weight'].map((f) => html`<td class="num"><label class="sr-only" for="w-${c.number}-${f}">${f} corte ${c.number}</label><input id="w-${c.number}-${f}" type="number" name="${f}" min="0" max="100" step="0.5" inputmode="decimal" required value="${Number(c[f])}"></td>`)}
            <td class="num" data-sum></td></tr>`)}
          </tbody>
          <tfoot><tr><th scope="row" style="background:var(--surface)">Total cortes</th><td class="num" id="total-cortes"></td><td colspan="4"></td></tr></tfoot>
        </table></div>
        <p class="inline-error" role="alert" hidden></p>
        <br><button class="btn btn-primary" type="submit">Guardar ponderaciones</button>
      </form>

      <section class="card" aria-labelledby="danger-h" style="border-color:color-mix(in srgb, var(--danger) 40%, var(--border))">
        <h2 id="danger-h">Cerrar el semestre: borrar la asignatura</h2>
        <p class="muted">Al terminar el semestre puedes borrar la asignatura con sus actividades, entregas, archivos y notas. Antes debes descargar el historial completo de notas de los 3 cortes.</p>
        <div id="export-state"></div>
        <div class="row">
          <button class="btn btn-secondary" type="button" id="dl-full">${icon('download')} Descargar historial completo</button>
          <button class="btn btn-danger" type="button" id="delete-subject">${icon('trash')} Borrar asignatura</button>
        </div>
      </section>
    </div>`);

  const paintExport = () => render($('#export-state'), exportedOk()
    ? html`<div class="callout">${icon('check')}<p>Historial descargado el ${fmtDateTime(s.exported_at)}. Ya puedes borrar la asignatura.</p></div><br>`
    : html`<div class="callout warn">${icon('alert')}<p>${s.exported_at ? `Hubo cambios en las notas después de tu última descarga (${fmtDateTime(s.exported_at)}).` : 'Aún no has descargado el historial completo.'} Descárgalo para habilitar el borrado.</p></div><br>`);
  paintExport();

  const info = $('#info-form');
  info.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = info.querySelector('.inline-error'); err.hidden = true;
    if (!info.checkValidity()) return info.reportValidity();
    await withBusy(info.querySelector('[type=submit]'), async () => {
      try { await api.updateSubject(s.id, readSubjectForm(info)); toast('Datos guardados.', 'success'); ctx.rerender(); } catch (x) { err.textContent = x.message; err.hidden = false; }
    });
  });

  const wf = $('#weights-form');
  const readWeights = () => $$('tbody tr', wf).map((tr) => ({
    number: Number(tr.dataset.n), ...Object.fromEntries(['weight', 'quiz_weight', 'parcial_weight', 'proyecto_weight'].map((f) => [f, Number(tr.querySelector(`[name=${f}]`).value)])),
  }));
  const paintSums = () => {
    const ws = readWeights();
    $$('tbody tr', wf).forEach((tr, i) => {
      const sum = round(ws[i].quiz_weight + ws[i].parcial_weight + ws[i].proyecto_weight, 2);
      render(tr.querySelector('[data-sum]'), html`<span class="${sum === 100 ? 'sum-ok' : 'sum-bad'}">${sum} %</span>`);
    });
    const t = round(ws.reduce((x, c) => x + c.weight, 0), 2);
    render($('#total-cortes'), html`<span class="${t === 100 ? 'sum-ok' : 'sum-bad'}">${t} %</span>`);
  };
  paintSums();
  wf.addEventListener('input', paintSums);
  wf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = wf.querySelector('.inline-error'); err.hidden = true;
    const ws = readWeights();
    const errors = validateWeights(ws);
    if (errors.length) { err.textContent = errors.join(' '); err.hidden = false; return; }
    await withBusy(wf.querySelector('[type=submit]'), async () => {
      try { await api.saveWeights(s.id, ws); toast('Ponderaciones guardadas.', 'success'); ctx.rerender(); } catch (x) { err.textContent = x.message; err.hidden = false; }
    });
  });

  $('#dl-full').addEventListener('click', (e) => withBusy(e.target.closest('button'), async () => { await downloadFullHistory(b, gb); paintExport(); }));
  $('#delete-subject').addEventListener('click', async () => {
    if (!exportedOk()) { toast('Primero descarga el historial completo de notas.', 'error'); $('#dl-full').focus(); return; }
    const done = await openModal({
      title: 'Borrar asignatura definitivamente', submitLabel: 'Borrar para siempre', danger: true,
      body: html`
        <div class="callout danger">${icon('alert')}<p>Se borrarán <strong>${b.activities.length}</strong> actividades, <strong>${b.submissions.length}</strong> entregas con sus archivos y notas, y la inscripción de <strong>${b.students.length}</strong> estudiantes. No se puede deshacer.</p></div><br>
        <label class="field"><span>Escribe el nombre de la asignatura para confirmar: <strong>${s.name}</strong></span>
          <input type="text" name="confirm" required autocomplete="off" spellcheck="false"></label>
        <p class="small muted" id="del-progress" aria-live="polite"></p>`,
      onSubmit: async (form) => {
        const v = form.confirm.value.trim();
        if (v.toLowerCase() !== s.name.trim().toLowerCase()) throw new Error('El nombre no coincide.');
        await api.deleteSubjectCompletely(s, v, (m) => { form.querySelector('#del-progress').textContent = m; });
        return true;
      },
    });
    if (done) { toast('Asignatura borrada.', 'success'); ctx.navigate('/'); }
  });
}

// ═════════════════════════════════════════════════════════════════════
// ACTIVIDAD (docente)
// ═════════════════════════════════════════════════════════════════════
export async function activity(ctx) {
  const { app } = ctx;
  const [activityId] = ctx.params;
  loading(app, 'Actividad');
  const a = await api.getActivity(activityId);
  if (!ctx.isCurrent()) return;
  if (!a) { render(app, emptyState('Actividad no encontrada', 'Puede que haya sido eliminada.', html`<a class="btn btn-primary" href="#/">Volver</a>`)); return; }
  const [b, key] = await Promise.all([api.getSubjectBundle(a.subject_id, 'docente'), api.getActivityKey(a.id)]);
  if (!ctx.isCurrent()) return;
  const s = b.subject;
  const corte = b.cortes.find((c) => c.id === a.corte_id);
  const subs = b.submissions.filter((x) => x.activity_id === a.id);
  const byStudent = Object.fromEntries(subs.map((x) => [x.student_id, x]));
  const delivered = subs.filter((x) => x.content_text || x.file_path);
  const finals = subs.filter((x) => x.status === 'evaluada').map((x) => Number(x.teacher_grade ?? x.ai_grade)).filter((g) => !Number.isNaN(g));
  const avg = finals.length ? finals.reduce((p, c) => p + c, 0) / finals.length : null;
  const review = subs.filter((x) => x.status === 'revision' || (x.status === 'error' && x.eval_attempts >= 3));
  const inProgress = subs.some((x) => ['pendiente', 'evaluando'].includes(x.status) || (x.status === 'error' && x.eval_attempts < 3));
  const eff = effectiveWeights(b.cortes, b.activities)[a.id];
  const overdue = new Date(a.due_at) <= new Date();

  const stateOf = (st) => {
    const x = byStudent[st.id];
    if (!x) return overdue ? 'sin_entrega' : 'pendiente';
    if (x.status === 'evaluada') return 'evaluada';
    if (x.status === 'revision') return 'revision';
    if (x.status === 'error') return x.eval_attempts >= 3 ? 'error' : 'evaluando';
    return x.status === 'pendiente' ? 'pendiente_eval' : 'evaluando';
  };
  const order = { revision: 0, error: 1, evaluando: 2, pendiente_eval: 3, evaluada: 4, sin_entrega: 5, pendiente: 6 };
  const students = [...b.students].sort((x, y) => order[stateOf(x)] - order[stateOf(y)] || (x.full_name || '').localeCompare(y.full_name || '', 'es'));

  render(app, html`
    <nav class="crumbs" aria-label="Ruta"><a href="#/">Mis asignaturas</a> / <a href="#/asignatura/${s.id}">${s.name}</a></nav>
    <div class="page-head">
      <div>
        <h1>${a.title}</h1>
        <div class="row">${activityStatus(a)}<span class="badge badge-primary">${COMPONENT_LABEL[a.component]} · Corte ${corte.number}</span>
          <span class="small muted">Vale ${fmtPct(eff?.inSemester ?? 0)} de la nota final</span></div>
      </div>
      <div class="row">
        <button class="btn btn-secondary" type="button" id="edit">${icon('edit')} Editar</button>
      </div>
    </div>
    <div class="stats" style="margin-bottom:24px">
      <div class="stat"><div class="label">Entregas</div><div class="value">${delivered.length}<span class="small muted">/${b.students.length}</span></div></div>
      <div class="stat"><div class="label">Calificadas</div><div class="value">${subs.filter((x) => x.status === 'evaluada').length}</div></div>
      <div class="stat"><div class="label">Por revisar</div><div class="value" style="color:${review.length ? 'var(--warn)' : 'inherit'}">${review.length}</div></div>
      <div class="stat"><div class="label">Promedio</div><div class="value">${fmtGrade(avg, 2)}</div></div>
    </div>
    <div class="two-col">
      <section aria-labelledby="subs-h">
        <div class="section-head"><h2 id="subs-h">Entregas</h2>${inProgress ? html`<span class="badge badge-info">${icon('refresh')} El agente está evaluando; esta vista se actualiza sola</span>` : ''}</div>
        ${b.students.length === 0 ? emptyState('Sin estudiantes inscritos', 'Comparte el código de inscripción de la asignatura.') : html`
        <div class="table-wrap"><table>
          <caption class="sr-only">Entregas por estudiante</caption>
          <thead><tr><th scope="col">Estudiante</th><th scope="col">Estado</th><th scope="col" class="num">IA</th><th scope="col" class="num">Final</th><th scope="col"><span class="sr-only">Acción</span></th></tr></thead>
          <tbody>${students.map((st) => {
            const x = byStudent[st.id];
            const final = x ? x.teacher_grade ?? x.ai_grade : null;
            return html`<tr>
              <td><strong>${st.full_name}</strong><div class="small muted">${x?.submitted_at ? html`${fmtDateTime(x.submitted_at)}${x.is_late ? html` <span class="badge badge-warn">Tardía</span>` : ''}${x.submission_count > 1 ? ` · envío ${x.submission_count}` : ''}` : st.email}</div></td>
              <td>${statusBadge(stateOf(st))}${x?.ai_confidence != null && x.status !== 'evaluada' ? html`<div class="small muted">Confianza ${Math.round(x.ai_confidence * 100)} %</div>` : ''}</td>
              <td class="num">${x?.ai_grade != null ? fmtGrade(x.ai_grade) : '—'}</td>
              <td class="num"><span class="grade ${gradeClass(final, s.pass_grade)}">${final != null ? fmtGrade(final) : '—'}</span></td>
              <td><button class="btn btn-sm ${stateOf(st) === 'revision' || stateOf(st) === 'error' ? 'btn-primary' : 'btn-secondary'}" type="button" data-open="${st.id}">${x ? (stateOf(st) === 'revision' ? 'Revisar' : 'Ver') : 'Calificar'}</button></td>
            </tr>`;
          })}</tbody>
        </table></div>`}
      </section>
      <aside class="stack">
        <div class="card">
          <h2>Detalles</h2>
          <p class="small"><strong>Disponible:</strong> ${fmtDateTime(a.opens_at)}<br><strong>Fecha límite:</strong> ${fmtDateTime(a.due_at)} (${relTime(a.due_at)})<br>
            <strong>Envíos permitidos:</strong> ${a.max_submissions} · ${a.allow_late ? 'Acepta tardías' : 'No acepta tardías'}<br>
            <strong>Evaluación:</strong> ${a.ai_enabled ? 'Automática con IA' : 'Manual'}</p>
          <h3>Instrucciones</h3><p class="prose">${a.instructions}</p>
          ${a.statement_path ? html`<button class="btn btn-secondary btn-sm" type="button" data-file="materiales|${a.statement_path}|${a.statement_name}">${icon('file')} ${a.statement_name}</button>` : ''}
          ${a.rubric ? html`<h3 style="margin-top:16px">Rúbrica</h3><p class="prose">${a.rubric}</p>` : ''}
        </div>
        <div class="card private">
          <h2>${icon('key')} Solución de referencia</h2>
          ${key?.reference_solution ? html`<pre class="submission-text">${key.reference_solution}</pre>` : ''}
          ${key?.reference_path ? html`<p><button class="btn btn-secondary btn-sm" type="button" data-file="materiales|${key.reference_path}|${key.reference_name}">${icon('file')} ${key.reference_name}</button></p>` : ''}
          ${!key?.reference_solution && !key?.reference_path ? html`<p class="muted">Sin solución de referencia.${a.ai_enabled && !a.rubric ? ' Las evaluaciones de la IA irán a tu revisión.' : ''}</p>` : ''}
          ${key?.grading_notes ? html`<h3>Indicaciones para el agente</h3><p class="prose small">${key.grading_notes}</p>` : ''}
        </div>
      </aside>
    </div>`);

  $('#edit').addEventListener('click', async () => { if (await activityForm({ subject: s, corte, component: a.component, activity: a })) ctx.rerender(); });
  app.addEventListener('click', onClick);
  async function onClick(e) {
    const f = e.target.closest('[data-file]');
    if (f) {
      const [bucket, path, name] = f.dataset.file.split('|');
      await withBusy(f, async () => window.open(await api.fileUrl(bucket, path, name), '_blank', 'noopener'));
      return;
    }
    const o = e.target.closest('[data-open]');
    if (o) {
      const st = b.students.find((x) => x.id === o.dataset.open);
      const changed = await reviewModal({ subject: s, activity: a, student: st, sub: byStudent[st.id] });
      if (changed) ctx.rerender();
    }
  }
  const timer = inProgress ? setInterval(() => { if (!document.querySelector('dialog[open]')) ctx.rerender(); }, 45000) : null;
  return () => { app.removeEventListener('click', onClick); if (timer) clearInterval(timer); };
}

async function reviewModal({ subject: s, activity: a, student: st, sub: x }) {
  const scale = Number(s.grade_scale);
  let changed = false;
  const result = await openModal({
    title: `${st.full_name} · ${a.title}`,
    wide: true,
    submitLabel: 'Guardar calificación',
    body: html`
      ${x && (x.content_text || x.file_path) ? html`
        <h3>Entrega ${x.is_late ? html`<span class="badge badge-warn">Tardía</span>` : ''}</h3>
        <p class="small muted">Enviada ${fmtDateTime(x.submitted_at)}${x.submission_count > 1 ? ` · envío ${x.submission_count} de ${a.max_submissions}` : ''}</p>
        ${x.content_text ? html`<pre class="submission-text">${x.content_text}</pre>` : ''}
        ${x.file_path ? html`<p><button class="btn btn-secondary btn-sm" type="button" id="open-file">${icon('file')} ${x.file_name} ${x.file_size ? html`<span class="muted">(${fileSize(x.file_size)})</span>` : ''}</button></p>` : ''}
        <hr style="border:0;border-top:1px solid var(--border);margin:20px 0">
        <h3>${icon('sparkle')} Evaluación del agente</h3>
        ${x.ai_feedback ? feedbackView(x.ai_feedback, { grade: x.ai_grade, scale, pass: s.pass_grade, teacherView: true })
          : x.status === 'error' ? html`<div class="callout danger">${icon('alert')}<p>La evaluación automática falló ${x.eval_attempts} vez/veces. ${x.last_error ? `Detalle: ${x.last_error}` : ''}</p></div>`
            : html`<p class="muted">${a.ai_enabled ? 'Aún en cola de evaluación.' : 'Actividad de calificación manual.'}</p>`}
        ${a.ai_enabled ? html`<p><button class="btn btn-ghost btn-sm" type="button" id="requeue">${icon('refresh')} Reevaluar con IA</button></p>` : ''}
        <hr style="border:0;border-top:1px solid var(--border);margin:20px 0">` : html`<div class="callout">${icon('edit')}<p>${st.full_name} no tiene entrega. Puedes registrar una nota manual (por ejemplo, sustentación oral o entrega recibida por otro medio).</p></div><br>`}
      <h3>Tu calificación</h3>
      <div class="fields-2">
        <label class="field"><span>Nota (0 a ${fmtGrade(scale, 0)})</span>
          <input type="number" name="grade" min="0" max="${scale}" step="0.1" inputmode="decimal" value="${x?.teacher_grade ?? ''}" placeholder="${x?.ai_grade != null ? `Vacío = usar nota IA (${fmtGrade(x.ai_grade)})` : ''}" ${x?.ai_grade == null ? 'required' : ''}></label>
        ${x ? html`<label class="field"><span>Al guardar</span><select name="publish"><option value="1">Publicar al estudiante</option><option value="0" ${x.status === 'revision' && x.reviewed_at ? 'selected' : ''}>Dejar en revisión (no visible)</option></select></label>` : ''}
      </div>
      <label class="field"><span>Comentario para el estudiante <span class="hint">(opcional)</span></span>
        <textarea name="comment" rows="3" maxlength="5000">${x?.teacher_comment || ''}</textarea></label>`,
    onOpen: (dlg, close) => {
      dlg.querySelector('#open-file')?.addEventListener('click', (e) => withBusy(e.target.closest('button'), async () => window.open(await api.fileUrl('entregas', x.file_path, x.file_name), '_blank', 'noopener')));
      dlg.querySelector('#requeue')?.addEventListener('click', (e) => withBusy(e.target.closest('button'), async () => {
        await api.requeueSubmission(x.id); changed = true; toast('Enviada de nuevo a la cola del agente.', 'success'); close(true);
      }));
    },
    onSubmit: async (form) => {
      const d = formData(form);
      const grade = d.grade === '' ? null : Number(d.grade);
      if (grade != null && (grade < 0 || grade > scale)) throw new Error(`La nota debe estar entre 0 y ${scale}.`);
      if (!x) {
        if (grade == null) throw new Error('Escribe la nota.');
        await api.setManualGrade(a.id, st.id, grade, d.comment);
      } else {
        await api.reviewSubmission(x.id, grade, d.comment, d.publish !== '0', x.submission_count);
      }
      toast('Calificación guardada.', 'success');
      return true;
    },
  });
  return result || changed;
}
