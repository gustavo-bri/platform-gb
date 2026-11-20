// Cliente mínimo de Supabase (Auth con Google, PostgREST, RPC y Storage) sin dependencias.
// Decisión: evitar un CDN en tiempo de ejecución y poder probar todo localmente.

const SESSION_KEY = 'aula.session';

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Traduce errores técnicos frecuentes a mensajes útiles. */
export function friendlyMessage(raw = '', code = '') {
  const m = String(raw);
  if (code === 'P0001') return m; // mensajes propios de las RPC (ya en español)
  if (/activities_single_component_idx/.test(m)) return 'Este corte ya tiene esa actividad. Parcial y proyecto son únicos por corte.';
  if (/JWT expired|invalid JWT|jwt/i.test(m)) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  if (/permission denied|row-level security/i.test(m)) return 'No tienes permiso para realizar esta acción.';
  if (/violates check constraint/i.test(m)) return 'Algún dato no es válido. Revisa fechas, pesos y longitudes.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
  if (/Payload too large|exceeded the maximum allowed size/i.test(m)) return 'El archivo supera el tamaño máximo (10 MB).';
  return m || 'Ocurrió un error inesperado.';
}

export function createClient(url, anonKey, { storage = globalThis.localStorage, fetchImpl, location = globalThis.location } = {}) {
  const base = String(url).replace(/\/+$/, '');
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  let session = null;
  let refreshing = null;
  const listeners = new Set();

  const readStored = () => { try { return JSON.parse(storage?.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
  session = readStored();
  // Otra pestaña renovó o cerró la sesión: adoptarla (evita reutilizar un refresh token ya rotado).
  globalThis.addEventListener?.('storage', (e) => {
    if (e.key !== SESSION_KEY) return;
    session = readStored();
    listeners.forEach((fn) => fn(session));
  });
  const freshStored = () => {
    const st = readStored();
    return st?.access_token && st.access_token !== session?.access_token && st.expires_at - 60 > Date.now() / 1000 ? st : null;
  };

  const save = (s) => {
    session = s;
    try { s ? storage?.setItem(SESSION_KEY, JSON.stringify(s)) : storage?.removeItem(SESSION_KEY); } catch { /* almacenamiento no disponible */ }
    listeners.forEach((fn) => fn(session));
  };

  async function parse(res) {
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const msg = body?.message || body?.error_description || body?.msg || body?.error || (typeof body === 'string' ? body : res.statusText);
      throw new ApiError(friendlyMessage(msg, body?.code), { status: res.status, code: body?.code, details: body });
    }
    return body;
  }

  async function refresh() {
    const adopted = freshStored();
    if (adopted) { session = adopted; return session; }
    if (!session?.refresh_token) throw new ApiError('Tu sesión expiró. Vuelve a iniciar sesión.', { status: 401 });
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const res = await doFetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: { apikey: anonKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: session.refresh_token }),
          });
          const data = await parse(res);
          save(toSession(data));
          return session;
        } catch (e) {
          const other = freshStored();
          if (other) { session = other; return session; }   // otra pestaña ganó la carrera
          if (e.status === 400 || e.status === 401) save(null);
          throw e;
        } finally {
          refreshing = null;
        }
      })();
    }
    return refreshing;
  }

  function toSession(d) {
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at ? Number(d.expires_at) : Math.floor(Date.now() / 1000) + Number(d.expires_in || 3600),
      user: d.user || session?.user || null,
    };
  }

  async function token() {
    if (!session) return null;
    if (session.expires_at - 60 < Date.now() / 1000) await refresh();
    return session?.access_token || null;
  }

  async function request(path, { method = 'GET', headers = {}, body, raw = false, retry = true } = {}) {
    const t = await token();
    const res = await doFetch(`${base}${path}`, {
      method,
      // La clave pública nueva (sb_publishable_…) no es un JWT: nunca va en Authorization.
      headers: { apikey: anonKey, ...(t ? { Authorization: `Bearer ${t}` } : {}), ...headers },
      body,
    });
    if (res.status === 401 && retry && session?.refresh_token) {
      await refresh();
      return request(path, { method, headers, body, raw, retry: false });
    }
    if (raw) {
      if (!res.ok) await parse(res);
      return res;
    }
    return parse(res);
  }

  const qs = (params = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p.append(k, v);
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  const encPath = (path) => path.split('/').map(encodeURIComponent).join('/');
  const json = (o) => JSON.stringify(o);

  const auth = {
    signInWithGoogle(redirectTo) {
      const u = `${base}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
      location.assign(u);
    },
    /** Procesa el retorno OAuth (#access_token=...). Devuelve {ok} | {error} | null. */
    handleRedirect(hash = location.hash) {
      const h = String(hash || '').replace(/^#/, '');
      if (!/(^|&)(access_token|error)=/.test(h)) return null;
      const p = new URLSearchParams(h);
      if (p.get('error')) return { error: p.get('error_description') || p.get('error') };
      save(toSession({
        access_token: p.get('access_token'),
        refresh_token: p.get('refresh_token'),
        expires_at: p.get('expires_at'),
        expires_in: p.get('expires_in'),
      }));
      return { ok: true };
    },
    get session() { return session; },
    async getUser() {
      if (!session) return null;
      const user = await request('/auth/v1/user');
      save({ ...session, user });
      return user;
    },
    async signOut() {
      try { if (session) await request('/auth/v1/logout', { method: 'POST' }); } catch { /* se cierra localmente igual */ }
      save(null);
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    refresh,
  };

  const db = {
    select: (table, params = {}) => request(`/rest/v1/${table}${qs({ select: '*', ...params })}`),
    async single(table, params = {}) {
      const rows = await db.select(table, { ...params, limit: 1 });
      return rows?.[0] ?? null;
    },
    insert: (table, rows, params = {}) => request(`/rest/v1/${table}${qs(params)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: json(rows),
    }),
    upsert: (table, rows, onConflict) => request(`/rest/v1/${table}${qs({ on_conflict: onConflict })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=merge-duplicates' },
      body: json(rows),
    }),
    update: (table, filters, patch) => request(`/rest/v1/${table}${qs(filters)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: json(patch),
    }),
    remove: (table, filters) => request(`/rest/v1/${table}${qs(filters)}`, { method: 'DELETE' }),
    rpc: (fn, args = {}) => request(`/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json(args),
    }),
  };

  const storageApi = {
    upload: (bucket, path, file) => request(`/storage/v1/object/${bucket}/${encPath(path)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false', 'cache-control': '3600' },
      body: file,
    }),
    async signedUrl(bucket, path, expiresIn = 900, download) {
      const d = await request(`/storage/v1/object/sign/${bucket}/${encPath(path)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json({ expiresIn }),
      });
      const signed = d.signedURL || d.signedUrl;
      const u = `${base}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`;
      return download ? `${u}&download=${encodeURIComponent(download)}` : u;
    },
    list: (bucket, prefix) => request(`/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json({ prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
    }),
    remove: (bucket, paths) => (paths.length ? request(`/storage/v1/object/${bucket}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: json({ prefixes: paths }),
    }) : Promise.resolve([])),
    /** Lista recursivamente todos los archivos bajo un prefijo. */
    async listAll(bucket, prefix) {
      const out = [];
      const walk = async (p) => {
        const items = await storageApi.list(bucket, p);
        for (const it of items || []) {
          const full = p ? `${p}/${it.name}` : it.name;
          if (it.id === null || it.id === undefined) await walk(full); else out.push(full);
        }
      };
      await walk(prefix.replace(/\/+$/, ''));
      return out;
    },
  };

  return { auth, db, storage: storageApi, url: base };
}
