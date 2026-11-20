// Presentación de la retroalimentación del agente (formato ai_feedback v1).
import { html, icon, fmtGrade, gradeClass } from '../ui.js';

const SEV = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

export function feedbackView(fb, { grade, scale = 5, pass = 3, teacherComment, teacherView = false } = {}) {
  if (!fb && grade == null && !teacherComment) return '';
  const f = fb || {};
  const criterios = arr(f.criterios);
  const errores = arr(f.errores);
  return html`
    <div class="fb">
      ${grade != null ? html`
        <div class="fb-score">
          <div><div class="grade-big ${gradeClass(grade, pass)}">${fmtGrade(grade)} <small>/ ${fmtGrade(scale, 0)}</small></div></div>
          ${f.resumen ? html`<p class="prose" style="flex:1;min-width:220px;margin:0">${f.resumen}</p>` : ''}
        </div>` : f.resumen ? html`<p class="prose">${f.resumen}</p>` : ''}
      ${teacherComment ? html`<div class="callout">${icon('edit')}<div><strong>Comentario del docente</strong><p class="prose">${teacherComment}</p></div></div>` : ''}
      ${teacherView && (arr(f.alertas).length || f.motivo_revision) ? html`
        <div class="callout warn">${icon('alert')}<div>
          <strong>Para tu revisión</strong>
          ${f.motivo_revision ? html`<p>${f.motivo_revision}</p>` : ''}
          ${arr(f.alertas).length ? html`<ul>${arr(f.alertas).map((a) => html`<li>${a}</li>`)}</ul>` : ''}
        </div></div>` : ''}
      ${criterios.length ? html`
        <section aria-label="Criterios de evaluación">
          <h4>${icon('chart')} Criterios</h4>
          ${criterios.map((c) => html`
            <div class="crit">
              <div class="crit-top"><span>${c.nombre} <span class="muted small">(${Math.round(Number(c.peso) || 0)} %)</span></span><span class="grade">${Math.round(Number(c.puntaje) || 0)}/100</span></div>
              <div class="progress" role="img" aria-label="${Math.round(Number(c.puntaje) || 0)} de 100"><span style="width:${Math.max(0, Math.min(100, Number(c.puntaje) || 0))}%"></span></div>
              ${c.comentario ? html`<div>${c.comentario}</div>` : ''}
              ${c.evidencia ? html`<div class="ev"><strong>Evidencia:</strong> ${c.evidencia}</div>` : ''}
            </div>`)}
        </section>` : ''}
      ${errores.length ? html`
        <section aria-label="Errores encontrados">
          <h4>${icon('alert')} Qué corregir</h4>
          <div class="stack" style="gap:8px">
            ${errores.map((e) => html`
              <div class="err-item sev-${e.severidad || 'media'}">
                <strong>${e.descripcion}</strong> <span class="badge badge-muted">Severidad ${SEV[e.severidad] || 'media'}</span>
                ${e.evidencia ? html`<p><span class="muted">Dónde:</span> ${e.evidencia}</p>` : ''}
                ${e.como_corregir ? html`<p><span class="muted">Cómo corregirlo:</span> ${e.como_corregir}</p>` : ''}
              </div>`)}
          </div>
        </section>` : ''}
      ${arr(f.aciertos).length ? html`<section aria-label="Aciertos"><h4>${icon('check')} Lo que está correcto</h4><ul>${arr(f.aciertos).map((a) => html`<li>${a}</li>`)}</ul></section>` : ''}
      ${arr(f.recomendaciones).length ? html`<section aria-label="Recomendaciones"><h4>${icon('sparkle')} Siguientes pasos</h4><ul>${arr(f.recomendaciones).map((a) => html`<li>${a}</li>`)}</ul></section>` : ''}
      ${teacherView && f.modelo ? html`<p class="small muted">Evaluado por ${f.modelo}${f.confianza != null ? ` · confianza ${Math.round(f.confianza * 100)} %` : ''}${f.entrega_tardia ? ' · entrega tardía' : ''}</p>` : ''}
    </div>`;
}
