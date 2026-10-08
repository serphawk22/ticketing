import { db } from './db';
import { getActiveEmployees } from './employees';

/**
 * The daily timesheet, read and written.
 *
 * The answers are free text on purpose. The form replaces a Microsoft Forms
 * link where people picked a name and a project from a fixed list, and the
 * name is still the person's own pick. The project used to be a second fixed
 * list here too, but it now comes from the projects table (the page passes it
 * in) so the sheet offers exactly the projects the board knows about.
 * The sheet is shared as a link that works without signing in, so submitted_by
 * is merely who the app happened to know was on the other end of it -- the
 * name/project answers are the record.
 */

export const TASK_STATES = ['completed', 'not_completed'];

const SELECT = `
  SELECT s.id, s.submitted_by, s.name, s.project, s.hours_worked,
    s.task_title, s.task_description, s.task_state, s.linked_ticket_id,
    s.created_at, u.name AS submitted_by_name,
    t.project_id AS linked_project_id, p.key AS linked_key
  FROM task_sheet_submissions s
  LEFT JOIN users u ON u.id = s.submitted_by
  LEFT JOIN tickets t ON t.id = s.linked_ticket_id
  LEFT JOIN projects p ON p.id = t.project_id
`;

const ORDER = ' ORDER BY s.created_at DESC, s.id DESC';

export async function createSubmission({
  submittedBy,
  name,
  project,
  hoursWorked,
  taskTitle,
  taskDescription,
  taskState,
  linkedTicketId = null,
}) {
  const info = await db
    .prepare(
      `INSERT INTO task_sheet_submissions
         (submitted_by, name, project, hours_worked, task_title,
          task_description, task_state, linked_ticket_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      submittedBy,
      name,
      project,
      hoursWorked,
      taskTitle,
      taskDescription,
      taskState,
      linkedTicketId
    );

  return getSubmission(info.lastInsertRowid);
}

export async function getSubmission(id) {
  return db.prepare(`${SELECT} WHERE s.id = ?`).get(Number(id));
}

/**
 * Filters are optional and combined, so an admin can narrow to one person over
 * a date range without the caller having to know which of the three the answer
 * came from. `from`/`to` are bare YYYY-MM-DD, the same day-precision shape a
 * ticket's due date uses.
 */
export async function listSubmissions({ name, project, from, to, limit = 500 } = {}) {
  const where = [];
  const args = [];

  if (name) {
    where.push('s.name = ?');
    args.push(name);
  }
  if (project) {
    where.push('s.project = ?');
    args.push(project);
  }
  if (from) {
    where.push('date(s.created_at) >= date(?)');
    args.push(from);
  }
  if (to) {
    where.push('date(s.created_at) <= date(?)');
    args.push(to);
  }

  const sql = `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}${ORDER} LIMIT ?`;
  return db.prepare(sql).all(...args, Math.min(Number(limit) || 500, 2000));
}

/**
 * The distinct people and projects seen so far, to populate the filters.
 *
 * The people list is the active roster (the same names the sheet's own dropdown
 * offers) unioned with any extra names that came in through a shared-link
 * submission. A name filter that only listed people who had already filled in
 * would hide the names of the people who had not -- the exact people an admin
 * most wants to find.
 */
export async function listSubmissionFacets() {
  // Postgres refuses ORDER BY on an expression that is not itself in the
  // select list when DISTINCT is in play, so the list comes back unordered and
  // the sort is done here where it is guaranteed to behave the same on every
  // database.
  const names = await db
    .prepare(
      'SELECT DISTINCT name FROM task_sheet_submissions WHERE name <> \'\''
    )
    .all();
  const seen = new Set(names.map((r) => r.name));
  for (const e of await getActiveEmployees()) {
    if (e.name) seen.add(e.name);
  }
  const allNames = [...seen].filter(Boolean).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
  const projects = await db
    .prepare(
      'SELECT DISTINCT project FROM task_sheet_submissions WHERE project <> \'\''
    )
    .all();

  return {
    names: allNames,
    projects: projects.map((r) => r.project).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    ),
  };
}

/**
 * Resolve a typed task number against the tickets that already exist.
 *
 * Only an exact `${projectKey}-${id}` match counts. A fuzzy match would attach
 * the wrong work item to a timesheet line, which is worse than attaching
 * nothing, so anything else stays free text.
 */
export async function findTicketByKey(key) {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(String(key || '').trim());
  if (!m) return null;

  const row = await db
    .prepare(
      `SELECT t.id, t.title, p.key AS project_key
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.id = ? AND LOWER(COALESCE(p.key, 'tm')) = LOWER(?)`
    )
    .get(Number(m[2]), m[1]);

  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    key: `${(row.project_key || 'TM').toUpperCase()}-${row.id}`,
  };
}
