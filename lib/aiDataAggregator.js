import { db } from './db.js';

/**
 * Strips HTML tags, trims excessive whitespace, and truncates text cleanly.
 *
 * @param {string} text - Raw input string (may contain HTML or markdown)
 * @param {number} maxLen - Maximum character length
 * @returns {string} Sanitized string
 */
export function cleanTicketText(text, maxLen = 350) {
  if (!text) return '';
  const cleaned = String(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen).replace(/\s+\S*$/, '') + '...';
}

/**
 * Collects and compiles a comprehensive, multi-section digest of all project tickets,
 * including descriptions, latest comments, relations/dependencies, and status history.
 * Designed to handle small (5), medium (50-100), and large (500+) ticket volumes.
 *
 * @param {number|null} projectId - Project ID (or null for overall)
 * @param {string} projectName
 * @param {string} projectKey
 * @returns {Promise<{
 *   digestText: string,
 *   coverage: {
 *     totalTickets: number,
 *     analyzedTickets: number,
 *     isComplete: boolean,
 *     inProgressCount: number,
 *     recentlyCompletedCount: number,
 *     historicalCompletedCount: number,
 *     openCount: number,
 *     blockedCount: number,
 *     criticalCount: number
 *   },
 *   ticketsByStatus: {
 *     inProgress: Array<object>,
 *     critical: Array<object>,
 *     blocked: Array<object>,
 *     recentlyCompleted: Array<object>,
 *     historical: Array<object>,
 *     upcoming: Array<object>
 *   }
 * }>}
 */
