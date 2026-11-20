// Vistas del ESTUDIANTE: mis asignaturas, próximas entregas, inscripción, asignatura y entrega con retroalimentación.
import * as api from '../api.js';
import {
  html, render, icon, $, toast, withBusy, fmtDateTime, fmtGrade, fmtPct, relTime, fileSize, emptyState, skeleton,
  statusBadge, gradeClass,
} from '../ui.js';
import { computeGradebook, effectiveWeights, COMPONENTS, COMPONENT_LABEL } from '../grading.js';
import { feedbackView } from './feedback.js';

const loading = (app, title) => render(app, html`<h1 class="sr-only">${title}</h1>${skeleton(4)}`);

function myRow(s) {
  const me = { id: api.sb.auth.session?.user?.id };
  return computeGradebook({ subject: s, cortes: s.cortes, activities: s.activities, students: [me], submissions: s.submissions.map((x) => ({ ...x, student_id: me.id })), mode: 'estudiante' }).rows[0];
}

function joinForm() {
  return html`
    <form class="card" id="join-form" novalidate>
      <h2>Unirme a una asignatura</h2>
      <p class="muted">Escribe el código que te compartió tu docente.</p>
      <div class="row" style="flex-wrap:nowrap">
        <label class="sr-only" for="join-code">Código de inscripción</label>
        <input id="join-code" type="text" name="code" required minlength="4" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Ej.: K7M2QXA" style="font-family:var(--mono);letter-spacing:.12em;text-transform:uppercase">
        <button class="btn btn-primary" type="submit">Unirme</button>
      </div>
      <p class="inline-error" role="alert" hidden></p>
    </form>`;
}

function bindJoin(ctx) {
  const form = $('#join-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.inline-error'); err.hidden = true;
    const code = form.code.value.trim().toUpperCase();
    if (code.length < 4) { err.textContent = 'Escribe un código válido.'; err.hidden = false; return; }
    await withBusy(form.querySelector('button'), async () => {
      try {
        const id = await api.joinSubject(code);
        toast('¡Listo! Ya estás inscrito.', 'success');
        ctx.navigate(`/asignatura/${id}`);
      } catch (x) { err.textContent = x.message; err.hidden = false; }
    });
  });
}

// ═════════════════════════════════════════════════════════════════════
export async function home(ctx) {
  const { app } = ctx;
  loading(app, 'Mis asignaturas');
  const subjects = await api.listStudentSubjects();
  if (!ctx.isCurrent()) return;
  const now = new Date();
  const subMap = new Map(subjects.flatMap((s) => s.submissions.map((x) => [x.activity_id, x])));
  const upcoming = subjects.flatMap((s) => s.activities.filter((a) => new Date(a.due_at) > now).map((a) => ({ a, s, sub: subMap.get(a.id) })))
    .sort((x, y) => new Date(x.a.due_at) - new Date(y.a.due_at));
  const todo = upcoming.filter((u) => !u.sub);
  render(app, html`
    <div class="page-head">
      <div><h1>Hola, ${ctx.profile.full_name.split(' ')[0]}</h1>
        <p>${todo.length ? html`Tienes <strong>${todo.length}</strong> entrega(s) pendiente(s).` : subjects.length ? 'No tienes entregas pendientes.' : 'Únete a tu primera asignatura con el código de tu docente.'}</p></div>
    </div>
    <div class="two-col">
      <div class="stack">
        <section aria-labelledby="up-h">
          <div class="section-head"><h2 id="up-h">Próximas entregas</h2></div>
          ${upcoming.length === 0 ? html`<div class="card"><p class="muted" style="margin:0">Nada por ahora. Cuando tu docente publique actividades te avisaremos por correo.</p></div>` : html`
            <div class="card" style="padding:8px 20px">${upcoming.slice(0, 8).map(({ a, s, sub }) => {
              const hours = (new Date(a.due_at) - now) / 3600e3;
              return html`<div class="act">
                <div><a class="act-title" href="#/actividad/${a.id}">${a.title}</a>
                  <div class="act-meta"><span>${s.name}</span><span>${COMPONENT_LABEL[a.component]}</span>
                    <span class="${!sub && hours < 24 ? 'badge badge-danger' : ''}">${icon('clock')} ${relTime(a.due_at)}</span></div></div>
                ${sub ? statusBadge(sub.status === 'evaluada' ? 'calificada' : sub.status) : html`<span class="badge badge-muted">Por entregar</span>`}
              </div>`;
            })}</div>`}
        </section>
        <section aria-labelledby="subj-h">
          <div class="section-head"><h2 id="subj-h">Mis asignaturas</h2></div>
          ${subjects.length === 0 ? emptyState('Aún no estás en ninguna asignatura', 'Pide a tu docente el código de inscripción y escríbelo en el formulario.') : html`
            <div class="grid">${subjects.map((s) => {
              const r = myRow(s);
              return html`<a class="card card-link" href="#/asignatura/${s.id}">
                <h3>${s.name}</h3>
                <div class="card-meta"><span>${icon('book')} ${s.semester}</span><span>${icon('users')} ${s.teacher?.full_name || 'Docente'}</span></div>
                <div class="row" style="justify-content:space-between"><span class="small muted">Nota acumulada</span>
                  <span class="grade ${gradeClass(r.final, s.pass_grade)}">${fmtGrade(r.final, 2)} / ${fmtGrade(s.grade_scale, 0)}</span></div>
                <div class="progress" role="progressbar" aria-label="Porcentaje del semestre evaluado" aria-valuenow="${r.evaluatedPct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${r.evaluatedPct}%"></span></div>
                <div class="small muted">${fmtPct(r.evaluatedPct)} del semestre evaluado</div>
              </a>`;
            })}</div>`}
        </section>
      </div>
      <aside>${joinForm()}</aside>
    </div>`);
  bindJoin(ctx);
}

