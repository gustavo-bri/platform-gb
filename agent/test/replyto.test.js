import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createMailer } from '../src/mailer.js';

const base = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', GEMINI_API_KEY: 'g', GMAIL_APP_PASSWORD: 'p' };

test('las respuestas van a MAIL_REPLY_TO cuando difiere de la cuenta que envía', async () => {
  const sent = [];
  const transport = { sendMail: async (m) => { sent.push(m); return {}; } };
  const cfg = loadConfig({ ...base, GMAIL_USER: 'aula.avisos@gmail.com', MAIL_REPLY_TO: 'gustavo_briceno@cun.edu.co', MAIL_FROM_NAME: 'Prof. Gustavo Briceño' });
  await createMailer(cfg, { transport }).send({ to: 'ana@gmail.com', subject: 's', html: 'h', text: 't' });
  assert.deepEqual(sent[0].from, { name: 'Prof. Gustavo Briceño', address: 'aula.avisos@gmail.com' });
  assert.equal(sent[0].replyTo, 'gustavo_briceno@cun.edu.co');
});

test('si envía la propia cuenta del docente no se añade Reply-To', async () => {
  const sent = [];
  const transport = { sendMail: async (m) => { sent.push(m); return {}; } };
  const cfg = loadConfig({ ...base, GMAIL_USER: 'gustavo_briceno@cun.edu.co' });
  await createMailer(cfg, { transport }).send({ to: 'ana@gmail.com', subject: 's', html: 'h', text: 't' });
  assert.equal(sent[0].from.address, 'gustavo_briceno@cun.edu.co');
  assert.equal(sent[0].replyTo, undefined);
});
