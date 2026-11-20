// Utilidades de interfaz: plantillas con escape automático, diálogos, avisos y formatos.

class Raw { constructor(s) { this.s = String(s); } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtVal = (v) => (v == null || v === false ? '' : Array.isArray(v) ? v.map(fmtVal).join('') : v instanceof Raw ? v.s : esc(v));
/** Plantilla segura: todo valor interpolado se escapa salvo que venga envuelto en raw()/html``. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += fmtVal(vals[i]); });
  return new Raw(out);
}
// Único punto de inserción de HTML: solo recibe plantillas html``, que escapan todo valor interpolado.
export const render = (el, tpl) => { el.innerHTML = String(tpl); };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── Iconos (SVG en línea, decorativos) ────────────────────────────────
const P = {
  plus: 'M12 5v14M5 12h14',
  book: 'M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5zM6 19h12',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  logout: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
  file: 'M14 3H6v18h12V7l-4-4zM14 3v4h4',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  back: 'M15 18l-6-6 6-6',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  key: 'M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7z',
};
export const icon = (name, cls = '') => raw(`<svg class="i ${cls}" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="${P[name] || ''}"/></svg>`);

// ── Formatos ──────────────────────────────────────────────────────────
const dtf = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const df = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDateTime = (d) => (d ? dtf.format(new Date(d)) : '—');
export const fmtDate = (d) => (d ? df.format(new Date(d)) : '—');
export const fmtGrade = (g, decimals = 1) => (g == null || Number.isNaN(Number(g)) ? '—' : Number(g).toLocaleString('es-CO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
export const fmtPct = (p) => `${Number(p ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
export function relTime(d, now = new Date()) {
  const diff = new Date(d) - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  if (abs < 3600e3) return rtf.format(Math.round(diff / 60e3), 'minute');
  if (abs < 48 * 3600e3) return rtf.format(Math.round(diff / 3600e3), 'hour');
  return rtf.format(Math.round(diff / 86400e3), 'day');
}
/** Valor para <input type="datetime-local"> en hora local. */
export function toLocalInput(d) {
  if (!d) return '';
  const x = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
export const fileSize = (b) => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
export function currentSemester(d = new Date()) { return `${d.getFullYear()}-${d.getMonth() < 6 ? 1 : 2}`; }
export const gradeClass = (g, pass) => (g == null ? '' : Number(g) >= Number(pass) ? 'ok' : 'low');

// ── Avisos (toast) accesibles ─────────────────────────────────────────
export function toast(message, type = 'info', ms = 4500) {
  const region = document.getElementById('toasts');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  region.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

// ── Diálogos con <dialog> (foco atrapado y Esc nativos) ───────────────
let dialogSeq = 0;
/**
 * Abre un modal. `body` es una plantilla html``. `onSubmit(form, dialog)` puede devolver false para no cerrar.
 * Devuelve una promesa que resuelve con el valor de cierre.
 */
export function openModal({ title, body, submitLabel = 'Guardar', cancelLabel = 'Cancelar', danger = false, wide = false, onSubmit, onOpen, hideSubmit = false }) {
  return new Promise((resolve) => {
    const id = `dlg-${++dialogSeq}`;
    const dlg = document.createElement('dialog');
    dlg.className = `modal${wide ? ' modal-wide' : ''}`;
    dlg.setAttribute('aria-labelledby', `${id}-t`);
    render(dlg, html`
      <form method="dialog" class="modal-form" novalidate>
        <div class="modal-head">
          <h2 id="${id}-t">${title}</h2>
          <button type="button" class="btn-icon" data-close aria-label="Cerrar">${icon('x')}</button>
        </div>
        <div class="modal-body">${body}</div>
        <p class="form-error" role="alert" hidden></p>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>${cancelLabel}</button>
          ${hideSubmit ? '' : html`<button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${submitLabel}</button>`}
        </div>
      </form>`);
    document.body.append(dlg);
    const form = dlg.querySelector('form');
    const errBox = dlg.querySelector('.form-error');
    let result;
    const close = (v) => { result = v; dlg.close(); };
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(undefined); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSubmit) return close(true);
      const btn = form.querySelector('[type=submit]');
      errBox.hidden = true;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      btn.disabled = true; btn.classList.add('loading');
      try {
        const v = await onSubmit(form, dlg);
        if (v !== false) close(v ?? true);
      } catch (err) {
        errBox.textContent = err.message || String(err);
        errBox.hidden = false;
      } finally {
        btn.disabled = false; btn.classList.remove('loading');
      }
    });
    dlg.showModal();
    onOpen?.(dlg, close);
    const first = dlg.querySelector('.modal-body input:not([type=hidden]):not([disabled]), .modal-body textarea, .modal-body select');
    first?.focus();
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = true }) {
  return openModal({ title, body: html`<p>${message}</p>`, submitLabel: confirmLabel, danger }).then((v) => v === true);
}

export async function withBusy(btn, fn) {
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try { return await fn(); } catch (e) { toast(e.message || String(e), 'error'); return undefined; } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

export const formData = (form) => Object.fromEntries(new FormData(form).entries());

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copiado al portapapeles.', 'success', 2500); } catch { toast('No se pudo copiar. Selecciona y copia manualmente.', 'error'); }
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export const emptyState = (title, text, action = '') => html`
  <div class="empty">
    <div class="empty-art" aria-hidden="true">${icon('sparkle')}</div>
    <h3>${title}</h3><p>${text}</p>${action}
  </div>`;

export const skeleton = (n = 3) => html`<div class="skeleton-list" aria-busy="true" aria-label="Cargando">${Array.from({ length: n }, () => raw('<div class="skeleton"></div>'))}</div>`;

export const statusBadge = (state) => {
  const map = {
    calificada: ['ok', 'Calificada'], evaluada: ['ok', 'Calificada'],
    provisional: ['warn', 'Por revisar'], en_revision: ['warn', 'En revisión docente'], revision: ['warn', 'Por revisar'],
    en_proceso: ['info', 'Evaluando…'], pendiente_eval: ['info', 'En cola'], evaluando: ['info', 'Evaluando…'],
    error: ['danger', 'Error de evaluación'], sin_entrega: ['danger', 'Sin entrega'], pendiente: ['muted', 'Pendiente'],
  };
  const [cls, label] = map[state] || ['muted', state];
  return html`<span class="badge badge-${cls}">${label}</span>`;
};
