// Plantillas de correo (HTML responsive con estilos inline + versión de texto). Todo el contenido se escapa.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const COMPONENTE = { quiz: 'Quiz', parcial: 'Parcial', proyecto: 'Proyecto' };

export function formatDate(iso, timezone = 'America/Bogota') {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

export const formatGrade = (g, scale) => (g == null ? null : `${Number(g).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} / ${Number(scale).toLocaleString('es-CO')}`);

const firstName = (full) => (String(full ?? '').trim().split(/\s+/)[0] || '');
const greeting = (full) => (firstName(full) ? `Hola, ${firstName(full)}:` : 'Hola:');

export const activityLink = (cfg, activityId) => (cfg.appUrl ? `${cfg.appUrl}#/actividad/${activityId}` : '');
export const subjectLink = (cfg, subjectId) => (cfg.appUrl ? `${cfg.appUrl}#/asignatura/${subjectId}` : '');

function layout({ preheader, title, body, cta, accent = '#4f46e5', appName }) {
  const button = cta?.url
    ? `<tr><td style="padding:8px 24px 24px"><a href="${esc(cta.url)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;font-size:15px">${esc(cta.label || 'Abrir en la plataforma')}</a></td></tr>`
    : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:16px 8px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:${accent};padding:16px 24px;color:#ffffff;font-size:14px;font-weight:600;letter-spacing:.3px">${esc(appName)}</td></tr>
<tr><td style="padding:24px 24px 8px"><h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#111827">${esc(title)}</h1>${body}</td></tr>
${button}
<tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">Recibes este correo porque estás inscrito en la plataforma. Puedes desactivar los avisos por correo en tu perfil.</td></tr>
</table></td></tr></table></body></html>`;
}

const p = (html) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${html}</p>`;
const textFooter = (url) => (url ? `\n\nAbrir en la plataforma: ${url}\n` : '\n');

// ── Recordatorio ───────────────────────────────────────────────────────
const URGENCY = {
  rec72: { tag: '📅 Quedan 3 días', when: 'en menos de 3 días', accent: '#4f46e5' },
  rec24: { tag: '⏰ Quedan 24 h', when: 'en menos de 24 horas', accent: '#d97706' },
  rec3: { tag: '🚨 Últimas 3 horas', when: 'en menos de 3 horas', accent: '#dc2626' },
};

export function reminderEmail(n, cfg) {
  const u = URGENCY[String(n.kind).split(':')[0]] ?? URGENCY.rec24;
  const comp = COMPONENTE[n.component] ?? n.component ?? '';
  const due = formatDate(n.due_at, cfg.timezone);
  const url = activityLink(cfg, n.activity_id);
  const subject = `${u.tag} — ${n.activity_title} · ${n.subject_name}`;
  const body = [
    p(esc(greeting(n.full_name))),
    p(`La actividad <strong>${esc(n.activity_title)}</strong> (${esc(comp)} · corte ${esc(n.corte)}) de <strong>${esc(n.subject_name)}</strong> cierra ${esc(u.when)}.`),
    p(`Fecha límite: <strong>${esc(due)}</strong>.`),
    p('Aún no registramos tu entrega.'),
  ].join('');
  const text = `${greeting(n.full_name)}\n\nLa actividad "${n.activity_title}" (${comp} · corte ${n.corte}) de ${n.subject_name} cierra ${u.when}.\nFecha límite: ${due}.\nAún no registramos tu entrega.${textFooter(url)}`;
  return { subject, html: layout({ preheader: `Cierra ${due}`, title: `${u.tag.replace(/^\S+\s/, '')}: ${n.activity_title}`, body, cta: { url, label: 'Entregar ahora' }, accent: u.accent, appName: cfg.mailFromName }), text };
}

// ── Actividades nuevas (una o varias) ──────────────────────────────────
export function newActivitiesEmail({ full_name, items }, cfg) {
  const one = items.length === 1;
  const first = items[0];
  const subject = one
    ? `📌 Nueva actividad — ${first.activity_title} · ${first.subject_name}`
    : `📌 ${items.length} actividades nuevas en la plataforma`;
  const rows = items.map((n) => {
    const url = activityLink(cfg, n.activity_id);
    const title = url ? `<a href="${esc(url)}" style="color:#4f46e5">${esc(n.activity_title)}</a>` : esc(n.activity_title);
    return `<li style="margin:0 0 8px;font-size:15px;line-height:1.5">${title} — ${esc(n.subject_name)} (${esc(COMPONENTE[n.component] ?? n.component)} · corte ${esc(n.corte)})<br><span style="color:#6b7280">Cierra: ${esc(formatDate(n.due_at, cfg.timezone))}</span></li>`;
  }).join('');
  const body = p(esc(greeting(full_name))) + p(one ? 'Tu docente publicó una actividad nueva:' : 'Tu docente publicó estas actividades:')
    + `<ul style="padding-left:20px;margin:0 0 12px">${rows}</ul>`;
  const text = `${greeting(full_name)}\n\n${one ? 'Tu docente publicó una actividad nueva:' : 'Tu docente publicó estas actividades:'}\n`
    + items.map((n) => `- ${n.activity_title} — ${n.subject_name} (${COMPONENTE[n.component] ?? n.component} · corte ${n.corte}). Cierra: ${formatDate(n.due_at, cfg.timezone)}. ${activityLink(cfg, n.activity_id)}`).join('\n') + '\n';
  const url = one ? activityLink(cfg, first.activity_id) : cfg.appUrl;
  return { subject, html: layout({ preheader: subject, title: one ? first.activity_title : 'Actividades nuevas', body, cta: { url, label: 'Ver en la plataforma' }, appName: cfg.mailFromName }), text };
}

// ── Retroalimentación lista ────────────────────────────────────────────
export function feedbackEmail(n, cfg) {
  const url = activityLink(cfg, n.activity_id);
  const grade = formatGrade(n.grade, n.grade_scale);
  const subject = `✅ Retroalimentación lista — ${n.activity_title} · ${n.subject_name}`;
  const body = [
    p(esc(greeting(n.full_name))),
    p(`Tu entrega de <strong>${esc(n.activity_title)}</strong> (${esc(n.subject_name)}) ya fue evaluada.`),
    grade ? p(`Nota: <strong style="font-size:18px">${esc(grade)}</strong>`) : '',
    n.summary ? `<div style="background:#f9fafb;border-left:4px solid #4f46e5;padding:12px 14px;margin:0 0 12px;font-size:14px;line-height:1.55">${esc(n.summary)}</div>` : '',
    p('En la plataforma encontrarás el detalle por criterio, los errores encontrados y cómo corregirlos.'),
  ].join('');
  const text = `${greeting(n.full_name)}\n\nTu entrega de "${n.activity_title}" (${n.subject_name}) ya fue evaluada.\n${grade ? `Nota: ${grade}\n` : ''}${n.summary ? `\n${n.summary}\n` : ''}\nEn la plataforma encontrarás el detalle por criterio y cómo corregir los errores.${textFooter(url)}`;
  return { subject, html: layout({ preheader: grade ? `Nota: ${grade}` : 'Retroalimentación disponible', title: 'Tu retroalimentación está lista', body, cta: { url, label: 'Ver retroalimentación' }, accent: '#059669', appName: cfg.mailFromName }), text };
}

// ── Resumen diario del docente ─────────────────────────────────────────
export function digestEmail({ full_name, items }, cfg) {
  const list = Array.isArray(items) ? items : [];
  const review = list.filter((i) => i.status === 'revision').length;
  const errors = list.length - review;
  const subject = `📋 ${list.length} entrega(s) requieren tu revisión`;
  const bySubject = new Map();
  for (const i of list) {
    if (!bySubject.has(i.subject_id)) bySubject.set(i.subject_id, { name: i.subject, items: [] });
    bySubject.get(i.subject_id).items.push(i);
  }
  const label = (s) => (s === 'revision' ? 'En revisión' : 'Error de evaluación');
  let html = p(esc(greeting(full_name)))
    + p(`Hay <strong>${review}</strong> entrega(s) esperando tu revisión${errors ? ` y <strong>${errors}</strong> con error de evaluación automática` : ''}.`);
  let text = `${greeting(full_name)}\n\nHay ${review} entrega(s) esperando tu revisión${errors ? ` y ${errors} con error de evaluación automática` : ''}.\n`;
  for (const [sid, g] of bySubject) {
    const url = subjectLink(cfg, sid);
    html += `<h2 style="font-size:16px;margin:16px 0 8px">${url ? `<a href="${esc(url)}" style="color:#4f46e5">${esc(g.name)}</a>` : esc(g.name)}</h2><ul style="padding-left:20px;margin:0 0 8px">`
      + g.items.map((i) => `<li style="font-size:14px;margin:0 0 4px">${esc(i.activity)} — ${esc(i.student || 'Estudiante')} · <em>${esc(label(i.status))}</em></li>`).join('') + '</ul>';
    text += `\n${g.name}${url ? ` (${url})` : ''}\n` + g.items.map((i) => `- ${i.activity} — ${i.student || 'Estudiante'} · ${label(i.status)}`).join('\n') + '\n';
  }
  return { subject, html: layout({ preheader: subject, title: 'Resumen diario de revisión', body: html, cta: { url: cfg.appUrl, label: 'Abrir la plataforma' }, appName: cfg.mailFromName }), text };
}
