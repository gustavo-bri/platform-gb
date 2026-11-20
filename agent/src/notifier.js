// Notificaciones por correo: idempotentes (reserva antes de enviar) y con presupuesto diario de Gmail.
import { reminderEmail, newActivitiesEmail, feedbackEmail, digestEmail } from './templates.js';
import { mask, maskEmails } from './privacy.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function localHour(date, timezone) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(date));
}

export function localDay(date, timezone) {
  // en-CA formatea como AAAA-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

class BudgetExhausted extends Error {}
class OutOfTime extends Error {}

export async function runNotifications({ db, mailer, config, log = () => {}, now = new Date(), deadline = Infinity, clock = () => Date.now() }) {
  const stats = { sent: 0, failed: 0, duplicates: 0, retro: 0, recordatorio: 0, nueva: 0, resumen: 0, budgetExhausted: false, skipped: false };
  if (!mailer?.enabled) {
    log('warn', 'Correo desactivado: define GMAIL_USER y GMAIL_APP_PASSWORD (o DRY_RUN=true). No se envían notificaciones.');
    stats.skipped = true;
    return stats;
  }

  const already = Number(await db.rpc('emails_sent_since', { p_since: new Date(now.getTime() - DAY_MS).toISOString() })) || 0;
  const remaining = () => config.emailDailyBudget - already - stats.sent;

  function guard() {
    if (clock() >= deadline) throw new OutOfTime();
    if (remaining() <= 0) throw new BudgetExhausted();
  }

  const claim = (user, activity, kind) => db.rpc('claim_notification', { p_user: user, p_activity: activity ?? null, p_kind: kind });
  const release = (user, activity, kind) => db.rpc('release_notification', { p_user: user, p_activity: activity ?? null, p_kind: kind })
    .catch((e) => log('error', `No se pudo liberar la reserva ${kind}: ${e.message}`));

  /** Reserva → envía → si falla, libera las reservas. `keys` = [{activity, kind}] */
  async function deliver(userId, to, keys, email, bucket) {
    guard();
    const claimed = [];
    for (const k of keys) {
      if (await claim(userId, k.activity, k.kind)) claimed.push(k);
      else stats.duplicates++;
    }
    if (!claimed.length) return false;
    const built = typeof email === 'function' ? email(claimed) : email;
    try {
      await mailer.send({ to, ...built });
      stats.sent++;
      stats[bucket]++;
      return true;
    } catch (err) {
      stats.failed++;
      log('error', `Fallo al enviar "${built.subject}" a ${mask(to)}: ${maskEmails(err.message)}`);
      for (const k of claimed) await release(userId, k.activity, k.kind);
      return false;
    }
  }

  try {
    // 1. Retroalimentación lista
    for (const n of (await db.rpc('feedback_notices', {})) ?? []) {
      await deliver(n.user_id, n.email, [{ activity: n.activity_id, kind: n.kind }], feedbackEmail(n, config), 'retro');
    }
    // 2. Recordatorios de fecha límite
    for (const n of (await db.rpc('due_reminders', { p_now: now.toISOString() })) ?? []) {
      await deliver(n.user_id, n.email, [{ activity: n.activity_id, kind: n.kind }], reminderEmail(n, config), 'recordatorio');
    }
    // 3. Actividades nuevas: un solo correo por estudiante con todas las nuevas
    const byUser = new Map();
    for (const n of (await db.rpc('new_activity_notices', { p_now: now.toISOString() })) ?? []) {
      if (!byUser.has(n.user_id)) byUser.set(n.user_id, []);
      byUser.get(n.user_id).push(n);
    }
    for (const [userId, items] of byUser) {
      const keys = items.map((n) => ({ activity: n.activity_id, kind: n.kind }));
      await deliver(userId, items[0].email, keys, (claimed) => {
        const ids = new Set(claimed.map((k) => k.activity));
        return newActivitiesEmail({ full_name: items[0].full_name, items: items.filter((n) => ids.has(n.activity_id)) }, config);
      }, 'nueva');
    }
    // 4. Resumen diario para el docente (no antes de DIGEST_HOUR, hora local)
    if (localHour(now, config.timezone) >= (config.digestHour ?? 7)) {
      const day = localDay(now, config.timezone);
      for (const d of (await db.rpc('teacher_digests', { p_day: day })) ?? []) {
        await deliver(d.user_id, d.email, [{ activity: null, kind: d.kind }], digestEmail(d, config), 'resumen');
      }
    }
  } catch (err) {
    if (err instanceof BudgetExhausted) {
      stats.budgetExhausted = true;
      log('warn', `Presupuesto diario de correos agotado (${config.emailDailyBudget}); el resto se enviará en próximas ejecuciones.`);
    } else if (err instanceof OutOfTime) {
      log('warn', 'Tiempo de ejecución agotado; las notificaciones restantes quedan para la próxima ejecución.');
    } else {
      throw err;
    }
  }
  return stats;
}
