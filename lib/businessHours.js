/**
 * lib/businessHours.js
 *
 * Core Business Hours Engine for Serp Hawk Ticketing System.
 *
 * Rules:
 * - Schedule: Monday through Saturday, 9:00 AM to 5:00 PM (8 working hours/day).
 * - Off days: Sunday is an official holiday (0 working hours).
 * - Timezone: Asia/Kolkata (UTC+05:30, constant +19,800,000 ms, no DST).
 * - Duration: 1 working day = 8 hours = 28,800 seconds.
 * - SLA Defaults:
 *     Urgent = 4 business hours
 *     High   = 8 business hours
 *     Medium = 24 business hours (3 working days)
 *     Low / Other = 24 business hours
 * - Explicit Due Dates: Interpreted as 5:00 PM Asia/Kolkata on specified date.
 *     Effective deadline is min(priority-based SLA deadline, explicit due date).
 */

export const BUSINESS_HOURS_CONFIG = {
  TIMEZONE: 'Asia/Kolkata',
  KOLKATA_OFFSET_MS: 5.5 * 3600 * 1000, // UTC+05:30
  WORK_START_HOUR: 9,
  WORK_END_HOUR: 17,
  WORK_START_SECONDS: 9 * 3600,   // 32,400s (9:00 AM)
  WORK_END_SECONDS: 17 * 3600,    // 61,200s (5:00 PM)
  BUSINESS_SECONDS_PER_DAY: 8 * 3600, // 28,800s
  DEFAULT_SLA_HOURS: {
    urgent: 4,
    high: 8,
    medium: 24,
    low: 24,
  },
};

/**
 * Safely parse any date representation into a valid UTC Date object.
 * Handles ISO strings, SQLite 'YYYY-MM-DD HH:MM:SS' strings, epoch ms, and Date objects.
 */
export function parseUtcDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const str = String(value).trim();
  if (!str) return null;

  // Date-only string 'YYYY-MM-DD'
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return new Date(`${str}T00:00:00.000Z`);
  }
  // SQLite 'YYYY-MM-DD HH:MM:SS' without timezone -> append Z for UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(str)) {
    return new Date(str.replace(' ', 'T') + 'Z');
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Convert UTC Date to an Asia/Kolkata calendar projection.
 * Access fields using UTC getters on the returned Date (e.g. getUTCDay(), getUTCHours()).
 */
export function toKolkata(date) {
  const d = parseUtcDate(date);
  if (!d) return null;
  return new Date(d.getTime() + BUSINESS_HOURS_CONFIG.KOLKATA_OFFSET_MS);
}

/**
 * Convert an Asia/Kolkata calendar projection back to standard UTC Date.
 */
export function fromKolkata(kolkataDate) {
  if (!kolkataDate) return null;
  return new Date(kolkataDate.getTime() - BUSINESS_HOURS_CONFIG.KOLKATA_OFFSET_MS);
}

/**
 * Returns true if the day is a working day (Monday=1 through Saturday=6).
 * Sunday=0 is the official weekend/holiday.
 */
export function isWorkingDay(date) {
  const kd = toKolkata(date);
  if (!kd) return false;
  return kd.getUTCDay() !== 0;
}

/**
 * Returns true if the given timestamp falls strictly within business hours:
 * Monday–Saturday, 09:00:00 to 17:00:00 Asia/Kolkata.
 */
export function isWithinBusinessHours(date) {
  const kd = toKolkata(date);
  if (!kd) return false;
  if (kd.getUTCDay() === 0) return false; // Sunday off
  const sec = kd.getUTCHours() * 3600 + kd.getUTCMinutes() * 60 + kd.getUTCSeconds();
  return sec >= BUSINESS_HOURS_CONFIG.WORK_START_SECONDS && sec <= BUSINESS_HOURS_CONFIG.WORK_END_SECONDS;
}

/**
 * Calculate the total business seconds elapsed between two timestamps.
 * 
 * Mathematical formula:
 * T_business = sum_{d=1}^n max(0, min(E_d, W_e) - max(S_d, W_s))
 * where:
 *   W_s = 9:00 AM (32,400s)
 *   W_e = 5:00 PM (61,200s)
 *   Sunday is skipped (0s).
 */