// ═════════════════════════════════════════════════════════════════════
export async function join(ctx) {
  const { app } = ctx;
  const code = ctx.params[0].toUpperCase();
  if (ctx.profile.role === 'docente') {
    render(app, emptyState('Este enlace es para estudiantes', `Comparte el código ${code} con tus estudiantes.`, html`<a class="btn btn-primary" href="#/">Ir a mis asignaturas</a>`));
    return;
  }
  render(app, html`<div class="boot" aria-busy="true"><div class="spinner" aria-hidden="true"></div><h1 class="small">Inscribiéndote con el código ${code}…</h1></div>`);
  try {
    const id = await api.joinSubject(code);
    toast('¡Listo! Ya estás inscrito.', 'success');
    history.replaceState(null, '', `#/asignatura/${id}`);
    ctx.rerender();
  } catch (e) {
    render(app, html`<div class="stack" style="max-width:520px;margin:0 auto"><div class="callout danger" role="alert">${icon('alert')}<p>${e.message}</p></div>${joinForm()}</div>`);
    bindJoin(ctx);
  }
}

// ═════════════════════════════════════════════════════════════════════
export async function subject(ctx) {
  const { app } = ctx;
  const [id] = ctx.params;
  loading(app, 'Asignatura');
  const b = await api.getSubjectBundle(id, 'estudiante');
  if (!ctx.isCurrent()) return;
  if (!b) { render(app, emptyState('Asignatura no disponible', 'No estás inscrito o la asignatura ya no existe.', html`<a class="btn btn-primary" href="#/">Volver</a>`)); return; }
  const s = b.subject;
  const r = myRow({ ...s, cortes: b.cortes, activities: b.activities, submissions: b.submissions });
  const eff = effectiveWeights(b.cortes, b.activities);
  const subMap = Object.fromEntries(b.submissions.map((x) => [x.activity_id, x]));
  render(app, html`
    <nav class="crumbs" aria-label="Ruta"><a href="#/">${icon('back')} Inicio</a></nav>
    <div class="page-head"><div><h1>${s.name}</h1><p>${s.semester}${s.code ? ` · ${s.code}` : ''} · Docente: ${b.teacher?.full_name || '—'}</p></div></div>
    <div class="stats" style="margin-bottom:24px">
      <div class="stat"><div class="label">Nota acumulada</div><div class="value grade ${gradeClass(r.final, s.pass_grade)}">${fmtGrade(r.final, 2)}</div><div class="small muted">de ${fmtGrade(s.grade_scale, 0)} posibles</div></div>
      <div class="stat"><div class="label">Promedio en lo evaluado</div><div class="value">${fmtGrade(r.average, 2)}</div><div class="small muted">aprueba con ${fmtGrade(s.pass_grade)}</div></div>
      <div class="stat"><div class="label">Semestre evaluado</div><div class="value">${fmtPct(r.evaluatedPct)}</div><div class="progress" aria-hidden="true"><span style="width:${r.evaluatedPct}%"></span></div></div>
    </div>
    <div class="stack">${b.cortes.map((c) => {
      const cr = r.cortes.find((x) => x.number === c.number);
      return html`<section class="card corte" aria-labelledby="c${c.number}">
        <div class="corte-head"><h2 id="c${c.number}">Corte ${c.number} <span class="badge badge-primary">${fmtPct(c.weight)}</span></h2>
          <span>Nota del corte: <strong class="grade ${gradeClass(cr.grade, s.pass_grade)}">${fmtGrade(cr.grade, 2)}</strong> <span class="small muted">(${fmtPct(cr.evaluatedPct)} evaluado)</span></span></div>
        ${COMPONENTS.map((comp) => {
          const list = b.activities.filter((a) => a.corte_id === c.id && a.component === comp);
          return html`<div class="comp">
            <div class="comp-head"><h3>${COMPONENT_LABEL[comp]} <span class="badge badge-muted">${fmtPct(c[`${comp}_weight`])} del corte</span></h3>
              ${cr[comp]?.grade != null && list.length ? html`<span class="small">Promedio: <strong class="grade">${fmtGrade(cr[comp].grade, 2)}</strong></span>` : ''}</div>
            ${list.length === 0 ? html`<p class="comp-empty">Tu docente aún no ha publicado esta actividad.</p>` : list.map((a) => {
              const res = r.items[a.id];
              const sub = subMap[a.id];
              return html`<div class="act">
                <div><a class="act-title" href="#/actividad/${a.id}">${a.title}</a>
                  <div class="act-meta"><span>${icon('clock')} ${fmtDateTime(a.due_at)} · ${relTime(a.due_at)}</span><span>Vale ${fmtPct(eff[a.id]?.inSemester ?? 0)} de la nota final</span></div></div>
                <div>${res?.counts && res.grade != null ? html`<span class="grade ${gradeClass(res.grade, s.pass_grade)}">${fmtGrade(res.grade)}</span>` : sub ? statusBadge(sub.status) : statusBadge(res?.state || 'pendiente')}</div>
              </div>`;
            })}
          </div>`;
        })}
      </section>`;
    })}</div>`);
}

