import { db } from './db.js';
import { formatDuration } from './ticketMeta.js';

/**
 * Client Box Usage & Reporting Service.
 *
 * Computes work consumed by each Client Box (Workspace), including:
 *   - Distinct tickets associated with the client box.
 *   - Total recorded time across those tickets (without double counting).
 *   - Product inclusion breakdown (Included, Not Included, Pending Review).
 *   - Unassigned handling for tickets not linked to a client box.
 *   - Strict tenant boundaries preventing tenant cross-exposure.
 */

export async function getClientBoxUsageData({
  days = null,
  workspaceId = null,
  clientUserId = null,
} = {}) {
  // 1. Fetch workspaces
  const workspacesQuery = `
    SELECT w.id, w.key, w.name, w.color,
      (SELECT COUNT(*) FROM projects p WHERE p.workspace_id = w.id) AS project_count
    FROM workspaces w
    ORDER BY w.name ASC
  `;
  const allWorkspaces = await db.prepare(workspacesQuery).all();

  // 2. Fetch projects
  const projectsQuery = `
    SELECT id, key, name, workspace_id, color
    FROM projects
    ORDER BY name ASC
  `;
  const allProjects = await db.prepare(projectsQuery).all();
  const projectsById = new Map(allProjects.map((p) => [p.id, p]));

  // 3. Fetch active tickets with inclusion status
  let ticketsSql = `
    SELECT t.id, t.title, t.status, t.priority, t.type, t.project_id,
      t.created_by, t.created_at, t.product_inclusion_status,
      t.product_inclusion_reference,
      e.name AS employee_name, p.key AS project_key
    FROM tickets t
    LEFT JOIN employees e ON e.id = t.employee_id
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.archived = 0
  `;
  const ticketsParams = [];

  // Date filter (days)
  if (days && Number.isFinite(Number(days)) && Number(days) > 0) {
    const cutoff = new Date(Date.now() - Number(days) * 86400000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
    ticketsSql += ` AND t.created_at >= ?`;
    ticketsParams.push(cutoff);
  }

  // Tenant isolation boundary:
  // If requested by a client user, only include tickets created by this client user
  if (clientUserId != null) {
    ticketsSql += ` AND t.created_by = ?`;
    ticketsParams.push(Number(clientUserId));
  }

  const allTickets = await db.prepare(ticketsSql).all(...ticketsParams);

  // 4. Fetch time logs aggregated per ticket
  // Summing per ticket first ensures time entries are strictly aggregated
  // and tickets are counted distinctly without Cartesian product skew.
  const timeLogsQuery = `
    SELECT l.ticket_id, COALESCE(SUM(l.seconds), 0) AS total_seconds
    FROM ticket_time_logs l
    GROUP BY l.ticket_id
  `;
  const timeLogRows = await db.prepare(timeLogsQuery).all();
  const timeByTicket = new Map();
  for (const row of timeLogRows) {
    timeByTicket.set(Number(row.ticket_id), Number(row.total_seconds) || 0);
  }

  // 5. Group tickets into client boxes (workspaces)
  // Maps: workspace_id -> { boxInfo, tickets: [] }
  const boxMap = new Map();

  for (const w of allWorkspaces) {
    boxMap.set(w.id, {
      workspace_id: w.id,
      workspace_key: w.key,
      workspace_name: w.name,
      workspace_color: w.color || '#0c66e4',
      project_count: Number(w.project_count) || 0,
      tickets: [],
    });
  }

  // Box for tickets without a workspace / client box
  const unassignedBox = {
    workspace_id: null,
    workspace_key: 'UNASSIGNED',
    workspace_name: 'No Client Box / Unassigned',
    workspace_color: '#6b778c',
    project_count: allProjects.filter((p) => p.workspace_id == null).length,
    tickets: [],
  };

  for (const ticket of allTickets) {
    const project = ticket.project_id ? projectsById.get(ticket.project_id) : null;
    const wsId = project?.workspace_id ?? null;

    if (wsId != null && boxMap.has(wsId)) {
      boxMap.get(wsId).tickets.push(ticket);
    } else {
      unassignedBox.tickets.push(ticket);
    }
  }

  // 6. Compute statistics per Client Box
  const computeBoxStats = (box) => {
    const totalTickets = box.tickets.length;
    let totalSeconds = 0;
    let includedCount = 0;
    let notIncludedCount = 0;
    let pendingReviewCount = 0;

    for (const t of box.tickets) {
      const logged = timeByTicket.get(t.id) || 0;
      t.total_logged_seconds = logged;
      t.total_logged_formatted = formatDuration(logged);
      totalSeconds += logged;
      const status = t.product_inclusion_status || 'pending_review';
      if (status === 'included') includedCount++;
      else if (status === 'not_included') notIncludedCount++;
      else pendingReviewCount++;
    }

    return {
      workspace_id: box.workspace_id,
      workspace_key: box.workspace_key,
      workspace_name: box.workspace_name,
      workspace_color: box.workspace_color,
      project_count: box.project_count,
      total_tickets: totalTickets,
      total_logged_seconds: totalSeconds,
      total_logged_minutes: Math.round(totalSeconds / 60),
      total_logged_hours: Math.round((totalSeconds / 3600) * 10) / 10,
      total_logged_formatted: formatDuration(totalSeconds),
      included_count: includedCount,
      not_included_count: notIncludedCount,
      pending_review_count: pendingReviewCount,
      inclusion_rate_pct:
        totalTickets > 0 ? Math.round((includedCount / totalTickets) * 100) : 0,
      tickets: box.tickets,
    };
  };

  let clientBoxes = Array.from(boxMap.values()).map(computeBoxStats);

  // If there are unassigned tickets, append the unassigned box
  if (unassignedBox.tickets.length > 0) {
    clientBoxes.push(computeBoxStats(unassignedBox));
  }

  // Filter to specific workspace if requested
  if (workspaceId !== null && workspaceId !== undefined) {
    const targetId = Number(workspaceId);
    clientBoxes = clientBoxes.filter((b) => b.workspace_id === targetId);
  }

  // Tenant isolation: if a client user is requesting, filter out boxes with 0 tickets for that client
  if (clientUserId != null) {
    clientBoxes = clientBoxes.filter((b) => b.total_tickets > 0);
  }

  // 7. Compute overall aggregate summary
  const summary = {
    total_client_boxes: clientBoxes.filter((b) => b.workspace_id !== null).length,
    total_tickets: clientBoxes.reduce((acc, b) => acc + b.total_tickets, 0),
    total_logged_seconds: clientBoxes.reduce(
      (acc, b) => acc + b.total_logged_seconds,
      0
    ),
    total_included: clientBoxes.reduce((acc, b) => acc + b.included_count, 0),
    total_not_included: clientBoxes.reduce(
      (acc, b) => acc + b.not_included_count,
      0
    ),
    total_pending_review: clientBoxes.reduce(
      (acc, b) => acc + b.pending_review_count,
      0
    ),
  };
  summary.total_logged_minutes = Math.round(summary.total_logged_seconds / 60);
  summary.total_logged_formatted = formatDuration(summary.total_logged_seconds);
  summary.overall_inclusion_rate_pct =
    summary.total_tickets > 0
      ? Math.round((summary.total_included / summary.total_tickets) * 100)
      : 0;

  return {
    clientBoxes,
    summary,
    filters: {
      days: days || 'all',
      workspaceId: workspaceId ?? 'all',
    },
  };
}
