// Punto de entrada del agente: una ejecución = evaluar entregas pendientes + enviar notificaciones.
import { pathToFileURL } from 'node:url';
import { loadConfig, describeConfig, ConfigError } from './config.js';
import { createDb } from './supabase.js';
import { createLlm } from './llm/index.js';
import { createMailer } from './mailer.js';
import { runEvaluations } from './evaluator.js';
import { runNotifications } from './notifier.js';
import { maskEmails } from './privacy.js';

const FINAL_NOTIFY_RESERVE_MS = 60_000;

export function createLogger(out = console) {
  return (level, msg, extra) => {
    const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} ${msg}`;
    const fn = level === 'error' ? out.error : level === 'warn' ? out.warn : out.log;
    if (extra !== undefined) fn.call(out, line, extra);
    else fn.call(out, line);
  };
}

export async function main({ env = process.env, fetchImpl = globalThis.fetch, transport, log = createLogger() } = {}) {
  const started = Date.now();
  let config;
  try {
    config = loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) {
      log('error', err.message);
      return 1;
    }
    throw err;
  }
  log('info', 'Agente evaluador iniciado.', describeConfig(config));
  const deadline = started + config.runBudgetMs;
  const db = createDb({ url: config.supabaseUrl, serviceKey: config.serviceKey, fetchImpl });
  const llm = createLlm({ config, fetchImpl, log });
  const mailer = createMailer(config, { transport, log });

  let exitCode = 0;
  const notify = async (fase, until) => {
    try {
      return await runNotifications({ db, mailer, config, log, now: new Date(), deadline: until });
    } catch (err) {
      log('error', `Error en la fase de notificaciones (${fase}): ${maskEmails(err.message)}`);
      exitCode = 1;
      return null;
    }
  };

  // Fases: notificar → evaluar → notificar. Las notificaciones son idempotentes, así que los
  // recordatorios nunca dependen de que la evaluación termine (p. ej. con la cuota de IA agotada).
  const notifyBefore = await notify('inicio', Math.min(deadline, started + Math.min(120_000, config.runBudgetMs / 3)));
  let evalStats = null;
  try {
    // Se reserva tiempo al final para la segunda ronda de notificaciones.
    evalStats = await runEvaluations({ db, llm, config, log, deadline: deadline - FINAL_NOTIFY_RESERVE_MS });
  } catch (err) {
    log('error', `Error en la fase de evaluación: ${maskEmails(err.message)}`);
    exitCode = 1;
  }
  const notifyAfter = await notify('final', deadline);
  await mailer.close();
  log('info', `Ejecución terminada en ${Math.round((Date.now() - started) / 1000)} s.`, {
    evaluaciones: evalStats, correos_inicio: notifyBefore, correos_final: notifyAfter,
  });
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error('Error fatal inesperado:', err);
    process.exitCode = 1;
  });
}
