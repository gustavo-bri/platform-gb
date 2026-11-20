// Envío de correos por Gmail SMTP (contraseña de aplicación). nodemailer se carga solo si se usa.
import { mask } from './privacy.js';

export function createMailer(config, { transport, log = () => {} } = {}) {
  const enabled = config.dryRun || config.mailEnabled || Boolean(transport);
  let tx = transport ?? null;

  async function getTransport() {
    if (tx) return tx;
    const { default: nodemailer } = await import('nodemailer');
    tx = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: config.gmailUser, pass: config.gmailPass },
      pool: true,
      maxConnections: 1,
      rateDelta: 1000,
      rateLimit: 1,
    });
    return tx;
  }

  async function send({ to, subject, html, text }) {
    if (config.dryRun && !transport) {
      log('info', `[DRY_RUN] Correo a ${mask(to)}: ${subject}`);
      return { dryRun: true };
    }
    const t = await getTransport();
    return t.sendMail({
      from: { name: config.mailFromName, address: config.gmailUser },
      ...(config.mailReplyTo && config.mailReplyTo !== config.gmailUser ? { replyTo: config.mailReplyTo } : {}),
      to,
      subject,
      html,
      text,
    });
  }

  async function close() {
    if (tx && typeof tx.close === 'function') tx.close();
  }

  return { enabled, send, close };
}
