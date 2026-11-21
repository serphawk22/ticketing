import { db } from './db.js';
import { toKolkata, calculateDurationsBetween } from './businessHours.js';
import { loadScheduleContext } from './businessScheduleService.js';
import { parseUtcDate as parseIstUtcDate, resolveDateRange } from './dateFilters.js';
import { assertCanViewEmployee, assertCanViewProject, isAdminOrOwner, isManager, resolveUserScope } from './rbac.js';
import { getAttendanceReconciliation } from './reconciliation.js';
import { todayKolkataDate } from './workLedger.js';
import { toSafeEmployee } from './employees.js';

function num(v) {
  return Number(v || 0);
}

/**
 * Resolves explicit date boundaries `[fromDate, toDate]` (`YYYY-MM-DD`) in IST (`Asia/Kolkata`)
 * either from explicit params or preset (`this_week`, `this_month`, `last_30_days`, etc.).
 */
export function resolveMonitoringWindow({ from = null, to = null, preset = 'this_month' } = {}) {
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const customRange = resolveDateRange({ preset: 'custom', startDate: from, endDate: to });
    };
  }
  const today = todayKolkataDate();
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 29);
  const defaultFrom = d.toISOString().slice(0, 10);
  return {
    fromDate: defaultFrom,
    toDate: today,
    startUtc: `${defaultFrom} 00:00:00`,
    endUtc: `${today} 23:59:59`,
    startMs: null,
    endMs: null,
