// Arranque, sesión, barra superior y enrutador por hash.
import { sb, getProfile, updateProfile } from './api.js';
import { html, render, icon, toast, initials, esc, $ } from './ui.js';
import { loginView } from './views/login.js';
import * as teacher from './views/teacher.js';
import * as student from './views/student.js';

const app = document.getElementById('app');
const topbar = document.getElementById('topbar');
const APP_NAME = globalThis.APP_CONFIG?.appName || 'Plataforma Educativa GB';
let profile = null;
let cleanup = null;
let routeSeq = 0;

const ROUTES = [
  [/^\/?$/, (c) => (c.profile.role === 'docente' ? teacher.home(c) : student.home(c))],
  [/^\/unirse\/([A-Za-z0-9]{4,12})$/, (c) => student.join(c)],
  [/^\/asignatura\/([0-9a-f-]{36})(?:\/(actividades|estudiantes|notas|ajustes))?$/, (c) => (c.profile.role === 'docente' ? teacher.subject(c) : student.subject(c))],
  [/^\/actividad\/([0-9a-f-]{36})$/, (c) => (c.profile.role === 'docente' ? teacher.activity(c) : student.activity(c))],
];

export const navigate = (path) => { location.hash = `#${path}`; };

async function route() {
  const seq = ++routeSeq;
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignorar */ } }
  cleanup = null;
  const path = decodeURIComponent(location.hash.replace(/^#/, '') || '/');
  const match = ROUTES.map(([re, fn]) => [path.match(re), fn]).find(([m]) => m);
  const ctx = {
    app, profile, navigate, params: match ? match[0].slice(1) : [],
    isCurrent: () => seq === routeSeq,
    rerender: () => route(),
  };
  window.scrollTo(0, 0);
  if (!match) {
    render(app, html`<div class="empty"><h2>Página no encontrada</h2><p>La dirección no existe o cambió.</p><a class="btn btn-primary" href="#/">Ir al inicio</a></div>`);
    return;
  }
  try {
    const r = await match[1](ctx);
    if (seq === routeSeq) cleanup = r;
    else if (typeof r === 'function') r();
  } catch (e) {
    console.error(e);
    if (seq !== routeSeq) return;
    render(app, html`<div class="empty"><div class="empty-art" aria-hidden="true">${icon('alert')}</div><h2>No se pudo cargar</h2><p>${e.message}</p>
      <button class="btn btn-primary" type="button" id="retry">${icon('refresh')} Reintentar</button></div>`);
    $('#retry')?.addEventListener('click', () => route());
  }
  if (seq === routeSeq) {
    const h1 = app.querySelector('h1');
    document.title = h1 ? `${h1.textContent.trim()} · ${APP_NAME}` : APP_NAME;
  }
}

function currentTheme() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function renderTopbar() {
  const dark = currentTheme() === 'dark';
  topbar.hidden = false;
  render(topbar, html`
    <a class="brand" href="#/" aria-label="${APP_NAME}: inicio"><span class="brand-mark" aria-hidden="true">GB</span><span>${APP_NAME}</span></a>
    <span class="spacer"></span>
    <button class="btn-icon" type="button" id="theme-btn" aria-label="${dark ? 'Usar tema claro' : 'Usar tema oscuro'}">${icon(dark ? 'sun' : 'moon')}</button>
    <button class="user-chip" type="button" id="user-btn" aria-haspopup="true" aria-expanded="false" aria-controls="user-menu">
      <span class="avatar">${profile.avatar_url ? html`<img src="${profile.avatar_url}" alt="" width="34" height="34" referrerpolicy="no-referrer">` : initials(profile.full_name)}</span>
      <span class="name">${profile.full_name}</span>
      <span class="badge ${profile.role === 'docente' ? 'badge-primary' : 'badge-muted'} role">${profile.role === 'docente' ? 'Docente' : 'Estudiante'}</span>
    </button>
    <div class="menu" id="user-menu" hidden>
      <div class="menu-head"><strong>${profile.full_name}</strong><div class="small muted">${profile.email}</div></div>
      <label class="menu-item"><input type="checkbox" id="notif-toggle" ${profile.email_notifications ? 'checked' : ''}> ${icon('mail')} Avisos por correo</label>
      <button type="button" id="logout-btn">${icon('logout')} Cerrar sesión</button>
    </div>`);
  const menu = $('#user-menu');
  const userBtn = $('#user-btn');
  const toggleMenu = (open) => { menu.hidden = !open; userBtn.setAttribute('aria-expanded', String(open)); };
  userBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(menu.hidden); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) toggleMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { toggleMenu(false); userBtn.focus(); } });
  $('#theme-btn').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('aula.theme', next); } catch { /* sin almacenamiento */ }
    renderTopbar();
  });
  $('#logout-btn').addEventListener('click', async () => {
    if (globalThis.__DEMO__) { location.href = './'; return; } // en la demo, salir lleva a la plataforma real
    await sb.auth.signOut(); location.hash = '#/'; location.reload();
  });
  $('#notif-toggle').addEventListener('change', async (e) => {
    try {
      await updateProfile({ email_notifications: e.target.checked });
      profile.email_notifications = e.target.checked;
      toast(e.target.checked ? 'Recibirás avisos en tu correo de Google.' : 'Avisos por correo desactivados.', 'success');
    } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
  });
}

function showLogin(error) {
  topbar.hidden = true;
  loginView(app, {
    error,
    onLogin: () => {
      const target = location.hash && location.hash !== '#/' ? location.hash : '';
      try { if (target) sessionStorage.setItem('aula.after', target); } catch { /* ignorar */ }
      sb.auth.signInWithGoogle(location.origin + location.pathname);
    },
  });
}

async function loadProfile() {
  for (let i = 0; i < 3; i++) {
    const p = await getProfile();
    if (p) return p;
    await new Promise((r) => setTimeout(r, 800)); // el perfil lo crea un disparador justo después del registro
  }
  throw new Error('No se encontró tu perfil. Cierra sesión y vuelve a entrar.');
}

async function boot() {
  const cfg = globalThis.APP_CONFIG || {};
  if (!globalThis.__SB_OVERRIDE__ && (!cfg.supabaseUrl || /TU-PROYECTO/.test(cfg.supabaseUrl))) {
    render(app, html`<div class="empty"><h1>Falta configurar la plataforma</h1><p>Edita <code>web/config.js</code> con la URL y la clave pública (anon) de tu proyecto Supabase. Consulta el README.</p></div>`);
    return;
  }
  const redirect = sb.auth.handleRedirect();
  if (redirect?.error) { history.replaceState(null, '', location.pathname); return showLogin(redirect.error); }
  if (redirect?.ok) {
    let after = '#/';
    try { after = sessionStorage.getItem('aula.after') || '#/'; sessionStorage.removeItem('aula.after'); } catch { /* ignorar */ }
    history.replaceState(null, '', location.pathname + after);
  }
  if (!sb.auth.session) return showLogin();
  try {
    await sb.auth.getUser();
    profile = await loadProfile();
  } catch (e) {
    if (e.status === 401 || e.status === 403) { await sb.auth.signOut(); return showLogin('Tu sesión expiró. Vuelve a ingresar.'); }
    render(app, html`<div class="empty"><h1>No pudimos iniciar</h1><p>${esc(e.message)}</p><button class="btn btn-primary" type="button" onclick="location.reload()">Reintentar</button></div>`);
    return;
  }
  renderTopbar();
  addEventListener('hashchange', route);
  route();
}

boot();
