import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, friendlyMessage } from '../js/sb.js';

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const res = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('sin sesión: clave pública nueva solo en apikey (nunca en Authorization)', async () => {
  const calls = [];
  const sb = createClient('https://p.supabase.co/', 'sb_publishable_x', { storage: memStorage(), fetchImpl: async (u, i) => { calls.push([u, i]); return res([]); } });
  await sb.db.select('subjects', { teacher_id: 'eq.1', order: 'created_at.desc' });
  assert.equal(calls[0][0], 'https://p.supabase.co/rest/v1/subjects?select=*&teacher_id=eq.1&order=created_at.desc');
  assert.equal(calls[0][1].headers.apikey, 'sb_publishable_x');
  assert.equal(calls[0][1].headers.Authorization, undefined);
});

test('retorno OAuth de Google guarda la sesión y luego envía el JWT del usuario', async () => {
  const calls = [];
  const loc = { hash: '#access_token=AT1&refresh_token=RT1&expires_in=3600&token_type=bearer', assign() {} };
  const sb = createClient('https://p.supabase.co', 'k', { storage: memStorage(), location: loc, fetchImpl: async (u, i) => { calls.push([u, i]); return res({ id: 'u1', email: 'a@gmail.com' }); } });
  assert.deepEqual(sb.auth.handleRedirect(), { ok: true });
  assert.equal(sb.auth.session.access_token, 'AT1');
  const user = await sb.auth.getUser();
  assert.equal(user.id, 'u1');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer AT1');
  assert.equal(sb.auth.handleRedirect('#/asignatura/x'), null, 'las rutas normales no se confunden con un retorno OAuth');
  assert.deepEqual(sb.auth.handleRedirect('#error=access_denied&error_description=Usuario+cancel%C3%B3'), { error: 'Usuario canceló' });
});

test('token vencido: se renueva una sola vez aunque haya peticiones simultáneas', async () => {
  const storage = memStorage();
  storage.setItem('aula.session', JSON.stringify({ access_token: 'OLD', refresh_token: 'R', expires_at: 1, user: { id: 'u' } }));
  let refreshes = 0; const auths = [];
  const sb = createClient('https://p.supabase.co', 'k', { storage, fetchImpl: async (u, i) => {
    if (u.includes('grant_type=refresh_token')) { refreshes++; await new Promise((r) => setTimeout(r, 20)); return res({ access_token: 'NEW', refresh_token: 'R2', expires_in: 3600 }); }
    auths.push(i.headers.Authorization); return res([]);
  } });
  await Promise.all([sb.db.select('a'), sb.db.select('b'), sb.db.rpc('c')]);
  assert.equal(refreshes, 1);
  assert.deepEqual(auths, ['Bearer NEW', 'Bearer NEW', 'Bearer NEW']);
  assert.equal(JSON.parse(storage.getItem('aula.session')).refresh_token, 'R2');
});

test('errores de PostgREST se traducen a mensajes útiles', async () => {
  const sb = createClient('https://p.supabase.co', 'k', { storage: memStorage(), fetchImpl: async () => res({ code: 'P0001', message: 'Código de inscripción inválido.' }, 400) });
  await assert.rejects(sb.db.rpc('join_subject', { p_code: 'X' }), /Código de inscripción inválido/);
  assert.match(friendlyMessage('duplicate key value violates unique constraint "activities_single_component_idx"'), /único/);
  assert.match(friendlyMessage('new row violates row-level security policy'), /permiso/);
});

test('varias pestañas: si otra pestaña ya renovó el token, se adopta sin gastar el refresh token rotado', async () => {
  const storage = memStorage();
  storage.setItem('aula.session', JSON.stringify({ access_token: 'OLD', refresh_token: 'R', expires_at: 1, user: { id: 'u' } }));
  let refreshes = 0; const auths = [];
  const sb = createClient('https://p.supabase.co', 'k', { storage, fetchImpl: async (u, i) => {
    if (u.includes('grant_type=refresh_token')) { refreshes++; return res({ error: 'invalid_grant' }, 400); }
    auths.push(i.headers.Authorization); return res([]);
  } });
  // La otra pestaña guarda una sesión nueva en el almacenamiento compartido.
  storage.setItem('aula.session', JSON.stringify({ access_token: 'FROM_TAB_B', refresh_token: 'R2', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
  await sb.db.select('subjects');
  assert.equal(refreshes, 0);
  assert.deepEqual(auths, ['Bearer FROM_TAB_B']);
  assert.ok(storage.getItem('aula.session'), 'no se borra la sesión compartida');
});