export function calculateBusinessSeconds(startDateInput, endDateInput) {
  const startDate = parseUtcDate(startDateInput);
  const endDate = parseUtcDate(endDateInput);
  if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) {
    return 0;
  }

  const kStart = toKolkata(startDate);
  const kEnd = toKolkata(endDate);

  const curStartDay = new Date(Date.UTC(kStart.getUTCFullYear(), kStart.getUTCMonth(), kStart.getUTCDate(), 0, 0, 0));
  const endDay = new Date(Date.UTC(kEnd.getUTCFullYear(), kEnd.getUTCMonth(), kEnd.getUTCDate(), 0, 0, 0));

  let cur = curStartDay;
  let totalSec = 0;

  while (cur.getTime() <= endDay.getTime()) {
    // Exclude Sundays
    if (cur.getUTCDay() !== 0) {
      const isStartDay = cur.getTime() === curStartDay.getTime();
      const isEndDay = cur.getTime() === endDay.getTime();

      const sSec = isStartDay
        ? (kStart.getUTCHours() * 3600 + kStart.getUTCMinutes() * 60 + kStart.getUTCSeconds())
        : 0;
      const eSec = isEndDay
        ? (kEnd.getUTCHours() * 3600 + kEnd.getUTCMinutes() * 60 + kEnd.getUTCSeconds())
        : 86400;

      const overlap = Math.max(
        0,
        Math.min(eSec, BUSINESS_HOURS_CONFIG.WORK_END_SECONDS) -
        Math.max(sSec, BUSINESS_HOURS_CONFIG.WORK_START_SECONDS)
      );
      totalSec += overlap;
    }
    cur = new Date(cur.getTime() + 86400000);
  }

  return totalSec;
}

/**
 * Calculate the business hours between two timestamps as hours, minutes, and formatted string.
 */
export function getBusinessHoursBetween(startDateInput, endDateInput) {
  const seconds = calculateBusinessSeconds(startDateInput, endDateInput);
  const hours = Number((seconds / 3600).toFixed(2));
  const minutes = Math.round(seconds / 60);
  return { seconds, hours, minutes };
}

/**
 * Calculate the SLA deadline given a start timestamp and target business hours.
 * Advances strictly during Mon-Sat 9:00-17:00 Asia/Kolkata, pausing overnight and Sundays.
 */
export function calculateSlaDeadline(startDateInput, targetBusinessHours) {
  const startDate = parseUtcDate(startDateInput);
  if (!startDate) return null;

  let remainingSec = Math.round(Number(targetBusinessHours || 0) * 3600);
  if (remainingSec <= 0) return startDate;

  let k = toKolkata(startDate);

  // If created on Sunday, advance clock to Monday 09:00 AM
  while (k.getUTCDay() === 0) {
    k = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + 1, 9, 0, 0));
  }

  // If created before 9:00 AM on a working day, clock starts at 9:00 AM
  if (k.getUTCHours() < BUSINESS_HOURS_CONFIG.WORK_START_HOUR) {
    k = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), 9, 0, 0));
  }
  // If created at or after 5:00 PM on a working day, clock starts at 9:00 AM of next working day
  else if (k.getUTCHours() >= BUSINESS_HOURS_CONFIG.WORK_END_HOUR) {
    let next = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + 1, 9, 0, 0));
    while (next.getUTCDay() === 0) {
      next = new Date(next.getTime() + 86400000);
    }
    k = next;
  }

  // Consume remaining business seconds within working day boundaries
  while (remainingSec > 0) {
    const secOfDay = k.getUTCHours() * 3600 + k.getUTCMinutes() * 60 + k.getUTCSeconds();
    const availInDay = BUSINESS_HOURS_CONFIG.WORK_END_SECONDS - secOfDay;

    if (remainingSec <= availInDay) {
      k = new Date(k.getTime() + remainingSec * 1000);
      remainingSec = 0;
    } else {
      remainingSec -= availInDay;
      // Advance to 09:00 AM of next working day
      let next = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + 1, 9, 0, 0));
      while (next.getUTCDay() === 0) {
        next = new Date(next.getTime() + 86400000);
      }
      k = next;
    }
  }

  return fromKolkata(k);
}

/**
 * Parses an explicit due date string.
 * For date-only due dates ('YYYY-MM-DD'), sets the deadline to 5:00 PM Asia/Kolkata
 * on that date (which corresponds to 11:30:00 UTC).
 */
export function parseExplicitDueDate(dueDateStr) {
  if (!dueDateStr) return null;
  const str = String(dueDateStr).trim();
  if (!str) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    // 17:00:00 in Asia/Kolkata (+05:30) is 11:30:00 UTC
    return new Date(`${str}T11:30:00.000Z`);
  }
  return parseUtcDate(str);
}

/**
 * Computes the effective SLA deadline for a ticket:
 * min(priority-based SLA deadline, explicit due date deadline).
 */
export function getEffectiveSlaDeadline(ticket) {
  if (!ticket) return null;
  const priority = String(ticket.priority || 'medium').toLowerCase();
  const slaHours = BUSINESS_HOURS_CONFIG.DEFAULT_SLA_HOURS[priority] ?? 24;

  const priorityDeadline = calculateSlaDeadline(ticket.created_at, slaHours);
  const explicitDeadline = parseExplicitDueDate(ticket.due_date);

  if (explicitDeadline && priorityDeadline) {
    return explicitDeadline.getTime() < priorityDeadline.getTime()
      ? explicitDeadline
      : priorityDeadline;
  }
  return priorityDeadline || explicitDeadline;
}

