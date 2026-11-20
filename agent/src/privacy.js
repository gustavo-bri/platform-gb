// Enmascarado de datos personales para los registros (los logs de GitHub Actions de un repo público son públicos).

/** mask('ana.perez@gmail.com') → 'an***@gmail.com' */
export function mask(email) {
  const s = String(email ?? '');
  const at = s.lastIndexOf('@');
  if (at < 1) return s ? '***' : '';
  return `${s.slice(0, Math.min(2, at))}***${s.slice(at)}`;
}

/** Enmascara todos los correos que aparezcan dentro de un texto (p. ej. errores SMTP). */
export function maskEmails(text) {
  return String(text ?? '').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => mask(m));
}
