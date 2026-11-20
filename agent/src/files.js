// Extracción de contenido evaluable desde archivos de entregas, enunciados y soluciones.
// Devuelve partes de texto (para cualquier modelo) o partes binarias inline (PDF/imagen, solo Gemini).
import zlib from 'node:zlib';

export const INLINE_MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

export const TEXT_EXT = new Set([
  'txt', 'md', 'py', 'java', 'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'html', 'htm',
  'css', 'sql', 'json', 'xml', 'yaml', 'yml', 'csv', 'psc', 'r', 'go', 'rb', 'php', 'kt', 'swift', 'sh', 'bat', 'ps1',
  'm', 'ipynb', 'tex', 'scala', 'rs', 'dart', 'vue', 'pl', 'lua', 'asm', 's', 'properties', 'ini', 'toml', 'gradle',
]);

const SKIP_DIRS = ['node_modules/', '.git/', '__pycache__/', '__MACOSX/', '.idea/', '.vscode/', 'venv/', '.venv/', 'dist/', 'build/', 'target/', 'bin/', 'obj/'];

export const LIMITS = {
  maxTextChars: 200_000,          // texto total extraído de un archivo (o de todo un zip)
  maxZipFiles: 150,
  maxZipEntryBytes: 300 * 1024,
  maxInlineBytes: 15 * 1024 * 1024,
  maxEntryUncompressed: 5 * 1024 * 1024, // tope de descompresión por entrada (anti zip‑bomb)
};

export const extOf = (name = '') => {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
};

export function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function decodeText(buf) {
  let s = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.replace(/\r\n?/g, '\n');
}

