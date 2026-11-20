import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractContent, readZipEntries, docxToText, LIMITS } from '../src/files.js';
import { fixture, makeZip } from './helpers.js';

test('zip real (Python): árbol, código extraído, carpetas basura y binarios omitidos, imagen inline', () => {
  const r = extractContent({ buffer: fixture('proyecto.zip'), name: 'entrega.zip' }, { label: 'entrega.zip' });
  const text = r.parts[0].text;
  assert.match(text, /Árbol de archivos/);
  assert.match(text, /proyecto\/src\/main\.py/);
  assert.match(text, /def promedio\(xs\)/);
  assert.match(text, /Proyecto ñandú/, 'UTF-8 correcto');
  assert.match(text, /guardado sin compresión/, 'método 0 (stored)');
  assert.doesNotMatch(text, /module\.exports/, 'omite node_modules');
  assert.doesNotMatch(text, /\[core\]/, 'omite .git');
  const inline = r.parts.filter((p) => p.type === 'inline');
  assert.equal(inline.length, 1);
  assert.equal(inline[0].mime, 'image/png');
  assert.equal(r.unreadable, false);
});

test('docx real: párrafos, tabulaciones, saltos y entidades', () => {
  const t = docxToText(fixture('tarea.docx'));
  assert.match(t, /Respuesta 1: una variable & su valor/);
  assert.match(t, /Col A\tCol B/);
  assert.match(t, /Línea\nsiguiente <fin>/);
  const r = extractContent({ buffer: fixture('tarea.docx'), name: 'Tarea Ana Pérez.docx' }, { label: 'entrega.docx' });
  assert.match(r.parts[0].text, /^Archivo: entrega\.docx/, 'usa la etiqueta neutra, no el nombre original');
  assert.doesNotMatch(r.parts[0].text, /Ana Pérez/);
});

test('ipynb: celdas de código y markdown', () => {
  const r = extractContent({ buffer: fixture('cuaderno.ipynb'), name: 'x.ipynb' });
  assert.match(r.parts[0].text, /\[Celda 1 · markdown\]\n# Título/);
  assert.match(r.parts[0].text, /\[Celda 2 · código\]\nx = 1\nprint\(x\)/);
  assert.doesNotMatch(r.parts[0].text, /ignorar/);
});

test('PDF e imágenes van inline; GIF y PPTX no son evaluables', () => {
  const pdf = extractContent({ buffer: Buffer.from('%PDF-1.4 ...'), name: 'a.pdf' });
  assert.equal(pdf.parts[0].type, 'inline');
  assert.equal(pdf.parts[0].mime, 'application/pdf');
  const byMime = extractContent({ buffer: Buffer.from('xx'), mime: 'image/jpeg', name: '' });
  assert.equal(byMime.parts[0].mime, 'image/jpeg');
  for (const name of ['a.gif', 'b.pptx', 'c.rar']) {
    const r = extractContent({ buffer: Buffer.from('xx'), name });
    assert.equal(r.unreadable, true, name);
    assert.match(r.warnings[0], /no_evaluable/);
  }
});

test('archivo de código con bytes nulos se trata como ilegible', () => {
  const r = extractContent({ buffer: Buffer.from([0x70, 0x00, 0x01]), name: 'main.py' });
  assert.equal(r.unreadable, true);
  assert.match(r.warnings[0], /binario/);
});

test('archivo vacío', () => {
  const r = extractContent({ buffer: Buffer.alloc(0), name: 'a.txt' });
  assert.equal(r.unreadable, true);
});

test('texto largo se trunca con marca explícita', () => {
  const big = 'a'.repeat(LIMITS.maxTextChars + 500);
  const r = extractContent({ buffer: Buffer.from(big), name: 'a.txt' });
  assert.match(r.parts[0].text, /CONTENIDO TRUNCADO: se omitieron 500 caracteres/);
  assert.equal(r.warnings.length, 1);
});

test('zip: límite de caracteres totales y de archivos, archivos > 300 KB omitidos', () => {
  const entries = [{ name: 'grande.txt', data: 'y'.repeat(310 * 1024) }];
  for (let i = 0; i < 160; i++) entries.push({ name: `src/f${i}.js`, data: `// archivo ${i}\n` + 'x'.repeat(2000) });
  const r = extractContent({ buffer: makeZip(entries), name: 'p.zip' });
  assert.ok(r.parts[0].text.length < LIMITS.maxTextChars + 20000);
  assert.ok(r.warnings.some((w) => /grande\.txt.*300 KB/.test(w)));
  assert.ok(r.warnings.some((w) => /Se omitieron \d+ archivo/.test(w)));
});

test('zip sin nada evaluable queda ilegible; zip dañado da advertencia', () => {
  const r = extractContent({ buffer: makeZip([{ name: 'a.exe', data: Buffer.from([0, 1, 2]) }]), name: 'p.zip' });
  assert.equal(r.unreadable, true);
  const bad = extractContent({ buffer: Buffer.from('no soy zip'), name: 'p.zip' });
  assert.equal(bad.unreadable, true);
  assert.match(bad.warnings[0], /ZIP inválido/);
});

test('readZipEntries lee nombres UTF-8 y docx dentro de zip', () => {
  const zip = makeZip([{ name: 'informe/año.docx', data: fixture('tarea.docx'), store: true }, { name: 'x.md', data: '# hola' }]);
  assert.deepEqual(readZipEntries(zip).map((e) => e.name), ['informe/año.docx', 'x.md']);
  const r = extractContent({ buffer: zip, name: 'p.zip' });
  assert.match(r.parts[0].text, /una variable & su valor/);
});
