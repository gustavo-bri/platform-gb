import { html, raw, render, icon } from '../ui.js';

const GOOGLE = '<svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

export function loginView(app, { error, onLogin }) {
  const joining = /#\/unirse\//.test(location.hash);
  render(app, html`
    <section class="login">
      <div class="login-hero">
        <p class="badge badge-primary">${icon('sparkle')} Evaluación asistida por IA</p>
        <h1>Tu aula, con un <span class="hl">evaluador que no duerme</span>.</h1>
        <p class="lead">Crea asignaturas por semestre, organiza quizzes, parciales y proyectos en 3 cortes, y deja que el agente revise cada entrega con retroalimentación objetiva.</p>
        <ul class="features">
          <li>${icon('check')}<span><strong>Retroalimentación precisa</strong>: criterios, evidencias y cómo corregir, sin halagos vacíos.</span></li>
          <li>${icon('mail')}<span><strong>Recordatorios en tu Gmail</strong> antes de cada fecha límite.</span></li>
          <li>${icon('download')}<span><strong>Notas en Excel o CSV</strong> por corte y el historial completo del semestre.</span></li>
        </ul>
      </div>
      <div class="card login-card">
        <h2>${joining ? 'Ingresa para unirte a la asignatura' : 'Ingresar'}</h2>
        <p class="muted">Usa tu cuenta de Google. Las notificaciones llegarán a ese correo.</p>
        ${error ? html`<div class="callout danger" role="alert">${icon('alert')}<p>${error}</p></div><br>` : ''}
        <button class="btn btn-google" type="button" id="google-btn">${raw(GOOGLE)} Continuar con Google</button>
        <p class="legal-links"><a href="privacidad.html">Política de privacidad</a> · <a href="terminos.html">Condiciones del servicio</a></p>
        <p class="small muted login-note">¿Eres estudiante? Entra y escribe el código que te dio tu docente. ¿Eres docente? Tu correo debe estar autorizado por el administrador de la plataforma.</p>
      </div>
    </section>`);
  const btn = document.getElementById('google-btn');
  btn.addEventListener('click', () => { btn.disabled = true; btn.classList.add('loading'); onLogin(); });
}
