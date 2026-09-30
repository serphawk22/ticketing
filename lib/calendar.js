/**
 * Date helpers for the project calendar.
 *
 * A ticket's `due_date` is a bare `YYYY-MM-DD` string or null, and the API
 * rejects anything else, so everything here speaks that format and never a
 * `Date` object. Dates are built at UTC midnight and formatted with UTC
 * getters, because the server and the browser can sit in different time zones
 * and a local-midnight date would render as the previous day on one of them.
 *
 * The grid is a five-day work week: Saturday and Sunday never appear, so a
 * month takes five or six rows depending on where the 1st lands.
 */

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Monday = 0 ... Sunday = 6. A plain %7 would make Sunday 0 and push every
// week one day to the right.
const mondayIndex = (date) => (date.getUTCDay() + 6) % 7;

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** A Date at UTC midnight for a `YYYY-MM-DD` string. */
export function dateFromISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** A `YYYY-MM-DD` string for a Date, read in UTC. */
export function toISO(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function addDays(date, days) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

export function addMonths(year, month, delta) {
  // Normalising through Date.UTC rolls 12 -> next January on its own.
  const d = new Date(Date.UTC(year, month + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

/** The Monday on or before `date`. */
function mondayOnOrBefore(date) {
  return addDays(date, -mondayIndex(date));
}

/** The first day of the month, at UTC midnight. */
function firstOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 1));
}

function lastOfMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0));
}

/**
 * The five-day weeks that cover `month`, as rows of `YYYY-MM-DD` strings.
 *
 * The first week starts on the Monday on or before the 1st, and rows continue
 * for seven days at a time until the month is covered. That means the grid
 * opens on the previous month's last weekday and closes on the next month's
 * first weekday, which is what makes the out-of-month cells at each end
 * meaningful rather than decorative.
 */
export function buildMonthGrid(year, month) {
  const last = lastOfMonth(year, month);
  const weeks = [];
  let weekStart = mondayOnOrBefore(firstOfMonth(year, month));

  while (weekStart <= last) {
    const week = [];
    for (let i = 0; i < 5; i += 1) week.push(toISO(addDays(weekStart, i)));
    weeks.push(week);
    weekStart = addDays(weekStart, 7);
  }

  return weeks;
}

/**
 * The single week containing `iso`, as five `YYYY-MM-DD` strings.
 *
 * The week view deliberately follows the same Monday-to-Friday shape as the
 * month view, so a drag between the two views cannot land a ticket on a day
 * the other view would never show.
 */
export function buildWeekGrid(iso) {
  const start = mondayOnOrBefore(dateFromISO(iso));
  const week = [];
  for (let i = 0; i < 5; i += 1) week.push(toISO(addDays(start, i)));
  return [week];
}

/** "Sep 2026" for the toolbar, or "28 Sep – 2 Oct" for the week view. */
export function monthLabel(year, month) {
  // The full month name, which is what Jira puts in the month header. The
  // week header stays abbreviated, because there the month is one word inside
  // a date range and the space is better spent on the days.
  return `${MONTH_LABELS[month]} ${year}`;
}

const dayOfMonth = (iso) => Number(iso.slice(8, 10));

export function weekLabel(week) {
  const first = week[0];
  const last = week[week.length - 1];
  const a = dateFromISO(first);
  const b = dateFromISO(last);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  const monthName = MONTH_LABELS[a.getUTCMonth()].slice(0, 3);

  if (sameMonth) return `${dayOfMonth(first)} – ${dayOfMonth(last)} ${monthName}`;
  return `${dayOfMonth(first)} ${monthName} – ${dayOfMonth(last)} ${MONTH_LABELS[b.getUTCMonth()].slice(0, 3)}`;
}

/**
 * The custom drag type the calendar uses to carry a ticket id.
 *
 * A drop target has to decide whether it will accept a drag from its payload,
 * because the React state that tracks the in-flight ticket may not have
 * rendered yet when the first dragover arrives. A private type is also what
 * keeps a drag of selected text from being read as a ticket, which a bare
 * "text/plain" check would happily do.
 */
export const TICKET_DRAG_TYPE = 'application/x-ticket-id';

/**
 * Group tickets into `YYYY-MM-DD -> [ticket]` for the days a grid covers.
 *
 * A ticket whose due date is null, empty, or not a real `YYYY-MM-DD` is left
 * out entirely: it belongs in the unscheduled panel, and a malformed value
 * must not silently disappear from the calendar without appearing there
 * either. `dueDatesOf` is how the caller tells the two apart, so both sides
 * read the same field the same way.
 */
export function bucketByDueDate(tickets) {
  const buckets = new Map();
  for (const t of tickets) {
    const iso = normalizeDueDate(t.due_date);
    if (!iso) continue;
    if (!buckets.has(iso)) buckets.set(iso, []);
    buckets.get(iso).push(t);
  }
  return buckets;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A due date only if it is a real calendar day.
 *
 * `2026-02-31` is well-formed but does not exist, and `new Date` would roll it
 * into March, so the round trip is what rules those out.
 */
export function normalizeDueDate(value) {
  const text = String(value ?? '').trim();
  if (!ISO_RE.test(text)) return null;
  const d = dateFromISO(text);
  if (Number.isNaN(d.getTime())) return null;
  return toISO(d) === text ? text : null;
}

export function isWeekendISO(iso) {
  const day = dateFromISO(iso).getUTCDay();
  return day === 0 || day === 6;
}
