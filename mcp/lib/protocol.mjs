// Transporte stdio de MCP sobre JSON-RPC 2.0 (mensajes delimitados por salto de línea).
// Sin dependencias. Nunca escribe logs en stdout: stdout es exclusivo del protocolo.

export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const DEFAULT_VERSION = '2025-06-18';

export const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

/** Error de negocio de una herramienta: se devuelve como resultado con isError=true. */
export class ToolError extends Error {}

/** Validador mínimo de JSON Schema (type, required, properties, pattern, enum, minimum, maximum, maxLength, additionalProperties). */
export function validateArgs(schema, value, path = 'argumentos') {
  const errors = [];
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const check = (s, v, p) => {
    if (!s) return;
    if (s.type) {
      const t = typeOf(v);
      const ok = s.type === 'integer' ? Number.isInteger(v) : s.type === 'number' ? t === 'number' && Number.isFinite(v) : t === s.type;
      if (!ok) { errors.push(`${p} debe ser de tipo ${s.type}`); return; }
    }
    if (s.enum && !s.enum.includes(v)) errors.push(`${p} debe ser uno de: ${s.enum.join(', ')}`);
    if (typeof v === 'string') {
      if (s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${p} tiene un formato inválido`);
      if (s.maxLength != null && v.length > s.maxLength) errors.push(`${p} supera ${s.maxLength} caracteres`);
    }
    if (typeof v === 'number') {
      if (s.minimum != null && v < s.minimum) errors.push(`${p} debe ser ≥ ${s.minimum}`);
      if (s.maximum != null && v > s.maximum) errors.push(`${p} debe ser ≤ ${s.maximum}`);
    }
    if (typeOf(v) === 'object') {
      for (const r of s.required || []) if (v[r] === undefined) errors.push(`falta ${p === 'argumentos' ? '' : p + '.'}${r}`);
      for (const [k, sub] of Object.entries(s.properties || {})) if (v[k] !== undefined) check(sub, v[k], k);
      if (s.additionalProperties === false) {
        for (const k of Object.keys(v)) if (!(s.properties || {})[k]) errors.push(`argumento no permitido: ${k}`);
      }
    }
  };
  check(schema, value, path);
  return errors;
}

/**
 * Crea el manejador de mensajes.
 * @param {{serverInfo:{name:string,version:string}, instructions?:string, tools:{definitions:Array, call:(name:string,args:object)=>Promise<{text:string,data?:any}>}, log?:(...a:any[])=>void}} opts
 */
export function createProtocol({ serverInfo, instructions, tools, log = () => {} }) {
  let negotiated = null;

  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message, data) => ({ jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } });

  async function callTool(id, params) {
    if (!params || typeof params.name !== 'string') return fail(id, ERR.INVALID_PARAMS, 'tools/call requiere "name"');
    const def = tools.definitions.find((t) => t.name === params.name);
    if (!def) return fail(id, ERR.INVALID_PARAMS, `Herramienta desconocida: ${params.name}`);
    const args = params.arguments ?? {};
    if (typeof args !== 'object' || Array.isArray(args) || args === null) {
      return fail(id, ERR.INVALID_PARAMS, '"arguments" debe ser un objeto');
    }
    const errors = validateArgs(def.inputSchema, args);
    if (errors.length) return fail(id, ERR.INVALID_PARAMS, `Parámetros inválidos: ${errors.join('; ')}`);
    try {
      const out = await tools.call(def.name, args);
      const result = { content: [{ type: 'text', text: out.text }] };
      if (out.data !== undefined) {
        result.structuredContent = out.data !== null && typeof out.data === 'object' && !Array.isArray(out.data)
          ? out.data : { resultado: out.data };
      }
      return ok(id, result);
    } catch (e) {
      if (!(e instanceof ToolError)) log('[mcp] error en herramienta', def.name, e?.stack || e);
      const msg = e instanceof ToolError ? e.message : `Error inesperado: ${e?.message || e}`;
      return ok(id, { content: [{ type: 'text', text: msg }], isError: true });
    }
  }

  /** Procesa un mensaje ya parseado. Devuelve la respuesta o null (notificaciones). */
  async function handle(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      // Respuestas a peticiones del servidor (no enviamos ninguna) o mensajes mal formados.
      if (msg && typeof msg === 'object' && ('result' in msg || 'error' in msg)) return null;
      return fail(msg && msg.id !== undefined ? msg.id : null, ERR.INVALID_REQUEST, 'Petición JSON-RPC inválida');
    }
    const isNotification = msg.id === undefined || msg.id === null;
    if (isNotification) return null; // notifications/initialized, notifications/cancelled, etc.
    const { id, method, params } = msg;
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        negotiated = SUPPORTED_VERSIONS.includes(requested) ? requested : DEFAULT_VERSION;
        const result = { protocolVersion: negotiated, capabilities: { tools: {} }, serverInfo };
        if (instructions) result.instructions = instructions;
        return ok(id, result);
      }
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, {
          tools: tools.definitions.map(({ name, title, description, inputSchema, annotations }) => ({
            name, ...(title ? { title } : {}), description, inputSchema, ...(annotations ? { annotations } : {}),
          })),
        });
      case 'tools/call':
        return callTool(id, params);
      default:
        return fail(id, ERR.METHOD_NOT_FOUND, `Método no encontrado: ${method}`);
    }
  }

  /** Procesa una línea de texto (puede ser un lote). Devuelve string a escribir o null. */
  async function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { return JSON.stringify(fail(null, ERR.PARSE, 'JSON inválido')); }
    if (Array.isArray(parsed)) {
      if (!parsed.length) return JSON.stringify(fail(null, ERR.INVALID_REQUEST, 'Lote vacío'));
      const out = (await Promise.all(parsed.map(handle))).filter(Boolean);
      return out.length ? JSON.stringify(out) : null;
    }
    const res = await handle(parsed);
    return res ? JSON.stringify(res) : null;
  }

  return { handle, handleLine, get protocolVersion() { return negotiated; } };
}

/** Conecta el protocolo a stdin/stdout. */
export function runStdio(protocol, { input = process.stdin, output = process.stdout, log = (...a) => console.error(...a) } = {}) {
  let buffer = '';
  let pending = 0;
  let ended = false;
  const maybeExit = () => { if (ended && pending === 0 && input === process.stdin) process.exit(0); };
  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      pending++;
      protocol.handleLine(line)
        .then((out) => { if (out) output.write(out + '\n'); })
        .catch((e) => log('[mcp] error procesando mensaje', e))
        .finally(() => { pending--; maybeExit(); });
    }
  });
  input.on('end', () => { ended = true; maybeExit(); });
}
