/**
 * Consistent date boundary and filter calculation utilities for Serp Hawk Reporting.
 * All calendar presets (`today`, `yesterday`, `this_week`, `this_month`, `last_month`, `quarter`)
 * are evaluated strictly in Asia/Kolkata (IST, UTC+05:30) and returned as exact UTC instants
 * alongside IST YYYY-MM-DD calendar strings.
 */

const KOLKATA_OFFSET_MS = 5.5 * 3600 * 1000;

export const DATE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'custom', label: 'Custom Range' },
];

/**
 * Format UTC instant Date object to YYYY-MM-DD in Asia/Kolkata.
 */
export function formatIsoDate(d) {
  if (!d || Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + KOLKATA_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Parse an ISO date or datetime string into a Date object in UTC.
 * Date-only values (`YYYY-MM-DD`) represent IST calendar dates anchored at 00:00:00+05:30.
 */
export function parseUtcDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const str = String(value).trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const d = new Date(`${str}T12:00:00+05:30`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = str.endsWith('Z') || /[+-]\d{2}(:?\d{2})?$/.test(str) ? str : str.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function istDayBounds(year, month, day) {
  const startUtcMs = Date.UTC(year, month, day, 0, 0, 0, 0) - KOLKATA_OFFSET_MS;
  const endUtcMs = Date.UTC(year, month, day, 23, 59, 59, 999) - KOLKATA_OFFSET_MS;
  return { start: new Date(startUtcMs), end: new Date(endUtcMs) };
}

function istDateStrStart(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - KOLKATA_OFFSET_MS);
}

function istDateStrEnd(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - KOLKATA_OFFSET_MS);
}

/**
 * Calculate Start and End UTC instants for an IST calendar preset or custom YYYY-MM-DD dates.
 */
export function resolveDateRange({
  preset = 'this_month',
  startDate = '',
  endDate = '',
  referenceDate = new Date(),
} = {}) {
  const refUtc = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const kNow = new Date(refUtc.getTime() + KOLKATA_OFFSET_MS);
  const year = kNow.getUTCFullYear();
  const month = kNow.getUTCMonth(); // 0-indexed
  const date = kNow.getUTCDate();
  const dayOfWeek = kNow.getUTCDay(); // 0=Sun..6=Sat

  let start;
  let end;
  let label = 'This Month';
  let activePreset = preset;

  switch (preset) {
    case 'today': {
      ({ start, end } = istDayBounds(year, month, date));
      label = 'Today';
      break;
    }
    case 'yesterday': {
      ({ start, end } = istDayBounds(year, month, date - 1));
      label = 'Yesterday';
      break;
    }
    case 'this_week': {
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      start = istDayBounds(year, month, date + diffToMonday).start;
      end = istDayBounds(year, month, date + diffToMonday + 6).end;
      label = 'This Week';
      break;
    }
    case 'last_month': {
      const prevYear = month === 0 ? year - 1 : year;
      const prevMonth = month === 0 ? 11 : month - 1;
      const lastDay = new Date(Date.UTC(prevYear, prevMonth + 1, 0)).getUTCDate();
      start = istDayBounds(prevYear, prevMonth, 1).start;
      end = istDayBounds(prevYear, prevMonth, lastDay).end;
      label = 'Last Month';
      break;
    }
    case 'quarter': {
      const q = Math.floor(month / 3);
      const lastMonthOfQ = q * 3 + 2;
      const lastDay = new Date(Date.UTC(year, lastMonthOfQ + 1, 0)).getUTCDate();
      start = istDayBounds(year, q * 3, 1).start;
      end = istDayBounds(year, lastMonthOfQ, lastDay).end;
      label = `Q${q + 1} ${year}`;
      break;
    }
    case 'custom': {
      const isDateStr = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());
      if (isDateStr(startDate) && isDateStr(endDate)) {
        let sStr = startDate.trim();
        let eStr = endDate.trim();
        if (sStr > eStr) [sStr, eStr] = [eStr, sStr];
        start = istDateStrStart(sStr);
        end = istDateStrEnd(eStr);
        label = `${sStr} to ${eStr}`;
      } else if (isDateStr(startDate)) {
        const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        start = istDateStrStart(startDate.trim());
        end = istDayBounds(year, month, lastDay).end;
        label = `From ${startDate}`;
      } else if (isDateStr(endDate)) {
        start = istDayBounds(year, 0, 1).start;
        end = istDateStrEnd(endDate.trim());
        label = `Until ${endDate}`;
      } else {
        const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        start = istDayBounds(year, month, 1).start;
        end = istDayBounds(year, month, lastDay).end;
        activePreset = 'this_month';
        label = 'This Month';
      }
      break;
    }
    case 'this_month':
    default: {
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      start = istDayBounds(year, month, 1).start;
      end = istDayBounds(year, month, lastDay).end;
      label = 'This Month';
      activePreset = 'this_month';
      break;
    }
  }

  return {
    preset: activePreset,
    timezone: 'Asia/Kolkata',
    startDate: formatIsoDate(start),
    endDate: formatIsoDate(end),
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startMs: start.getTime(),
    endMs: end.getTime(),
    label,
  };
}

/**
 * Calculate total calendar days within a given millisecond range.
 */
export function calculateDaysInRange(startMs, endMs) {
  if (!startMs || !endMs || endMs < startMs) return 1;
  return Math.max(1, Math.round((endMs - startMs) / 86400000));
}

/**
 * Calculate period multiplier relative to standard 1-month reporting cadence.
 */
export function calculateMonthsMultiplier(preset, startMs, endMs) {
  if (preset === 'this_month' || preset === 'last_month') return 1.0;
  if (preset === 'quarter') return 3.0;
  if (preset === 'today' || preset === 'yesterday') return 1 / 30.4375;
  if (preset === 'this_week') return 7 / 30.4375;
  const days = calculateDaysInRange(startMs, endMs);
  return Math.max(0.01, days / 30.4375);
}

/**
 * Filter an array of items by date property falling within [startMs, endMs].
 */
export function isWithinRange(itemDateStr, startMs, endMs) {
  if (!itemDateStr) return false;
  const d = parseUtcDate(itemDateStr);
  if (!d) return false;
  const t = d.getTime();
  return t >= startMs && t <= endMs;
}
