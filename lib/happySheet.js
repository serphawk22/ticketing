import { db } from './db';
import { getActiveEmployees } from './employees';

/**
 * The happy sheet, the day's positive note that rides under the task sheet on
 * the same page.
 *
 * Two free-text questions -- what made your day happy, and whether you made
 * somebody else happy -- with no scoring and no right answers. It is filed on
 * its own row because it stands on its own: a person can answer it without
 * being dragged through the timesheet, and an admin can read the team's mood
 * without wading through hours. Like the task sheet, the link works without
 * signing up, so submitted_by is whoever the server happened to know was on the
 * other end of it, NULL when it was an anonymous share.
 */

const SELECT = `
  SELECT h.id, h.submitted_by, h.name, h.happy_one, h.happy_others,
    h.created_at, u.name AS submitted_by_name
  FROM happy_sheet_submissions h
  LEFT JOIN users u ON u.id = h.submitted_by
`;

const ORDER = ' ORDER BY h.created_at DESC, h.id DESC';

export async function createHappySubmission({ submittedBy, name, happyOne, happyOthers }) {
  const info = await db
    .prepare(
      `INSERT INTO happy_sheet_submissions
         (submitted_by, name, happy_one, happy_others)
       VALUES (?, ?, ?, ?)`
    )
    .run(submittedBy, name, happyOne, happyOthers);

  return getHappySubmission(info.lastInsertRowid);
}

export async function getHappySubmission(id) {
  return db.prepare(`${SELECT} WHERE h.id = ?`).get(Number(id));
}

/**
 * The first day of next month, as YYYY-MM-DD, so a month filter becomes a
 * half-open range in both dialects instead of a STRFTIME/TO_CHAR call that
 * only one of them understands.
 */
function monthRange(month) {
  const [y, m] = String(month).split('-').map(Number);
  const endY = m === 12 ? y + 1 : y;
  const endM = m === 12 ? 1 : m + 1;
  const pad = (n) => String(n).padStart(2, '0');
  return { start: `${y}-${pad(m)}-01`, end: `${endY}-${pad(endM)}-01` };
}

/**
 * Filters combine the way the task sheet's do, with one month selector added:
 * a YYYY-MM value narrows to that calendar month (plus the same day range
 * still applies on top if both are set). Everything is applied in the query
 * layer rather than in the browser, because the month check needs the clock to
 * know where the month ends.
 */
export async function listHappySubmissions({ name, month, day, from, to, limit = 500 } = {}) {
  const where = [];
  const args = [];

  if (name) {
    where.push('h.name = ?');
    args.push(name);
  }
  if (day) {
    // A single day set on top of the month (or on its own): an exact date, so
    // an admin who wants one day's answers gets exactly those and nothing else.
    where.push('date(h.created_at) = date(?)');
    args.push(day);
  }
  if (month) {
    const { start, end } = monthRange(month);
    where.push('date(h.created_at) >= date(?)');
    args.push(start);
    where.push('date(h.created_at) < date(?)');
    args.push(end);
  }
  if (from) {
    where.push('date(h.created_at) >= date(?)');
    args.push(from);
  }
  if (to) {
    where.push('date(h.created_at) <= date(?)');
    args.push(to);
  }

  const sql = `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}${ORDER} LIMIT ?`;
  return db.prepare(sql).all(...args, Math.min(Number(limit) || 500, 2000));
}

/**
 * The names to populate the filter with: the active roster plus any names that
 * only appeared through a shared-link submission, so someone who has never
 * filled in still shows up the way the task sheet's own name list shows them.
 */
export async function listHappyFacets() {
  const names = await db
    .prepare(
      'SELECT DISTINCT name FROM happy_sheet_submissions WHERE name <> \'\''
    )
    .all();
  const seen = new Set(names.map((r) => r.name));
  for (const e of await getActiveEmployees()) {
    if (e.name) seen.add(e.name);
  }
  const allNames = [...seen].filter(Boolean).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
  return { names: allNames };
}