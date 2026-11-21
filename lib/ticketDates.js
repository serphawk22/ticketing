export const DEFAULT_DUE_DAYS = 7;
export const APP_TIME_ZONE = 'Asia/Kolkata';

/**
 * Validates whether a value is a valid YYYY-MM-DD date string.
 * @param {any} value
 * @returns {boolean}
 */
export function isValidDateString(value) {
  if (value == null) return false;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/**
 * Calculates a timezone-safe date-only (YYYY-MM-DD) string exactly
 * `days` calendar days from the given base date (defaults to 7 calendar days from now in IST).
 *
 * Uses Date.UTC with the local calendar parts to guarantee no DST or clock-shift drift.
 *
 * @param {Date|string|number} [baseDate=new Date()]
 * @param {number} [days=DEFAULT_DUE_DAYS]
 * @returns {string} YYYY-MM-DD
 */
export function calculateDefaultDueDate(baseDate = new Date(), days = DEFAULT_DUE_DAYS) {
  const dateObj =
    baseDate instanceof Date && !Number.isNaN(baseDate.getTime())
      ? baseDate
      : typeof baseDate === 'string' || typeof baseDate === 'number'
      ? new Date(baseDate)
      : new Date();

  const safeDate = Number.isNaN(dateObj.getTime()) ? new Date() : dateObj;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(safeDate);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const year = Number(get('year'));
  const month = Number(get('month')) - 1;
  const day = Number(get('day'));

  const utc = new Date(Date.UTC(year, month, day));
  utc.setUTCDate(utc.getUTCDate() + (Number(days) || DEFAULT_DUE_DAYS));
  return utc.toISOString().slice(0, 10);
}

/**
 * Resolves the due date for ticket creation:
 * - If a non-empty due date is provided, validates and preserves it.
 * - If omitted, null, or empty string, returns 7 calendar days from creation date.
 *
 * @param {string|null|undefined} inputDueDate
 * @param {Date} [creationDate=new Date()]
 * @returns {{ dueDate: string, error?: string }}
 */
export function resolveCreationDueDate(inputDueDate, creationDate = new Date()) {
  if (inputDueDate != null && String(inputDueDate).trim() !== '') {
    const trimmed = String(inputDueDate).trim();
    if (!isValidDateString(trimmed)) {
      return { dueDate: null, error: 'Invalid due date.' };
    }
    return { dueDate: trimmed };
  }
  return { dueDate: calculateDefaultDueDate(creationDate, DEFAULT_DUE_DAYS) };
}

