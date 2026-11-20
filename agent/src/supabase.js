// Cliente REST mínimo de Supabase con la clave service_role (solo para el agente).

export class SupabaseError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'SupabaseError';
    this.status = status;
    this.body = body;
  }
}

export const STORAGE_BUCKETS = new Set(['entregas', 'materiales']);

/**
 * Valida una ruta de Storage antes de usarla con la clave secreta.
 * Rechaza segmentos vacíos, '.', '..' (también codificados), barras invertidas, '%2f' y caracteres de control.
 */
export function validateStoragePath(bucket, path) {
  if (!STORAGE_BUCKETS.has(bucket)) throw new SupabaseError(`Bucket no permitido: ${bucket}`);
  if (typeof path !== 'string' || !path || path.length > 1024) throw new SupabaseError('Ruta de archivo inválida (vacía o demasiado larga).');
  if (/[\\\u0000-\u001f\u007f]/.test(path) || /%(2f|5c|00)/i.test(path)) {
    throw new SupabaseError('Ruta de archivo inválida (caracteres no permitidos).');
  }
  for (const seg of path.split('/')) {
    const decoded = seg.replace(/%2e/gi, '.');
    if (seg === '' || decoded === '.' || decoded === '..' || /^\.+$/.test(decoded)) {
      throw new SupabaseError('Ruta de archivo inválida (segmentos vacíos, "." o "..").');
    }
  }
  return path;
}

export function createDb({ url, serviceKey, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  const base = url.replace(/\/+$/, '');
  // Claves nuevas (sb_secret_…) van solo en `apikey`; las heredadas (JWT) también en Authorization.
  const headers = { apikey: serviceKey, ...(serviceKey.startsWith('eyJ') ? { Authorization: `Bearer ${serviceKey}` } : {}) };

  async function request(what, url, init) {
    try {
      return await fetchImpl(url, init);
    } catch (err) {
      const cause = err?.cause?.code || err?.cause?.errors?.[0]?.code || err?.cause?.message || err?.message;
      throw new SupabaseError(`No se pudo conectar con Supabase (${what} en ${base}): ${cause}. Revisa SUPABASE_URL y que el proyecto no esté pausado.`);
    }
  }

  async function rpc(fn, args = {}) {
    const res = await request(`RPC ${fn}`, `${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const j = JSON.parse(text);
        detail = [j.message, j.details, j.hint].filter(Boolean).join(' · ') || text;
      } catch { /* cuerpo no JSON */ }
      throw new SupabaseError(`RPC ${fn} falló (HTTP ${res.status}): ${detail.slice(0, 500)}`, { status: res.status, body: text });
    }
    if (!text) return null;
    return JSON.parse(text);
  }

  async function download(bucket, path, { signal } = {}) {
    validateStoragePath(bucket, path);
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const target = `${base}/storage/v1/object/${bucket}/${encoded}`;
    const expectedPrefix = `${new URL(base).pathname.replace(/\/+$/, '')}/storage/v1/object/${bucket}/`;
    if (!new URL(target).pathname.startsWith(expectedPrefix)) {
      throw new SupabaseError('Ruta de archivo inválida (sale del bucket).');
    }
    const timeout = AbortSignal.timeout(Math.max(timeoutMs, 60000));
    const res = await request(`descarga ${bucket}`, target, {
      method: 'GET',
      headers,
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SupabaseError(`No se pudo descargar ${bucket}/${path} (HTTP ${res.status}): ${text.slice(0, 300)}`, {
        status: res.status,
        body: text,
      });
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim() || null;
    return { buffer, mime };
  }

  return { rpc, download };
}
