/**
 * CSV cell formatting shared by admin export routes. A value starting with
 * =, +, -, @, or a tab is interpreted as a formula by Excel/Sheets when the
 * file is opened (CSV/formula injection, OWASP) — a leading single quote
 * forces text and is the standard mitigation.
 */
export function csv(value: unknown): string {
  let text = value instanceof Date ? value.toISOString() : String(value ?? '');
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