// ═════════════════════════════════════════════════════════════════════
export async function activity(ctx) {
  const { app } = ctx;
  const [activityId] = ctx.params;
  loading(app, 'Actividad');
  const a = await api.getActivity(activityId);
  if (!ctx.isCurrent()) return;
  if (!a) { render(app, emptyState('Actividad no disponible', 'Aún no está publicada, ya no existe o no estás inscrito en la asignatura.', html`<a class="btn btn-primary" href="#/">Volver al inicio</a>`)); return; }
  const b = await api.getSubjectBundle(a.subject_id, 'estudiante');
  if (!ctx.isCurrent()) return;
  const s = b.subject;
  const corte = b.cortes.find((c) => c.id === a.corte_id);
  const sub = b.submissions.find((x) => x.activity_id === a.id);
  const now = new Date();
  const overdue = new Date(a.due_at) <= now;
  const used = sub?.submission_count || 0;
  const remaining = a.max_submissions - used;
  const canSubmit = (!overdue || a.allow_late) && remaining > 0;
  const eff = effectiveWeights(b.cortes, b.activities)[a.id];
  const hoursLeft = (new Date(a.due_at) - now) / 3600e3;

  const submitBlock = () => {
    if (!canSubmit) {
      return html`<div class="callout ${sub ? '' : 'danger'}">${icon(sub ? 'check' : 'alert')}<p>${remaining <= 0 ? 'Ya usaste todos los envíos permitidos.' : 'La fecha límite pasó y esta actividad no admite entregas tardías.'}</p></div>`;
    }
    return html`
      <form class="card" id="submit-form" novalidate>
        <h2>${sub ? 'Enviar una nueva versión' : 'Tu entrega'}</h2>
        <p class="small muted">${remaining} envío(s) disponible(s).${sub ? ' Un nuevo envío reemplaza al anterior y se evalúa de nuevo.' : ''}${overdue ? ' La entrega quedará marcada como tardía.' : ''}</p>
        ${a.accept_text ? html`<label class="field"><span>Respuesta escrita${a.accept_files ? html` <span class="hint">(opcional si adjuntas archivo)</span>` : ''}</span>
          <textarea name="text" rows="10" maxlength="50000" placeholder="Escribe tu respuesta. Puedes pegar código.">${''}</textarea></label>` : ''}
        ${a.accept_files ? html`<div class="field"><label for="file">Archivo <span class="hint">(PDF, imagen, Word .docx, texto, código o .zip — máx. 10 MB)</span></label>
          <input id="file" type="file" name="file" accept="${api.ACCEPT_ATTR}"></div>` : ''}
        <p class="inline-error" role="alert" hidden></p>
        <button class="btn btn-primary" type="submit">${icon('upload')} Enviar entrega</button>
      </form>`;
  };

  const statusBlock = () => {
    if (!sub) return '';
    if (sub.status === 'evaluada') {
      return html`<section class="card" aria-labelledby="fb-h"><h2 id="fb-h">${icon('sparkle')} Resultado y retroalimentación</h2>
        ${feedbackView(sub.feedback, { grade: sub.grade, scale: s.grade_scale, pass: s.pass_grade, teacherComment: sub.teacher_comment })}
        <p class="small muted" style="margin-top:16px">Fecha de calificación: ${fmtDateTime(sub.graded_at)} · Si tienes dudas sobre la evaluación, consúltalas con tu docente.</p></section>`;
    }
    const txt = sub.status === 'en_revision'
      ? 'Tu docente está revisando esta entrega. Verás la nota y la retroalimentación cuando la apruebe.'
      : 'Recibimos tu entrega. El agente la evaluará en los próximos minutos y te avisaremos por correo.';
    return html`<div class="callout">${icon(sub.status === 'en_revision' ? 'eye' : 'clock')}<p>${txt}</p></div>`;
  };

  render(app, html`
    <nav class="crumbs" aria-label="Ruta"><a href="#/">Inicio</a> / <a href="#/asignatura/${s.id}">${s.name}</a></nav>
    <div class="page-head"><div>
      <h1>${a.title}</h1>
      <div class="row"><span class="badge badge-primary">${COMPONENT_LABEL[a.component]} · Corte ${corte.number}</span>
        <span class="badge ${overdue ? 'badge-muted' : hoursLeft < 24 ? 'badge-danger' : 'badge-ok'}">${icon('clock')} ${overdue ? 'Cerró' : 'Cierra'} ${relTime(a.due_at)}</span>
        <span class="small muted">Vale ${fmtPct(eff?.inSemester ?? 0)} de la nota final</span></div>
    </div></div>
    <div class="two-col">
      <div class="stack">
        ${statusBlock()}
        ${sub && (sub.content_text || sub.file_path) ? html`<details class="card"><summary><strong>Ver lo que enviaste</strong> <span class="small muted">· ${fmtDateTime(sub.submitted_at)}${sub.is_late ? ' · tardía' : ''}</span></summary><br>
          ${sub.content_text ? html`<pre class="submission-text">${sub.content_text}</pre>` : ''}
          ${sub.file_path ? html`<p><button class="btn btn-secondary btn-sm" type="button" data-file="entregas|${sub.file_path}|${sub.file_name}">${icon('file')} ${sub.file_name} ${sub.file_size ? `(${fileSize(sub.file_size)})` : ''}</button></p>` : ''}
        </details>` : ''}
        ${submitBlock()}
      </div>
      <aside class="card">
        <h2>Instrucciones</h2>
        <p class="small"><strong>Fecha límite:</strong> ${fmtDateTime(a.due_at)}</p>
        <p class="prose">${a.instructions}</p>
        ${a.statement_path ? html`<button class="btn btn-secondary btn-sm" type="button" data-file="materiales|${a.statement_path}|${a.statement_name}">${icon('file')} ${a.statement_name}</button>` : ''}
        ${a.rubric ? html`<h3 style="margin-top:16px">Cómo se evalúa</h3><p class="prose">${a.rubric}</p>` : ''}
      </aside>
    </div>`);

  const onClick = async (e) => {
    const f = e.target.closest('[data-file]');
    if (!f) return;
    const [bucket, path, name] = f.dataset.file.split('|');
    await withBusy(f, async () => window.open(await api.fileUrl(bucket, path, name), '_blank', 'noopener'));
  };
  app.addEventListener('click', onClick);

  const form = $('#submit-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.inline-error'); err.hidden = true;
    const text = form.text?.value.trim() || '';
    const file = form.file?.files[0];
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (!text && !file) return fail('Escribe tu respuesta o adjunta un archivo.');
    const fe = api.validateFile(file); if (fe) return fail(fe);
    await withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        await api.submitActivity(a, { text, file, previousPath: sub?.file_path });
        toast('Entrega enviada. El agente la evaluará en breve.', 'success');
        ctx.rerender();
      } catch (x) { fail(x.message); }
    });
  });

  const waiting = sub && sub.status === 'en_proceso';
  const timer = waiting ? setInterval(() => ctx.rerender(), 60000) : null;
  return () => { app.removeEventListener('click', onClick); if (timer) clearInterval(timer); };
}
