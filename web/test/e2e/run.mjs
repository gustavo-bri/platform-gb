// Prueba de punta a punta de la web con backend simulado (Chrome headless).
// Uso: node test/e2e/run.mjs   (desde web/)
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright');
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const shots = join(here, 'screens');
await mkdir(shots, { recursive: true });
const mock = readFileSync(join(here, 'mock-sb.js'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const file = join(root, p === '/' || p === '\\' ? 'index.html' : p);
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end('no'); }
}).listen(0);
const BASE = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true, locale: 'es-CO', timezoneId: 'America/Bogota' });
const errors = [];
let step = 0;
const log = (m) => console.log(`✔ ${++step}. ${m}`);

async function pageAs(user, viewport) {
  const page = await context.newPage();
  if (viewport) await page.setViewportSize(viewport);
  await page.addInitScript(`sessionStorage.setItem('mockuser', ${JSON.stringify(user)});\n${mock}`);
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${user}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${user}] ${e.message}`));
  return page;
}
const noOverflow = async (page, label) => {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw + 1, `${label}: desbordamiento horizontal (${sw} > ${cw})`);
};

try {
  // ── Docente crea asignatura y actividades ───────────────────────────
  const t = await pageAs('u-teacher');
  await t.goto(BASE);
  await t.getByRole('heading', { name: 'Mis asignaturas' }).waitFor();
  await t.getByText('Crea tu primera asignatura').waitFor();
  log('Docente ve estado vacío en "Mis asignaturas"');

  await t.getByRole('button', { name: /Nueva asignatura/ }).click();
  await t.getByLabel('Nombre de la asignatura').fill('Programación I');
  await t.getByLabel(/Código/).fill('PRG101');
  await t.getByRole('dialog').getByRole('button', { name: 'Crear asignatura' }).click();
  await t.getByRole('heading', { name: 'Programación I', level: 1 }).waitFor();
  await t.getByText('K7M2QXA').first().waitFor();
  log('Asignatura creada con 3 cortes y código de inscripción');

  await t.locator('[data-add="quiz"]').first().click();
  await t.getByLabel('Título').fill('Quiz 1 — Variables');
  await t.getByLabel('Enunciado / instrucciones').fill('Explica qué es una variable y da un ejemplo en Python.');
  await t.getByLabel('Respuesta o solución de referencia').fill('Una variable es un nombre que referencia un valor. Ej.: x = 3');
  await t.getByRole('dialog').getByRole('button', { name: 'Crear actividad' }).click();
  await t.getByRole('link', { name: 'Quiz 1 — Variables' }).waitFor();
  log('Quiz creado con solución de referencia privada');

  await t.locator('[data-add="parcial"]').first().click();
  await t.getByLabel('Título').fill('Parcial 1');
  await t.getByLabel('Enunciado / instrucciones').fill('Resuelve los 3 ejercicios.');
  await t.getByRole('dialog').getByRole('button', { name: 'Crear actividad' }).click();
  await t.getByText(/Recomendación: agrega una solución de referencia/).waitFor();
  await t.getByRole('dialog').getByRole('button', { name: 'Crear actividad' }).click();
  await t.getByRole('link', { name: 'Parcial 1' }).waitFor();
  assert.equal(await t.locator('[data-add="parcial"]').count(), 2, 'el corte 1 ya no ofrece crear otro parcial');
  log('Parcial creado (aviso de precisión mostrado) y único por corte');
  await t.screenshot({ path: join(shots, '01-docente-actividades.png'), fullPage: true });

  // ── Estudiante se inscribe con enlace y entrega ─────────────────────
  const s = await pageAs('u-ana');
  await s.goto(`${BASE}#/unirse/K7M2QXA`);
  await s.getByRole('heading', { name: 'Programación I', level: 1 }).waitFor();
  log('Estudiante inscrita con el enlace de invitación');
  await s.getByRole('link', { name: 'Quiz 1 — Variables' }).click();
  await s.getByRole('heading', { name: 'Quiz 1 — Variables' }).waitFor();
  assert.equal(await s.getByText('Una variable es un nombre que referencia').count(), 0, 'la solución de referencia NO aparece al estudiante');
  await s.getByRole('button', { name: /Enviar entrega/ }).click();
  await s.getByText('Escribe tu respuesta o adjunta un archivo.').waitFor();
  await s.getByLabel(/Respuesta escrita/).fill('Una variable guarda datos. x = 3');
  await s.getByRole('button', { name: /Enviar entrega/ }).click();
  await s.getByText(/El agente la evaluará en los próximos minutos/).waitFor();
  log('Validación de entrega vacía y envío correcto');

  // ── Simula al agente ────────────────────────────────────────────────
  await s.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('mockdb'));
    Object.assign(db.submissions[0], {
      status: 'evaluada', ai_grade: 3.8, ai_confidence: 0.9, evaluated_at: new Date().toISOString(), ai_model: 'gemini-flash',
      ai_feedback: {
        version: 1, resumen: 'La definición es correcta pero incompleta: no explica que la variable referencia un valor.',
        criterios: [{ nombre: 'Corrección', peso: 60, puntaje: 80, evidencia: '«Una variable guarda datos»', comentario: 'Definición aproximada.' },
          { nombre: 'Ejemplo', peso: 40, puntaje: 70, evidencia: '«x = 3»', comentario: 'Ejemplo válido sin explicación.' }],
        aciertos: ['El ejemplo x = 3 es sintácticamente válido en Python.'],
        errores: [{ descripcion: 'No se menciona el concepto de referencia', evidencia: 'primera frase', como_corregir: 'Explica que el nombre apunta a un objeto en memoria.', severidad: 'media' }],
        recomendaciones: ['Repasa el modelo de objetos de Python.'], confianza: 0.9, requiere_revision: false, alertas: [], nota: 3.8, escala: 5, modelo: 'gemini-flash',
      },
    });
    localStorage.setItem('mockdb', JSON.stringify(db));
  });
  await s.reload();
  await s.getByText('Qué corregir').waitFor();
  await s.getByText('No se menciona el concepto de referencia').waitFor();
  assert.ok(await s.getByText('3,8').first().isVisible());
  log('Estudiante ve nota 3,8 con criterios, errores y recomendaciones');
  await s.screenshot({ path: join(shots, '02-estudiante-retroalimentacion.png'), fullPage: true });

  // ── Docente revisa y califica ──────────────────────────────────────
  await t.goto(`${BASE}#/`);
  await t.getByRole('link', { name: /Programación I/ }).click();
  await t.getByRole('link', { name: 'Quiz 1 — Variables' }).click();
  await t.getByRole('heading', { name: 'Entregas' }).waitFor();
  await t.getByRole('row', { name: /Ana Pérez/ }).getByRole('button', { name: 'Ver' }).click();
  await t.getByRole('dialog').getByText('Evaluación del agente').waitFor();
  await t.getByLabel(/^Nota \(0 a 5\)/).fill('4.2');
  await t.getByLabel(/Comentario para el estudiante/).fill('Buen ejemplo; completa la definición.');
  await t.getByRole('dialog').getByRole('button', { name: 'Guardar calificación' }).click();
  await t.getByRole('row', { name: /Ana Pérez/ }).getByText('4,2').waitFor();
  log('Docente ajusta la nota de la IA (3,8 → 4,2) con comentario');
  await t.getByRole('row', { name: /Beto Ríos/ }).waitFor({ state: 'detached', timeout: 1000 }).catch(() => {});
  await s.goto(`${BASE}#/`);
  await t.reload();

  // Beto se inscribe para calificación manual
  const beto = await pageAs('u-beto');
  await beto.goto(`${BASE}#/`);
  await beto.getByLabel('Código de inscripción').fill('k7m2qxa');
  await beto.getByRole('button', { name: 'Unirme' }).click();
  await beto.getByRole('heading', { name: 'Programación I', level: 1 }).waitFor();
  log('Segundo estudiante se inscribe escribiendo el código');
  await t.reload();
  await t.getByRole('row', { name: /Beto Ríos/ }).getByRole('button', { name: 'Calificar' }).click();
  await t.getByLabel(/^Nota \(0 a 5\)/).fill('2.5');
  await t.getByRole('dialog').getByRole('button', { name: 'Guardar calificación' }).click();
  await t.getByRole('row', { name: /Beto Ríos/ }).getByText('2,5').waitFor();
  log('Nota manual registrada para un estudiante sin entrega');

  // ── Calificaciones y reportes ──────────────────────────────────────
  await t.getByRole('link', { name: 'Programación I' }).click();
  await t.getByRole('link', { name: /Calificaciones/ }).click();
  await t.getByRole('table').waitFor();
  const [d1] = await Promise.all([t.waitForEvent('download'), t.getByRole('button', { name: /Excel corte 1/ }).click()]);
  const [d2] = await Promise.all([t.waitForEvent('download'), t.getByRole('button', { name: /CSV corte 1/ }).click()]);
  const [d3] = await Promise.all([t.waitForEvent('download'), t.getByRole('button', { name: /Historial completo/ }).click()]);
  const head = readFileSync(await d1.path()).subarray(0, 2).toString();
  assert.equal(head, 'PK');
  assert.match(readFileSync(await d2.path(), 'utf8'), /Ana Pérez;ana@gmail.com;4,2/);
  assert.match(d3.suggestedFilename(), /^HISTORIAL_Programacion_I_2026/);
  log(`Descargas: ${d1.suggestedFilename()}, ${d2.suggestedFilename()}, ${d3.suggestedFilename()}`);
  await t.screenshot({ path: join(shots, '03-docente-calificaciones.png'), fullPage: true });

  // ── Ajustes: ponderaciones y borrado ───────────────────────────────
  await t.getByRole('link', { name: /Ajustes/ }).click();
  await t.locator('#w-1-weight').fill('50');
  await t.getByRole('button', { name: 'Guardar ponderaciones' }).click();
  await t.getByText(/Los 3 cortes deben sumar 100%/).waitFor();
  await t.locator('#w-1-weight').fill('30');
  await t.locator('#w-1-quiz_weight').fill('20');
  await t.locator('#w-1-proyecto_weight').fill('40');
  await t.getByRole('button', { name: 'Guardar ponderaciones' }).click();
  await t.getByText('Ponderaciones guardadas.').waitFor();
  log('Ponderaciones validadas (suma ≠ 100 rechazada) y guardadas');
  await t.getByText(/Historial descargado el/).waitFor();
  await t.getByRole('button', { name: /Borrar asignatura/ }).click();
  await t.getByLabel(/Escribe el nombre de la asignatura/).fill('otra');
  await t.getByRole('dialog').getByRole('button', { name: 'Borrar para siempre' }).click();
  await t.getByText('El nombre no coincide.').waitFor();
  await t.getByLabel(/Escribe el nombre de la asignatura/).fill('programación i');
  await t.getByRole('dialog').getByRole('button', { name: 'Borrar para siempre' }).click();
  await t.getByText('Crea tu primera asignatura').waitFor();
  log('Borrado con confirmación por nombre tras descargar el historial');

  // ── Responsive y tema oscuro ───────────────────────────────────────
  await t.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('mockdb'));
    const sid = '00000000-0000-4000-8000-0000000000d5'; const c = [1, 2, 3].map((n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, subject_id: sid, number: n, weight: n === 3 ? 40 : 30, quiz_weight: 30, parcial_weight: 40, proyecto_weight: 30 }));
    db.subjects.push({ id: sid, teacher_id: 'u-teacher', name: 'Estructuras de Datos', semester: '2026-2', join_code: 'DEMO123', enrollment_open: true, grade_scale: 5, pass_grade: 3, auto_publish: true });
    db.cortes.push(...c);
    db.enrollments.push({ subject_id: sid, student_id: 'u-ana', enrolled_at: new Date().toISOString() });
    const d = (h) => new Date(Date.now() + h * 3600e3).toISOString();
    db.activities.push(
      { id: '00000000-0000-4000-8000-0000000000a1', subject_id: sid, corte_id: '00000000-0000-4000-8000-000000000001', component: 'quiz', title: 'Quiz 1 — Listas enlazadas', instructions: 'Implementa insertar al final.', weight: 1, opens_at: d(-48), due_at: d(20), published: true, max_submissions: 2, accept_text: true, accept_files: true, ai_enabled: true },
      { id: '00000000-0000-4000-8000-0000000000a2', subject_id: sid, corte_id: '00000000-0000-4000-8000-000000000001', component: 'parcial', title: 'Parcial 1', instructions: 'Ejercicios 1 a 3.', weight: 1, opens_at: d(-48), due_at: d(96), published: true, max_submissions: 1, accept_text: true, accept_files: true, ai_enabled: true },
    );
    localStorage.setItem('mockdb', JSON.stringify(db));
  });
  const m = await pageAs('u-ana', { width: 360, height: 780 });
  await m.goto(BASE);
  await m.getByRole('heading', { name: 'Próximas entregas' }).waitFor();
  await noOverflow(m, 'inicio estudiante 360px');
  await m.screenshot({ path: join(shots, '04-movil-estudiante-inicio.png'), fullPage: true });
  await m.getByRole('link', { name: 'Quiz 1 — Listas enlazadas' }).first().click();
  await m.getByRole('button', { name: /Enviar entrega/ }).waitFor();
  await noOverflow(m, 'actividad estudiante 360px');
  await m.screenshot({ path: join(shots, '05-movil-estudiante-actividad.png'), fullPage: true });
  const tm = await pageAs('u-teacher', { width: 360, height: 780 });
  await tm.goto(`${BASE}#/asignatura/00000000-0000-4000-8000-0000000000d5`);
  await tm.getByRole('heading', { name: 'Estructuras de Datos' }).waitFor();
  await noOverflow(tm, 'asignatura docente 360px');
  await tm.getByRole('button', { name: 'Usar tema oscuro' }).click();
  await tm.waitForTimeout(400);
  await tm.screenshot({ path: join(shots, '06-movil-docente-oscuro.png'), fullPage: true });
  await tm.goto(`${BASE}#/asignatura/00000000-0000-4000-8000-0000000000d5/notas`);
  await tm.getByRole('table').waitFor();
  await noOverflow(tm, 'calificaciones docente 360px (la tabla desplaza dentro de su contenedor)');
  log('Sin desbordamiento horizontal a 360 px; tema oscuro aplicado');

  // Teclado: el modal se abre, atrapa el foco y se cierra con Esc
  await t.goto(`${BASE}#/asignatura/00000000-0000-4000-8000-0000000000d5`);
  await t.locator('[data-add="quiz"]').first().focus();
  await t.keyboard.press('Enter');
  await t.getByRole('dialog').waitFor();
  assert.equal(await t.evaluate(() => document.activeElement?.name), 'title', 'el foco inicia en el primer campo');
  await t.keyboard.press('Escape');
  await t.getByRole('dialog').waitFor({ state: 'detached' });
  log('Modal operable con teclado (Enter abre, foco al primer campo, Esc cierra)');

  const relevant = errors.filter((e) => !/favicon|DevTools/.test(e));
  assert.deepEqual(relevant, [], `Errores de consola:\n${relevant.join('\n')}`);
  log('Sin errores ni advertencias en consola');
  console.log(`\nE2E OK — ${step} comprobaciones superadas. Capturas en test/e2e/screens/`);
} catch (e) {
  console.error('\n✘ FALLO E2E:', e.message);
  for (const [i, pg] of context.pages().entries()) { await pg.screenshot({ path: join(shots, `fallo-${i}.png`), fullPage: true }).catch(() => {}); console.error(`pág ${i}: ${pg.url()}`); }
  if (errors.length) console.error('Consola:\n', errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
