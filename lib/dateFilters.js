/**
 * Consistent date boundary and filter calculation utilities for Serp Hawk Reporting.
 * All computations use UTC boundaries to match the naive UTC timestamps stored in SQLite/Postgres.
 */

export const DATE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'custom', label: 'Custom Range' },
];

/**
 * Format Date object to YYYY-MM-DD
 */
export function formatIsoDate(d) {
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * Parse an ISO date or datetime string into a Date object in UTC
 */
export function parseUtcDate(value) {
  if (!value) return null;
  const str = String(value).trim();
  const iso = str.endsWith('Z') || str.includes('+') ? str : str.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Calculate Start and End dates for a given preset or custom dates
 */
export function resolveDateRange({
  preset = 'this_month',
  startDate = '',
  endDate = '',
  referenceDate = new Date(),
} = {}) {
  const now = referenceDate;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed
  const date = now.getUTCDate();
  const dayOfWeek = now.getUTCDay(); // 0 is Sunday

  let start;
  let end;
  let label = 'This Month';
  let activePreset = preset;

  switch (preset) {
    case 'today': {
      start = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
      end = new Date(Date.UTC(year, month, date, 23, 59, 59, 999));
      label = 'Today';
      break;
    }
    case 'this_week': {
      // Week starts Monday (1)
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      start = new Date(Date.UTC(year, month, date + diffToMonday, 0, 0, 0, 0));
      end = new Date(Date.UTC(year, month, date + diffToMonday + 6, 23, 59, 59, 999));
      label = 'This Week';
      break;
    }
    case 'quarter': {
      const q = Math.floor(month / 3);
      start = new Date(Date.UTC(year, q * 3, 1, 0, 0, 0, 0));
      end = new Date(Date.UTC(year, q * 3 + 3, 0, 23, 59, 59, 999));
      label = `Q${q + 1} ${year}`;
      break;
    }
    case 'custom': {
      if (startDate && endDate) {
        let sStr = startDate;
        let eStr = endDate;
        if (sStr > eStr) {
          [sStr, eStr] = [eStr, sStr];
        }
        start = new Date(`${sStr}T00:00:00.000Z`);
        end = new Date(`${eStr}T23:59:59.999Z`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
          end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
          activePreset = 'this_month';
          label = 'This Month';
        } else {
          label = `${sStr} to ${eStr}`;
        }
      } else if (startDate && !endDate) {
        start = new Date(`${startDate}T00:00:00.000Z`);
        end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
        label = `From ${startDate}`;
      } else if (!startDate && endDate) {
        start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
        end = new Date(`${endDate}T23:59:59.999Z`);
        label = `Until ${endDate}`;
      } else {
        start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
        end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
        activePreset = 'this_month';
        label = 'This Month';
      }
      break;
    }
    case 'this_month':
    default: {
      start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
      label = 'This Month';
      activePreset = 'this_month';
      break;
    }
  }

  return {
    preset: activePreset,
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
 * Calculate total calendar days within a given millisecond range
 */
export function calculateDaysInRange(startMs, endMs) {
  if (!startMs || !endMs || endMs < startMs) return 1;
  return Math.max(1, Math.round((endMs - startMs) / 86400000));
}

/**
 * Calculate period multiplier relative to standard 1-month reporting cadence
 */
export function calculateMonthsMultiplier(preset, startMs, endMs) {
  if (preset === 'this_month') return 1.0;
  if (preset === 'quarter') return 3.0;
  if (preset === 'today') return 1 / 30.4375;
  if (preset === 'this_week') return 7 / 30.4375;
  const days = calculateDaysInRange(startMs, endMs);
  return Math.max(0.01, days / 30.4375);
}

/**
 * Filter an array of items by date property falling within range
 */
export function isWithinRange(itemDateStr, startMs, endMs) {
  if (!itemDateStr) return false;
  const d = parseUtcDate(itemDateStr);
  if (!d) return false;
  const t = d.getTime();
  return t >= startMs && t <= endMs;
}