/**
 * Calculates verified cycle time spent in `in_progress` status using `ticket_activity` records.
 * If status transition history is incomplete or missing, marks as estimated / unavailable.
 */
export function calculateCycleTimeFromActivities(ticket, ticketActivities = [], nowMs = Date.now()) {
  const statusEvents = ticketActivities
    .filter((a) => Number(a.ticket_id) === Number(ticket.id) && a.field === 'status')
    .sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return ta === tb ? (Number(a.id) - Number(b.id)) : (ta - tb);
    });

  let totalBusinessSeconds = 0;
  let inProgressStart = null;
  let hasVerifiedHistory = false;

  for (const ev of statusEvents) {
    const fromStatus = ev.from_value;
    const toStatus = ev.to_value;
    const evTime = parseUtcDate(ev.created_at);

    if (toStatus === 'in_progress') {
      hasVerifiedHistory = true;
      inProgressStart = evTime;
    } else if (fromStatus === 'in_progress') {
      hasVerifiedHistory = true;
      if (inProgressStart && evTime) {
        totalBusinessSeconds += calculateBusinessSeconds(inProgressStart, evTime);
        inProgressStart = null;
      }
    }
  }

  // If ticket is currently in_progress, calculate business hours through nowMs
  if (ticket.status === 'in_progress') {
    const currentStart = inProgressStart || parseUtcDate(ticket.start_date || ticket.created_at);
    if (currentStart) {
      hasVerifiedHistory = true;
      totalBusinessSeconds += calculateBusinessSeconds(currentStart, new Date(nowMs));
    }
  }

  const startMs = new Date(ticket.start_date || ticket.created_at || nowMs).getTime();
  const finishMs = new Date(ticket.updated_at || ticket.created_at || nowMs).getTime();
  const calendarDays = Math.max(1, Math.round((finishMs - startMs) / 86400000));

  if (!hasVerifiedHistory) {
    return {
      hasVerifiedHistory: false,
      businessSeconds: 0,
      businessDays: 0,
      calendarDays,
      status: 'unavailable',
    };
  }

  const businessDays = Number((totalBusinessSeconds / BUSINESS_HOURS_CONFIG.BUSINESS_SECONDS_PER_DAY).toFixed(1));

  return {
    hasVerifiedHistory: true,
    businessSeconds: totalBusinessSeconds,
    businessDays,
    calendarDays,
    status: 'verified',
  };
}


/**
 * Calculates Turnaround Business Time from ticket creation to resolution/closure.
 * - Uses Monday–Saturday, 9:00 AM–5:00 PM Asia/Kolkata (excluding Sundays & nights).
 * - Extracts actual closure timestamp from `ticket_activity` (status -> resolved/closed).
 * - If ticket is ongoing/unresolved, calculates through `nowMs` with '(Ongoing)'.
 * - If ticket is closed but has missing activity records, marks '(Unverified history)'.
 */
export function calculateTicketTurnaround(ticket, ticketActivities = [], nowMs = Date.now()) {
  const start = parseUtcDate(ticket.created_at);
  if (!start) {
    return {
      seconds: 0,
      isClosed: false,
      isOngoing: false,
      isVerified: false,
    };
  }

  const isClosed = ['resolved', 'closed'].includes(String(ticket.status || '').toLowerCase());

  if (isClosed) {
    const closureEvents = ticketActivities
      .filter(
        (a) =>
          Number(a.ticket_id) === Number(ticket.id) &&
          a.field === 'status' &&
          ['resolved', 'closed'].includes(String(a.to_value || '').toLowerCase())
      )
      .sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        return ta === tb ? Number(a.id) - Number(b.id) : ta - tb;
      });

    if (closureEvents.length > 0) {
      const latestClosure = closureEvents[closureEvents.length - 1];
      const end = parseUtcDate(latestClosure.created_at);
      const seconds = calculateBusinessSeconds(start, end);
      return {
        seconds,
        isClosed: true,
        isOngoing: false,
        isVerified: true,
      };
    }

    // Closed in ticket.status, but historical activity transition is missing
    const fallbackEnd = parseUtcDate(ticket.updated_at || ticket.created_at);
    const seconds = calculateBusinessSeconds(start, fallbackEnd);
    return {
      seconds,
      isClosed: true,
      isOngoing: false,
      isVerified: false,
    };
  }

  // Ticket is ongoing / unresolved
  const end = new Date(nowMs);
  const seconds = calculateBusinessSeconds(start, end);
  return {
    seconds,
    isClosed: false,
    isOngoing: true,
    isVerified: true,
  };
}
