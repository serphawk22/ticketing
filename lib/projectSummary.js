import { db } from './db.js';
import { STATUS_ORDER, PRIORITY_ORDER, TYPE_ORDER } from './ticketMeta.js';
import { getEffectiveStagesForTickets } from './monitoring.js';

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

  const [row, people, activity, workLogByEmp, workLogByCat, ticketIds] = await Promise.all([
    db.prepare(SUMMARY_QUERY).get(cutoff, cutoff, cutoff, id, filter, filter),
    db.prepare(PEOPLE_QUERY).all(id, id),
    db.prepare(ACTIVITY_QUERY).all(id, filter, filter, activityLimit),
    db
      .prepare(
        `SELECT ewl.employee_id, e.name AS employee_name, COALESCE(SUM(ewl.duration_minutes), 0) AS total_minutes
         FROM employee_work_logs ewl
         JOIN employees e ON e.id = ewl.employee_id
         WHERE ewl.project_id = ? AND (? = 0 OR ewl.employee_id = ?)
         GROUP BY ewl.employee_id, e.name
         ORDER BY total_minutes DESC`
      )
      .all(id, filter, filter),
    db
      .prepare(
        `SELECT ewl.category_code, COALESCE(wc.label, ewl.category_code) AS label,
                COALESCE(SUM(ewl.duration_minutes), 0) AS total_minutes
         FROM employee_work_logs ewl
         LEFT JOIN work_categories wc ON wc.code = ewl.category_code
         WHERE ewl.project_id = ? AND (? = 0 OR ewl.employee_id = ?)
         GROUP BY ewl.category_code, wc.label
         ORDER BY total_minutes DESC`
      )
      .all(id, filter, filter),
    db
      .prepare('SELECT id FROM tickets WHERE project_id = ? AND (? = 0 OR employee_id = ?)')
      .all(id, filter, filter),
  ]);

  const stages = await getEffectiveStagesForTickets(ticketIds.map((t) => t.id));
  const stageMap = {};
  for (const st of stages) {
    if (!stageMap[st.status]) {
      stageMap[st.status] = {
        status: st.status,
        label: st.stageLabel || st.status,
        visitCount: 0,
        totalCalendarSeconds: 0,
        totalBusinessSeconds: 0,
      };
    }
    stageMap[st.status].visitCount += 1;
    stageMap[st.status].totalCalendarSeconds += st.calendarSeconds;
    stageMap[st.status].totalBusinessSeconds += st.businessSeconds;
  }

  const totalLoggedMinutes = workLogByEmp.reduce((s, r) => s + num(r.total_minutes), 0);

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
    loggedWork: {
      totalMinutes: totalLoggedMinutes,
      totalHours: Math.round((totalLoggedMinutes / 60) * 100) / 100,
      byEmployee: workLogByEmp.map((r) => ({
        employeeId: Number(r.employee_id),
        employeeName: r.employee_name,
        minutes: num(r.total_minutes),
      })),
      byCategory: workLogByCat.map((r) => ({
        code: r.category_code,
        label: r.label,
        minutes: num(r.total_minutes),
      })),
    },
    stageDurations: Object.values(stageMap).map((s) => ({
      ...s,
      avgCalendarSeconds: s.visitCount > 0 ? Math.round(s.totalCalendarSeconds / s.visitCount) : 0,
      avgBusinessSeconds: s.visitCount > 0 ? Math.round(s.totalBusinessSeconds / s.visitCount) : 0,
    })),
  };
}
