// Orquestador de evaluaciones: reclama entregas, las evalúa con concurrencia limitada y guarda el resultado.
import { extractContent, extOf } from './files.js';
import { buildPrompt } from './prompt.js';
import { normalizeEvaluation } from './evaluation.js';
import { validateStoragePath } from './supabase.js';
import { OutOfTimeError } from './llm/common.js';

const MIN_TIME_TO_CLAIM_MS = 90_000;
export const MAX_ITEM_MS = 240_000;      // tiempo máximo por entrega
export const ITEM_RESERVE_MS = 60_000;   // margen que se deja libre antes del deadline de la ejecución

async function fetchFile(db, bucket, filePath, { name, mime, label, signal }) {
  validateStoragePath(bucket, filePath); // nunca descargar rutas con '..', vacías o codificadas
  const { buffer, mime: dlMime } = await db.download(bucket, filePath, { signal });
  return extractContent({ buffer, mime: mime || dlMime, name: name || filePath }, { label });
}

/** Descarga y extrae los archivos de una entrega. Solo la entrega es obligatoria. */
export async function loadFiles(db, ctx, log, { signal } = {}) {
  const { submission: sub = {}, activity = {}, key = {} } = ctx;
  const files = {};
  if (sub.file_path) {
    const ext = extOf(sub.file_name || sub.file_path) || 'bin';
    // Etiqueta neutra: el nombre original del archivo podría contener datos personales.
    files.submission = await fetchFile(db, 'entregas', sub.file_path, { name: sub.file_name, mime: sub.file_mime, label: `entrega.${ext}`, signal });
  }
  const optional = [
    ['statement', activity.statement_path, activity.statement_name, 'enunciado'],
    ['reference', key?.reference_path, key?.reference_name, 'solucion_referencia'],
  ];
  for (const [slot, p, name, base] of optional) {
    if (!p) continue;
    try {
      files[slot] = await fetchFile(db, 'materiales', p, { name, label: `${base}.${extOf(name || p) || 'bin'}`, signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      log('warn', `No se pudo descargar ${base} de la actividad ${activity.id}: ${err.message}`);
    }
  }
  return files;
}

/** Retroalimentación determinista cuando no hay nada legible que evaluar (no gasta cuota de IA). */
function unreadableRaw(prompt) {
  const why = prompt.meta.warnings.join(' ') || 'El archivo no se pudo leer.';
  return {
    resumen: `No fue posible leer el contenido de tu entrega. ${why} El docente revisará la entrega manualmente.`,
    criterios: [{
      nombre: 'Entrega legible', peso: 100, puntaje: 0, evidencia: why,
      comentario: 'Si aún tienes envíos disponibles, vuelve a subirla en PDF, imagen, texto, código, .docx o .zip.',
    }],
    aciertos: [], errores: [], recomendaciones: [],
    confianza: 0, requiere_revision: true, motivo_revision: 'Archivo ilegible o en formato no evaluable.',
    alertas: ['archivo ilegible o en formato no evaluable'],
  };
}

export async function evaluateOne({ db, llm, config, log, ctx, signal, deadline = Infinity }) {
  const sub = ctx.submission;
  const files = await loadFiles(db, ctx, log, { signal });
  const prompt = buildPrompt(ctx, files);
  const hasText = Boolean(sub.content_text && String(sub.content_text).trim());
  const nothingReadable = !hasText && (!files.submission || (files.submission.unreadable && !files.submission.parts.length));

  let raw; let model;
  if (nothingReadable) {
    raw = unreadableRaw(prompt);
    model = 'sin-ia (archivo ilegible)';
  } else {
    ({ json: raw, model } = await llm.generate(prompt, { signal, deadline }));
  }
  if (signal?.aborted) throw new OutOfTimeError();
  const norm = normalizeEvaluation(raw, {
    scale: Number(ctx.subject?.grade_scale ?? 5),
    isLate: Boolean(sub.is_late),
    model,
    minConfidence: config.minConfidence,
    meta: prompt.meta,
  });
  if (signal?.aborted) throw new OutOfTimeError(); // no guardar un resultado que llegó tarde
  const status = await db.rpc('complete_evaluation', {
    p_submission: sub.id,
    p_count: sub.submission_count,
    p_grade: norm.grade,
    p_feedback: norm.feedback,
    p_model: model,
    p_confidence: norm.confidence,
    p_needs_review: norm.needsReview,
  });
  return { status, grade: norm.grade, model, needsReview: norm.needsReview };
}

async function pool(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

/** Ejecuta evaluateOne con un tiempo máximo: aborta descargas y llamadas a la IA al agotarse. */
export async function evaluateWithLimit({ budgetMs, now = () => Date.now(), ...args }) {
  const controller = new AbortController();
  const itemDeadline = now() + budgetMs;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OutOfTimeError());
    }, budgetMs);
  });
  try {
    return await Promise.race([evaluateOne({ ...args, signal: controller.signal, deadline: itemDeadline }), timeout]);
  } catch (err) {
    if (err instanceof OutOfTimeError || controller.signal.aborted) {
      throw new OutOfTimeError(`Tiempo máximo de evaluación agotado (${Math.round(budgetMs / 1000)} s): la IA no respondió a tiempo (posible cuota agotada). Se reintentará en la próxima ejecución.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/**
 * @returns {Promise<{claimed:number, evaluated:number, review:number, stale:number, failed:number}>}
 */
export async function runEvaluations({ db, llm, config, log = () => {}, deadline = Infinity, now = () => Date.now() }) {
  const stats = { claimed: 0, evaluated: 0, review: 0, stale: 0, failed: 0, timedOut: 0 };
  const max = config.maxEvaluationsPerRun;
  const concurrency = config.evalConcurrency;

  while (stats.claimed < max) {
    if (deadline - now() < MIN_TIME_TO_CLAIM_MS) {
      log('info', 'Tiempo de ejecución casi agotado: no se reclaman más entregas.');
      break;
    }
    const limit = Math.min(max - stats.claimed, concurrency * 2);
    const batch = (await db.rpc('claim_submissions', { p_limit: limit })) ?? [];
    if (!batch.length) break;
    stats.claimed += batch.length;

    await pool(batch, concurrency, async (ctx) => {
      const sub = ctx.submission;
      const t0 = now();
      try {
        const remainingRun = deadline - now() - ITEM_RESERVE_MS;
        if (remainingRun < 5_000) throw new OutOfTimeError('No queda tiempo en esta ejecución para evaluar la entrega; se reintentará en la próxima.');
        const budgetMs = Math.min(config.maxItemMs ?? MAX_ITEM_MS, remainingRun);
        const r = await evaluateWithLimit({ db, llm, config, log, ctx, budgetMs, now });
        if (r.status === 'stale') {
          stats.stale++;
          log('info', `Entrega ${sub.id}: el estudiante reenvió durante la evaluación; resultado descartado.`);
        } else {
          stats.evaluated++;
          if (r.status === 'revision') stats.review++;
          log('info', `Entrega ${sub.id}: ${r.status} · nota ${r.grade} · ${r.model} · ${Math.round((now() - t0) / 1000)} s`);
        }
      } catch (err) {
        stats.failed++;
        if (err instanceof OutOfTimeError) stats.timedOut++;
        const msg = String(err?.message ?? err).slice(0, 900);
        log('error', `Entrega ${sub.id} (intento ${sub.eval_attempts ?? '?'}): ${msg}`);
        try {
          await db.rpc('fail_evaluation', { p_submission: sub.id, p_count: sub.submission_count, p_error: msg });
        } catch (e2) {
          log('error', `No se pudo registrar el fallo de ${sub.id}: ${e2.message}`);
        }
      }
    });
    if (batch.length < limit) break; // no hay más pendientes
  }
  return stats;
}
