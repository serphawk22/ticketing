import { db } from './db.js';

/**
 * Calculates verified numerical statistics directly from the database
 * for either a specific project or the entire organization.
 *
 * @param {number|string|null} projectId - Project ID, or 'all'/null for overall organization.
 * @returns {Promise<{
 *   scopeType: 'overall' | 'project',
 *   projectId: number | null,
 *   projectName: string,
 *   projectKey: string,
 *   metrics: {
 *     total: number,
 *     byStatus: { open: number, in_progress: number, resolved: number, closed: number },
 *     completionRate: number,
 *     byPriority: { urgent: number, high: number, medium: number, low: number },
 *     byType: { task: number, bug: number, story: number, epic: number },
 *     overdueCount: number,
 *     unassignedCount: number,
 *     recentCreated: number,
 *     recentCompleted: number,
 *     totalLoggedHours: number
 *   },
 *   activeBlockers: Array<{ source: string, text: string, date?: string }>,
 *   criticalTickets: Array<{ id: number, key: string, title: string, priority: string, status: string, dueDate: string, assignee: string }>
 * }>}
 */
export async function getVerifiedProjectMetrics(projectId) {
  const isOverall = !projectId || projectId === 'all';
  const numericProjectId = isOverall ? null : Number(projectId);

  // 1. Resolve project details if single project
  let projectName = 'All Projects (Organization-wide)';
  let projectKey = 'ALL';
  let projectDescription = '';

  if (!isOverall) {
    const proj = await db
      .prepare('SELECT id, key, name, description FROM projects WHERE id = ?')
      .get(numericProjectId);
    if (!proj) {
      throw new Error(`Project with ID ${numericProjectId} not found.`);
    }
    projectName = proj.name;
    projectKey = proj.key;
    projectDescription = proj.description || '';
  }

  // 2. Query tickets with pure DB-level aggregation
  let ticketSql = `
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
      SUM(CASE WHEN t.employee_id IS NULL AND t.assigned_to IS NULL THEN 1 ELSE 0 END) AS c_unassigned
    FROM tickets t
    WHERE t.archived = 0
  `;
  const ticketParams = [];
  if (!isOverall) {
    ticketSql += ' AND t.project_id = ?';
    ticketParams.push(numericProjectId);
  }

  const row = (await db.prepare(ticketSql).get(...ticketParams)) || {};

  const total = Number(row.total || 0);
  const cOpen = Number(row.c_open || 0);
  const cInProgress = Number(row.c_in_progress || 0);
  const cResolved = Number(row.c_resolved || 0);
  const cClosed = Number(row.c_closed || 0);
  const completed = cResolved + cClosed;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  // 3. Query overdue & urgent items (verified)
  const todayIso = new Date().toISOString().slice(0, 10);
  let overdueSql = `
    SELECT t.id, t.title, t.priority, t.status, t.due_date, p.key AS project_key,
           COALESCE(e.name, u.name, 'Unassigned') AS assignee_name
    FROM tickets t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN employees e ON e.id = t.employee_id
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.archived = 0
      AND t.status NOT IN ('resolved', 'closed')
      AND (
        (t.due_date IS NOT NULL AND t.due_date != '' AND t.due_date < ?)
        OR t.priority = 'urgent'
      )
  `;
  const overdueParams = [todayIso];
  if (!isOverall) {
    overdueSql += ' AND t.project_id = ?';
    overdueParams.push(numericProjectId);
  }
  overdueSql += ' ORDER BY CASE WHEN t.priority = \'urgent\' THEN 1 ELSE 2 END, t.due_date ASC LIMIT 10';

  const criticalRows = await db.prepare(overdueSql).all(...overdueParams);

  // Count total overdue
  let overdueCountSql = `
    SELECT COUNT(*) AS count
    FROM tickets t
    WHERE t.archived = 0
      AND t.status NOT IN ('resolved', 'closed')
      AND t.due_date IS NOT NULL
      AND t.due_date != ''
      AND t.due_date < ?
  `;
  const overdueCountParams = [todayIso];
  if (!isOverall) {
    overdueCountSql += ' AND t.project_id = ?';
    overdueCountParams.push(numericProjectId);
  }
  const overdueCountRow = await db.prepare(overdueCountSql).get(...overdueCountParams);
  const overdueCount = Number(overdueCountRow?.count || 0);

  // 4. Recent Velocity (last 14 days)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  let velocitySql = `
    SELECT
      SUM(CASE WHEN t.created_at >= ? THEN 1 ELSE 0 END) AS recent_created,
      SUM(CASE WHEN t.status IN ('resolved', 'closed') AND t.updated_at >= ? THEN 1 ELSE 0 END) AS recent_completed
    FROM tickets t
    WHERE t.archived = 0
  `;
  const velocityParams = [fourteenDaysAgo, fourteenDaysAgo];
  if (!isOverall) {
    velocitySql += ' AND t.project_id = ?';
    velocityParams.push(numericProjectId);
  }
  const velRow = (await db.prepare(velocitySql).get(...velocityParams)) || {};
  const recentCreated = Number(velRow.recent_created || 0);
  const recentCompleted = Number(velRow.recent_completed || 0);

  // 5. Logged Work Hours
  let timeSql = `
    SELECT COALESCE(SUM(COALESCE(tl.seconds, 0) + COALESCE(tl.duration_minutes, 0) * 60), 0) AS total_seconds
    FROM ticket_time_logs tl
    JOIN tickets t ON t.id = tl.ticket_id
    WHERE t.archived = 0
  `;
  const timeParams = [];
  if (!isOverall) {
    timeSql += ' AND t.project_id = ?';
    timeParams.push(numericProjectId);
  }
  const timeRow = await db.prepare(timeSql).get(...timeParams);
  const totalLoggedHours = Math.round((Number(timeRow?.total_seconds || 0) / 3600) * 10) / 10;

  // 6. Recent Active Blockers (from task sheets)
  let blockersSql = `
    SELECT ts.name, ts.created_at, ts.blocker
    FROM task_sheet_submissions ts
    WHERE ts.blocker IS NOT NULL
      AND TRIM(ts.blocker) != ''
      AND ts.created_at >= ?
  `;
  const blockerParams = [fourteenDaysAgo];
  if (!isOverall && projectName) {
    blockersSql += ' AND (LOWER(ts.project) LIKE ? OR LOWER(ts.project) LIKE ?)';
    blockerParams.push(`%${projectName.toLowerCase()}%`, `%${projectKey.toLowerCase()}%`);
  }
  blockersSql += ' ORDER BY ts.created_at DESC LIMIT 6';

  const blockerRows = await db.prepare(blockersSql).all(...blockerParams);

  const activeBlockers = (blockerRows || []).map((b) => ({
    source: b.name || 'Team Member',
    date: (b.created_at || '').slice(0, 10),
    text: String(b.blocker).slice(0, 180),
  }));

  const criticalTickets = (criticalRows || []).map((t) => ({
    id: t.id,
    key: `${t.project_key || 'TM'}-${t.id}`,
    title: t.title,
    priority: t.priority,
    status: t.status,
    dueDate: t.due_date || 'None',
    assignee: t.assignee_name,
  }));

  return {
    scopeType: isOverall ? 'overall' : 'project',
    projectId: numericProjectId,
    projectName,
    projectKey,
    projectDescription,
    metrics: {
      total,
      byStatus: {
        open: cOpen,
        in_progress: cInProgress,
        resolved: cResolved,
        closed: cClosed,
      },
      completionRate,
      byPriority: {
        urgent: Number(row.c_urgent || 0),
        high: Number(row.c_high || 0),
        medium: Number(row.c_medium || 0),
        low: Number(row.c_low || 0),
      },
      byType: {
        task: Number(row.c_task || 0),
        bug: Number(row.c_bug || 0),
        story: Number(row.c_story || 0),
        epic: Number(row.c_epic || 0),
      },
      overdueCount,
      unassignedCount: Number(row.c_unassigned || 0),
      recentCreated,
      recentCompleted,
      totalLoggedHours,
    },
    activeBlockers,
    criticalTickets,
  };
}