export function decodeXmlEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ── ZIP ────────────────────────────────────────────────────────────────
/** Lee el directorio central de un ZIP. Devuelve [{name, method, compSize, size, offset, encrypted, isDir}] */
export function readZipEntries(buf) {
  const EOCD = 0x06054b50;
  const minStart = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP inválido o dañado (no se encontró el directorio central).');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) throw new Error('ZIP64 no soportado.');
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP dañado (entrada central inválida).');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800 ? rawName.toString('utf8') : rawName.toString('latin1')).replace(/\\/g, '/');
    entries.push({ name, method, compSize, size, offset, encrypted: Boolean(flags & 1), isDir: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readZipEntry(buf, entry) {
  if (entry.encrypted) throw new Error(`"${entry.name}" está cifrado.`);
  if (entry.size > LIMITS.maxEntryUncompressed) {
    throw new Error(`"${entry.name}" declara ${Math.round(entry.size / 1048576)} MB descomprimido (máximo 5 MB).`);
  }
  const lh = entry.offset;
  if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error(`Cabecera local inválida en "${entry.name}".`);
  const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) {
    if (data.length > LIMITS.maxEntryUncompressed) throw new Error(`"${entry.name}" supera 5 MB.`);
    return Buffer.from(data);
  }
  if (entry.method === 8) {
    // El tamaño declarado puede mentir: se limita la salida al menor entre lo declarado y 5 MB.
    const cap = Math.max(1, Math.min(entry.size, LIMITS.maxEntryUncompressed));
    try {
      return zlib.inflateRawSync(data, { maxOutputLength: cap });
    } catch (err) {
      if (err?.code === 'ERR_BUFFER_TOO_LARGE' || /larger than|too large|maxOutputLength/i.test(err?.message ?? '')) {
        throw new Error(`"${entry.name}" se expande más de lo declarado o supera 5 MB (posible bomba de descompresión).`);
      }
      throw new Error(`"${entry.name}" está dañado (${err.message}).`);
    }
  }
  throw new Error(`Método de compresión ${entry.method} no soportado en "${entry.name}".`);
}

// ── DOCX / IPYNB ───────────────────────────────────────────────────────
export function docxToText(buf) {
  const entries = readZipEntries(buf);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) throw new Error('El .docx no contiene word/document.xml.');
  const xml = readZipEntry(buf, doc).toString('utf8');
  let out = '';
  const re = /<w:tab\/>|<w:br[^>]*\/>|<w:cr\/>|<\/w:p>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml))) {
    const tok = m[0];
    if (tok === '<w:tab/>') out += '\t';
    else if (tok.startsWith('<w:br') || tok === '<w:cr/>') out += '\n';
    else if (tok === '</w:p>') out += '\n';
    else out += decodeXmlEntities(m[1]);
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export function ipynbToText(buf) {
  const nb = JSON.parse(decodeText(buf));
  const cells = Array.isArray(nb.cells) ? nb.cells : [];
  return cells
    .filter((c) => c.cell_type === 'code' || c.cell_type === 'markdown')
    .map((c, i) => {
      const src = Array.isArray(c.source) ? c.source.join('') : String(c.source ?? '');
      return `# [Celda ${i + 1} · ${c.cell_type === 'code' ? 'código' : 'markdown'}]\n${src}`;
    })
    .join('\n\n');
}

// ── Utilidades ─────────────────────────────────────────────────────────
function truncate(text, max) {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n[... CONTENIDO TRUNCADO: se omitieron ${text.length - max} caracteres ...]`, truncated: true };
}

const fence = (label, text) => `Archivo: ${label}\n\`\`\`\n${text}\n\`\`\``;

function textFileToString(buf, ext) {
  if (ext === 'ipynb') return ipynbToText(buf);
  if (looksBinary(buf)) throw new Error('el contenido parece binario, no texto');
  return decodeText(buf);
}

function inlinePart(buf, mime, label) {
  return { type: 'inline', mime, data: buf.toString('base64'), name: label };
}

// ── ZIP completo ───────────────────────────────────────────────────────
function extractZip(buf, label) {
  const warnings = [];
  const parts = [];
  const entries = readZipEntries(buf).filter((e) => !e.isDir);
  const tree = entries.map((e) => `- ${e.name} (${e.size} B)`).join('\n');
  let textBudget = LIMITS.maxTextChars;
  let inlineBudget = LIMITS.maxInlineBytes;
  let files = 0;
  const sections = [];
  let omitted = 0;

  for (const e of entries) {
    const lower = `/${e.name.toLowerCase()}`;
    if (SKIP_DIRS.some((d) => lower.includes(`/${d}`))) continue;
    const ext = extOf(e.name);
    if (files >= LIMITS.maxZipFiles || textBudget <= 0) { omitted++; continue; }
    try {
      if (TEXT_EXT.has(ext)) {
        if (e.size > LIMITS.maxZipEntryBytes) { warnings.push(`"${e.name}" omitido: supera 300 KB.`); continue; }
        const content = textFileToString(readZipEntry(buf, e), ext);
        const t = truncate(content, textBudget);
        sections.push(fence(e.name, t.text));
        textBudget -= t.text.length;
        files++;
      } else if (ext === 'docx') {
        const content = docxToText(readZipEntry(buf, e));
        const t = truncate(content, textBudget);
        sections.push(fence(e.name, t.text));
        textBudget -= t.text.length;
        files++;
      } else if (INLINE_MIME[ext]) {
        if (e.size > inlineBudget) { warnings.push(`"${e.name}" omitido: no cabe en el límite de 15 MB.`); continue; }
        const data = readZipEntry(buf, e);
        parts.push(inlinePart(data, INLINE_MIME[ext], e.name));
        inlineBudget -= data.length;
        files++;
      }
    } catch (err) {
      warnings.push(`"${e.name}" no se pudo leer: ${err.message}`);
    }
  }
  if (omitted) warnings.push(`Se omitieron ${omitted} archivo(s) del ZIP por límite de tamaño o cantidad.`);
  const header = `Contenido del archivo comprimido ${label}\nÁrbol de archivos:\n${tree || '(vacío)'}`;
  const textPart = { type: 'text', text: [header, ...sections].join('\n\n') };
  const unreadable = files === 0;
  if (unreadable) warnings.push(`El ZIP ${label} no contiene archivos evaluables (texto, código, docx, pdf o imagen).`);
  return { parts: [textPart, ...parts], warnings, unreadable };
}

/**
 * Extrae contenido evaluable.
 * @param {{buffer: Buffer, mime?: string, name?: string}} file
 * @param {{label?: string}} opts  etiqueta neutral para el prompt (no se usa el nombre original si se indica)
 */
export function extractContent(file, { label } = {}) {
  const name = file.name || '';
  let ext = extOf(name);
  if (!ext && file.mime) {
    const fromMime = Object.entries(INLINE_MIME).find(([, m]) => m === file.mime);
    if (fromMime) ext = fromMime[0];
    else if (file.mime === 'application/zip' || file.mime === 'application/x-zip-compressed') ext = 'zip';
    else if (file.mime.startsWith('text/')) ext = 'txt';
  }
  const shown = label || name || `archivo.${ext || 'bin'}`;
  const buf = file.buffer;
  if (!buf || !buf.length) {
    return { parts: [], warnings: [`El archivo ${shown} está vacío.`], unreadable: true };
  }
  try {
    if (INLINE_MIME[ext]) {
      if (buf.length > LIMITS.maxInlineBytes) {
        return { parts: [], warnings: [`El archivo ${shown} supera 15 MB.`], unreadable: true };
      }
      return { parts: [inlinePart(buf, INLINE_MIME[ext], shown)], warnings: [], unreadable: false };
    }
    if (ext === 'zip') return extractZip(buf, shown);
    if (ext === 'docx') {
      const t = truncate(docxToText(buf), LIMITS.maxTextChars);
      const warnings = t.truncated ? [`El documento ${shown} se truncó por extensión.`] : [];
      if (!t.text.trim()) return { parts: [], warnings: [`El documento ${shown} no contiene texto legible.`], unreadable: true };
      return { parts: [{ type: 'text', text: fence(shown, t.text) }], warnings, unreadable: false };
    }
    if (TEXT_EXT.has(ext)) {
      const t = truncate(textFileToString(buf, ext), LIMITS.maxTextChars);
      const warnings = t.truncated ? [`El archivo ${shown} se truncó por extensión.`] : [];
      return { parts: [{ type: 'text', text: fence(shown, t.text) }], warnings, unreadable: false };
    }
    return {
      parts: [],
      warnings: [`no_evaluable: el formato ".${ext || '?'}" de ${shown} no se puede evaluar automáticamente (usa PDF, imagen, texto, código, .docx o .zip).`],
      unreadable: true,
    };
  } catch (err) {
    return { parts: [], warnings: [`No se pudo leer ${shown}: ${err.message}`], unreadable: true };
  }
}