export async function getProjectTicketsDigest(projectId, projectName = '', projectKey = 'PROJ') {
  const isOverall = !projectId || projectId === 'all';
  const numericId = isOverall ? null : Number(projectId);
  const todayIso = new Date().toISOString().slice(0, 10);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  // 1. Fetch all active tickets for this scope (never silently omit tickets)
  let ticketSql = `
    SELECT
      t.id,
      t.title,
      t.description,
      t.status,
      t.priority,
      t.type,
      t.category,
      t.resolution,
      t.labels,
      t.due_date,
      t.created_at,
      t.updated_at,
      p.key AS project_key,
      p.name AS project_name,
      COALESCE(e.name, u.name, 'Unassigned') AS assignee_name
    FROM tickets t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN employees e ON e.id = t.employee_id
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.archived = 0
  `;
  const ticketParams = [];
  if (!isOverall) {
    ticketSql += ' AND t.project_id = ?';
    ticketParams.push(numericId);
  }
  ticketSql += `
    ORDER BY CASE t.status
      WHEN 'in_progress' THEN 1
      WHEN 'open' THEN 2
      WHEN 'resolved' THEN 3
      WHEN 'closed' THEN 4
      ELSE 5
    END, t.updated_at DESC
  `;

  const allTickets = (await db.prepare(ticketSql).all(...ticketParams)) || [];
  const totalTickets = allTickets.length;

  if (totalTickets === 0) {
    return {
      digestText: 'No tickets recorded for this project yet.',
      coverage: {
        totalTickets: 0,
        analyzedTickets: 0,
        isComplete: true,
        inProgressCount: 0,
        recentlyCompletedCount: 0,
        historicalCompletedCount: 0,
        openCount: 0,
        blockedCount: 0,
        criticalCount: 0,
      },
      ticketsByStatus: {
        inProgress: [],
        critical: [],
        blocked: [],
        recentlyCompleted: [],
        historical: [],
        upcoming: [],
      },
    };
  }

  // 2. Efficient bulk query: Fetch up to 3 latest comments per ticket in a single query
  let commentSql = `
    SELECT
      c.ticket_id,
      c.body,
      c.created_at,
      COALESCE(u.name, 'Team Member') AS author_name
    FROM (
      SELECT
        tc.ticket_id,
        tc.body,
        tc.created_at,
        tc.author_id,
        ROW_NUMBER() OVER (PARTITION BY tc.ticket_id ORDER BY tc.created_at DESC) AS rn
      FROM ticket_comments tc
      JOIN tickets t ON t.id = tc.ticket_id
      WHERE t.archived = 0
  `;
  const commentParams = [];
  if (!isOverall) {
    commentSql += ' AND t.project_id = ?';
    commentParams.push(numericId);
  }
  commentSql += `
    ) c
    LEFT JOIN users u ON u.id = c.author_id
    WHERE c.rn <= 3
    ORDER BY c.ticket_id, c.created_at ASC
  `;

  let commentRows = [];
  try {
    commentRows = (await db.prepare(commentSql).all(...commentParams)) || [];
  } catch (err) {
    console.warn('Warning: Could not fetch ticket comments digest:', err.message);
  }

  const commentsByTicketId = new Map();
  for (const row of commentRows) {
    if (!commentsByTicketId.has(row.ticket_id)) {
      commentsByTicketId.set(row.ticket_id, []);
    }
    commentsByTicketId.get(row.ticket_id).push({
      author: row.author_name,
      date: (row.created_at || '').slice(0, 10),
      body: cleanTicketText(row.body, 200),
    });
  }

  // 3. Efficient bulk query: Fetch ticket relations/dependencies
  let relationSql = `
    SELECT
      r.ticket_id,
      r.related_ticket_id,
      r.relation_type,
      t1.title AS ticket_title,
      t2.title AS related_title,
      p1.key AS project_key,
      p2.key AS related_project_key
    FROM ticket_relations r
    JOIN tickets t1 ON t1.id = r.ticket_id
    JOIN tickets t2 ON t2.id = r.related_ticket_id
    LEFT JOIN projects p1 ON p1.id = t1.project_id
    LEFT JOIN projects p2 ON p2.id = t2.project_id
    WHERE t1.archived = 0 AND t2.archived = 0
  `;
  const relationParams = [];
  if (!isOverall) {
    relationSql += ' AND (t1.project_id = ? OR t2.project_id = ?)';
    relationParams.push(numericId, numericId);
  }

  let relationRows = [];
  try {
    relationRows = (await db.prepare(relationSql).all(...relationParams)) || [];
  } catch (err) {
    console.warn('Warning: Could not fetch ticket relations:', err.message);
  }

  const blockedTicketIds = new Set();
  const dependencyLines = [];
  for (const rel of relationRows) {
    const keyA = `[${rel.project_key || 'TM'}-${rel.ticket_id}]`;
    const keyB = `[${rel.related_project_key || 'TM'}-${rel.related_ticket_id}]`;
    if (rel.relation_type === 'blocks') {
      blockedTicketIds.add(rel.related_ticket_id);
      dependencyLines.push(`${keyA} blocks ${keyB} ("${cleanTicketText(rel.related_title, 60)}")`);
    } else if (rel.relation_type === 'is blocked by') {
      blockedTicketIds.add(rel.ticket_id);
      dependencyLines.push(`${keyA} is blocked by ${keyB} ("${cleanTicketText(rel.related_title, 60)}")`);
    } else if (rel.relation_type === 'relates to') {
      dependencyLines.push(`${keyA} relates to ${keyB}`);
    }
  }

  // 4. Categorize tickets into distinct intelligence groups
  const inProgress = [];
  const critical = [];
  const blocked = [];
  const recentlyCompleted = [];
  const historical = [];
  const upcoming = [];

  for (const t of allTickets) {
    const key = `[${t.project_key || projectKey || 'TM'}-${t.id}]`;
    const comments = commentsByTicketId.get(t.id) || [];
    const isOverdue = t.due_date && t.due_date < todayIso && t.status !== 'resolved' && t.status !== 'closed';
    const isUrgent = t.priority === 'urgent';
    const isBlocked = blockedTicketIds.has(t.id);
    const item = {
      id: t.id,
      key,
      title: t.title,
      description: cleanTicketText(t.description, 350),
      status: t.status,
      priority: t.priority,
      type: t.type,
      category: t.category,
      resolution: cleanTicketText(t.resolution, 180),
      assignee: t.assignee_name,
      dueDate: t.due_date || 'None',
      createdAt: (t.created_at || '').slice(0, 10),
      updatedAt: (t.updated_at || '').slice(0, 10),
      comments,
      isBlocked,
      isOverdue,
    };

    if (t.status === 'in_progress') {
      inProgress.push(item);
    } else if (t.status === 'resolved' || t.status === 'closed') {
      const isRecent = t.updated_at && t.updated_at >= fourteenDaysAgo;
      if (isRecent) {
        recentlyCompleted.push(item);
      } else {
        historical.push(item);
      }
    } else {
      upcoming.push(item);
    }

    if ((isUrgent || isOverdue) && t.status !== 'resolved' && t.status !== 'closed') {
      critical.push(item);
    }
    if (isBlocked && t.status !== 'resolved' && t.status !== 'closed') {
      blocked.push(item);
    }
  }

  // 5. Build intelligent, token-managed digest sections
  // High detail on active, blocked, critical, and recent;
  // Compact summary for large sets of historical closed items.
  const formatTicketDetailed = (item) => {
    let res = `  * ${item.key} "${item.title}" (Type: ${item.type}, Priority: ${item.priority}, Status: ${item.status}, Assignee: ${item.assignee})`;
    if (item.description) {
      res += `\n    Description: ${item.description}`;
    }
    if (item.resolution) {
      res += `\n    Resolution: ${item.resolution}`;
    }
    if (item.comments.length > 0) {
      res += `\n    Recent Comments:`;
      for (const c of item.comments) {
        res += `\n      - [${c.date}] ${c.author}: ${c.body}`;
      }
    }
    return res;
  };

  const lines = [];

  // Section A: Currently Underway (In-Progress)
  lines.push('=== CURRENT DEVELOPMENT ACTIVITIES (IN PROGRESS) ===');
  if (inProgress.length === 0) {
    lines.push('  No tickets currently marked in progress.');
  } else {
    for (const t of inProgress) {
      lines.push(formatTicketDetailed(t));
    }
  }

  // Section B: Blocked & At-Risk Items
  lines.push('\n=== ACTIVE BLOCKERS & AT-RISK TICKETS ===');
  if (blocked.length === 0 && critical.length === 0) {
    lines.push('  No active blocker tickets or overdue items recorded.');
  } else {
    const riskItems = Array.from(new Set([...blocked, ...critical]));
    for (const t of riskItems) {
      let riskReason = [];
      if (t.isBlocked) riskReason.push('Explicitly Blocked by Dependency');
      if (t.isOverdue) riskReason.push(`Overdue since ${t.dueDate}`);
      if (t.priority === 'urgent') riskReason.push('Urgent Priority');
      lines.push(`${formatTicketDetailed(t)}\n    Risk Flag: ${riskReason.join(' | ')}`);
    }
  }

  // Section C: Dependencies
  if (dependencyLines.length > 0) {
    lines.push('\n=== DETECTED TICKET DEPENDENCY RELATIONSHIPS ===');
    for (const dep of dependencyLines.slice(0, 15)) {
      lines.push(`  * ${dep}`);
    }
  }

  // Section D: Recently Completed / Resolved (last 14 days)
  lines.push('\n=== RECENT ACHIEVEMENTS & COMPLETED DELIVERABLES (LAST 14 DAYS) ===');
  if (recentlyCompleted.length === 0) {
    lines.push('  No tickets resolved or closed in the last 14 days.');
  } else {
    for (const t of recentlyCompleted) {
      lines.push(formatTicketDetailed(t));
    }
  }

  // Section E: Historical Completed Work (Foundational Milestones)
  lines.push('\n=== HISTORICAL ACHIEVEMENTS (PREVIOUSLY COMPLETED WORK) ===');
  if (historical.length === 0) {
    lines.push('  No older closed tickets in history.');
  } else if (historical.length <= 25) {
    // If moderate volume, output all historical tickets with concise summary
    for (const t of historical) {
      lines.push(`  * ${t.key} "${t.title}" (Type: ${t.type}, Resolved: ${t.updatedAt})${t.resolution ? ` - ${t.resolution}` : ''}`);
    }
  } else {
    // Hierarchical compression for large volume (50-500+ tickets):
    // Group by category/type and list sample milestones to conserve tokens
    const byType = {};
    for (const t of historical) {
      byType[t.type] = (byType[t.type] || 0) + 1;
    }
    lines.push(`  Total historical closed tickets: ${historical.length} (${Object.entries(byType).map(([k, v]) => `${v} ${k}s`).join(', ')})`);
    lines.push('  Representative milestones:');
    for (const t of historical.slice(0, 15)) {
      lines.push(`  * ${t.key} "${t.title}" (Type: ${t.type}, Resolved: ${t.updatedAt})${t.resolution ? ` - ${t.resolution}` : ''}`);
    }
    if (historical.length > 15) {
      lines.push(`  * ... and ${historical.length - 15} additional earlier closed tickets.`);
    }
  }

  // Section F: Upcoming Work (Open / Backlog)
  lines.push('\n=== UPCOMING & PENDING WORK (OPEN BACKLOG) ===');
  if (upcoming.length === 0) {
    lines.push('  No open backlog tickets remaining.');
  } else {
    // Prioritize high/urgent open items first
    const sortedUpcoming = [...upcoming].sort((a, b) => {
      const pMap = { urgent: 1, high: 2, medium: 3, low: 4 };
      return (pMap[a.priority] || 5) - (pMap[b.priority] || 5);
    });
    for (const t of sortedUpcoming.slice(0, 30)) {
      lines.push(`  * ${t.key} "${t.title}" (Type: ${t.type}, Priority: ${t.priority}, Assignee: ${t.assignee})${t.description ? ` - ${cleanTicketText(t.description, 120)}` : ''}`);
    }
    if (sortedUpcoming.length > 30) {
      lines.push(`  * ... and ${sortedUpcoming.length - 30} additional open backlog items.`);
    }
  }

  const coverage = {
    totalTickets,
    analyzedTickets: totalTickets,
    isComplete: true,
    inProgressCount: inProgress.length,
    recentlyCompletedCount: recentlyCompleted.length,
    historicalCompletedCount: historical.length,
    openCount: upcoming.length,
    blockedCount: blocked.length,
    criticalCount: critical.length,
  };

  return {
    digestText: lines.join('\n'),
    coverage,
    ticketsByStatus: {
      inProgress,
      critical,
      blocked,
      recentlyCompleted,
      historical,
      upcoming,
    },
  };
}

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

  // 7. Enriched Tickets Intelligence Digest
  const ticketsDigest = await getProjectTicketsDigest(numericProjectId, projectName, projectKey);

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
    ticketsDigest,
  };
}
