import { db } from './db';
import { STATUS_ORDER, PRIORITY_ORDER, TYPE_ORDER } from './ticketMeta';

const WINDOW_DAYS = 7;

function windowStart() {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - WINDOW_DAYS);
  return cutoff.toISOString().slice(0, 19).replace('T', ' ');
}

const SUMMARY_QUERY = `
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS c_open,
    SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS c_in_progress,
    SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) AS c_resolved,
    SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS c_closed,
    SUM(CASE WHEN t.priority = 'urgent' THEN 1 ELSE 0 END) AS c_urgent,
    SUM(CASE WHEN t.priority = 'high' THEN 1 ELSE 0 END) AS c_high,
    SUM(CASE WHEN t.priority = 'medium' THEN 1 ELSE 0 END) AS c_medium,
    SUM(CASE WHEN t.priority = 'low' THEN 1 ELSE 0 END) AS c_low,
    SUM(CASE WHEN t.type = 'task' THEN 1 ELSE 0 END) AS c_task,
    SUM(CASE WHEN t.type = 'bug' THEN 1 ELSE 0 END) AS c_bug,
    SUM(CASE WHEN t.type = 'story' THEN 1 ELSE 0 END) AS c_story,
    SUM(CASE WHEN t.type = 'epic' THEN 1 ELSE 0 END) AS c_epic,
    SUM(CASE WHEN t.employee_id IS NULL THEN 1 ELSE 0 END) AS c_unassigned,
    SUM(CASE WHEN t.created_at >= ? THEN 1 ELSE 0 END) AS c_created_recent,
    SUM(CASE WHEN t.updated_at >= ? THEN 1 ELSE 0 END) AS c_updated_recent,
    SUM(CASE WHEN t.status IN ('resolved', 'closed') AND t.updated_at >= ?
      THEN 1 ELSE 0 END) AS c_completed_recent
  FROM tickets t
  WHERE t.project_id = ?
    AND (? = 0 OR t.employee_id = ?)
`;

const PEOPLE_QUERY = `
  SELECT e.id, e.name, e.email, e.active,
    (SELECT COUNT(*) FROM tickets t
      WHERE t.employee_id = e.id AND t.project_id = ?) AS project_count
  FROM employees e
  WHERE e.active = 1
    AND EXISTS (
      SELECT 1 FROM tickets t WHERE t.employee_id = e.id AND t.project_id = ?
    )
  ORDER BY project_count DESC, e.name COLLATE NOCASE
`;

const ACTIVITY_QUERY = `
  SELECT t.id, t.title, t.status, t.priority, t.type, t.updated_at, t.created_at,
    creator.name AS created_by_name,
    assignee.name AS employee_name,
    assignee.id AS employee_id
  FROM tickets t
  JOIN users creator ON creator.id = t.created_by
  LEFT JOIN employees assignee ON assignee.id = t.employee_id
  WHERE t.project_id = ?
    AND (? = 0 OR t.employee_id = ?)
  ORDER BY t.updated_at DESC, t.id DESC
  LIMIT ?
`;

// Employee ids are auto-incremented from 1, so 0 is free to mean "unfiltered".
// A sentinel beats binding NULL because Postgres cannot infer a type for a bare
// `? IS NULL` and rejects the statement with SQLSTATE 42P18.
function assigneeScope(assigneeId) {
  const n = Number(assigneeId);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function num(value) {
  return Number(value || 0);
}

function shapeCounts(row, keys, prefix) {
  const out = {};
  for (const key of keys) out[key] = num(row[`${prefix}_${key}`]);
  return out;
}

export async function getProjectSummary(
  projectId,
  { activityLimit = 8, assigneeId = null } = {}
) {
  const id = Number(projectId);
  const cutoff = windowStart();

  const filter = assigneeScope(assigneeId);

  const row = await db
    .prepare(SUMMARY_QUERY)
    .get(cutoff, cutoff, cutoff, id, filter, filter);

  const people = await db.prepare(PEOPLE_QUERY).all(id, id);
  const activity = await db.prepare(ACTIVITY_QUERY).all(id, filter, filter, activityLimit);

  return {
    projectId: id,
    total: num(row?.total),
    windowDays: WINDOW_DAYS,
    byStatus: shapeCounts(row || {}, STATUS_ORDER, 'c'),
    byPriority: shapeCounts(row || {}, PRIORITY_ORDER, 'c'),
    byType: shapeCounts(row || {}, TYPE_ORDER, 'c'),
    metrics: {
      completed: num(row?.c_completed_recent),
      updated: num(row?.c_updated_recent),
      created: num(row?.c_created_recent),
      unassigned: num(row?.c_unassigned),
    },
    people,
    activity,
  };
}
