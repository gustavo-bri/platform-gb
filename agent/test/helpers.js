// Utilidades de prueba: fetch simulado, base de datos simulada, zip en memoria y configuración base.
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const fixture = (name) => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name));

export const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** fetch simulado: `handler(url, init, n)` devuelve un Response; se registran todas las llamadas. */
export function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    return handler(String(url), init, calls.length);
  };
  fn.calls = calls;
  return fn;
}

/** Base de datos simulada: rpc(fn) delega en handlers[fn]; download(bucket, path) en files[`${bucket}/${path}`]. */
export function fakeDb(handlers = {}, files = {}) {
  const calls = [];
  return {
    calls,
    callsTo: (fn) => calls.filter((c) => c.fn === fn),
    async rpc(fn, args) {
      calls.push({ fn, args });
      const h = handlers[fn];
      if (!(fn in handlers)) throw new Error(`RPC no simulada: ${fn}`);
      return typeof h === 'function' ? h(args, calls) : h;
    },
    async download(bucket, p) {
      const f = files[`${bucket}/${p}`];
      if (!f) throw new Error(`No se pudo descargar ${bucket}/${p} (HTTP 404)`);
      return f;
    },
  };
}

/** ZIP en memoria (métodos 0 y 8) para pruebas de límites. */
export function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, store = false, declaredSize } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const comp = store ? raw : zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6);
    lh.writeUInt16LE(store ? 0 : 8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(declaredSize ?? raw.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8);
    ch.writeUInt16LE(store ? 0 : 8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(declaredSize ?? raw.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

export const baseConfig = (over = {}) => ({
  supabaseUrl: 'https://x.supabase.co', serviceKey: 'svc', geminiKey: 'g', geminiModels: ['m1', 'm2'],
  groqKey: '', groqModel: 'gq', providers: ['gemini'], gmailUser: 'profe@gmail.com', gmailPass: 'p', mailEnabled: true,
  mailFromName: 'Plataforma Docente IA', appUrl: 'https://app.example/', timezone: 'America/Bogota',
  emailDailyBudget: 450, maxEvaluationsPerRun: 20, evalConcurrency: 2, runBudgetMs: 480000, dryRun: false, minConfidence: 0.6,
  ...over,
});

export const noSleep = async () => {};
export const silentLog = () => {};

/** Respuesta del modelo válida (antes de normalizar). */
export const modelOutput = (over = {}) => ({
  resumen: 'La definición es incompleta: falta el ejemplo pedido.',
  criterios: [
    { nombre: 'Corrección', peso: 60, puntaje: 70, evidencia: '"una variable guarda un valor"', comentario: 'Correcta pero imprecisa.' },
    { nombre: 'Completitud', peso: 40, puntaje: 40, evidencia: 'no hay ejemplo', comentario: 'Falta el ejemplo.' },
  ],
  aciertos: ['Relaciona variable con valor almacenado (línea 1).'],
  errores: [{ descripcion: 'Falta ejemplo', evidencia: 'toda la respuesta', como_corregir: 'Añade int x = 3;', severidad: 'media' }],
  recomendaciones: ['Repasa tipos de datos.'],
  confianza: 0.9,
  requiere_revision: false,
  motivo_revision: null,
  alertas: [],
  ...over,
});

export const claimCtx = (over = {}) => ({
  submission: { id: 'sub-1', submission_count: 1, content_text: 'Una variable guarda un valor.', file_path: null, file_name: null, file_mime: null, file_size: null, is_late: false, submitted_at: '2026-11-18T10:00:00Z', eval_attempts: 1, ...(over.submission ?? {}) },
  activity: { id: 'act-1', title: 'Quiz 1 - Variables', component: 'quiz', instructions: 'Explique qué es una variable con un ejemplo.', rubric: null, statement_path: null, statement_name: null, due_at: '2026-11-19T10:00:00Z', ...(over.activity ?? {}) },
  key: { reference_solution: 'Espacio de memoria con nombre; ej. int x = 3;', reference_path: null, reference_name: null, grading_notes: 'Exigir ejemplo.', ...(over.key ?? {}) },
  subject: { id: 'subj-1', name: 'Programación I', grade_scale: 5, pass_grade: 3, auto_publish: true, ...(over.subject ?? {}) },
  corte: 1,
});
