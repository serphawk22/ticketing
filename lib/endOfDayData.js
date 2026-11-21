import { db } from './db.js';

const APP_TIME_ZONE = 'Asia/Kolkata';

function istDayBounds(reportDate) {
  const start = new Date(`${reportDate}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function parseTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  const text = String(value || '');
  if (!text) return NaN;
  const iso = !text.includes('T') && text.includes(' ') ? `${text.replace(' ', 'T')}Z` : text;
  return new Date(iso).getTime();
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Collects complete data for the selected reporting date:
 * - Active employees
 * - Task Sheet submissions (with planned, completed, in-progress, blockers, comments)
 * - Ground truth tickets assigned to each employee
 * - Verified completion activity for the date from ticket_activity
 * - Overdue tickets and high-priority tickets
 * - Project-wise progress and team-level metrics
 *
 * @param {string} reportDate - YYYY-MM-DD
 */
export async function collectEndOfDayData(reportDate) {
  const { startMs, endMs, startIso, endIso } = istDayBounds(reportDate);

  // 1. Fetch active employees & users
  const [employeeRows, userRows, projectRows] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, email, role, user_id, active
         FROM employees
         WHERE active = 1
         ORDER BY name ASC`
      )
      .all(),
    db
      .prepare(
        `SELECT id, name, email, role
         FROM users
         WHERE role IN ('admin', 'developer')
         ORDER BY name ASC`
      )
      .all(),
    db
      .prepare(
        `SELECT p.id, p.key, p.name, p.color, p.workspace_id, w.name AS workspace_name
         FROM projects p
         LEFT JOIN workspaces w ON w.id = p.workspace_id
         ORDER BY p.name ASC`
      )
      .all(),
  ]);

  // 2. Fetch task sheet submissions for the given reporting date window
  const taskSubmissions = await db
    .prepare(
      `SELECT * FROM task_sheet_submissions
       ORDER BY created_at ASC`
    )
    .all();

  const submissionsForDate = taskSubmissions.filter((row) => {
    const ts = parseTimestamp(row.created_at);
    return Number.isFinite(ts) && ts >= startMs && ts < endMs;
  });

  // 3. Fetch all active tickets with project and employee details
  const activeTickets = await db
    .prepare(
      `SELECT t.*, p.key AS project_key, p.name AS project_name, p.color AS project_color,
              e.name AS employee_name, e.email AS employee_email
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN employees e ON e.id = t.employee_id
       WHERE t.archived = 0
       ORDER BY t.id ASC`
    )
    .all();

  // 4. Fetch ticket activity to verify completion on this exact date
  const statusActivities = await db
    .prepare(
      `SELECT ticket_id, from_value, to_value, created_at
       FROM ticket_activity
       WHERE field = 'status' AND to_value IN ('resolved', 'closed')
       ORDER BY created_at ASC`
    )
    .all();

  const completedTodayTicketIds = new Set();
  for (const act of statusActivities) {
    const ts = parseTimestamp(act.created_at);
    if (Number.isFinite(ts) && ts >= startMs && ts < endMs) {
      completedTodayTicketIds.add(Number(act.ticket_id));
    }
  }

  // 5. Structure data per employee
  // Build lookup maps for employee matching
  const employeeMap = new Map();
  for (const emp of employeeRows) {
    employeeMap.set(emp.id, {
      id: emp.id,
      userId: emp.user_id,
      name: String(emp.name || '').trim(),
      email: String(emp.email || '').trim().toLowerCase(),
      role: emp.role || 'developer',
      taskSheetSubmitted: false,
      hoursWorked: 0,
      reportedProjects: new Set(),
      reportedCompletedWork: [],
      reportedInProgressWork: [],
      reportedPendingWork: [],
      reportedBlockers: [],
      reportedNotes: [],
      assignedTickets: [],
      completedTodayTickets: [],
      inProgressTickets: [],
      highPriorityTickets: [],
      overdueTickets: [],
    });
  }

  // Match submissions to employees
  for (const sub of submissionsForDate) {
    const subName = String(sub.name || '').trim().toLowerCase();
    const subUserId = sub.submitted_by ? Number(sub.submitted_by) : null;

    let matchedEmp = null;
    for (const emp of employeeMap.values()) {
      if (subUserId && emp.userId === subUserId) {
        matchedEmp = emp;
        break;
      }
      if (emp.name.toLowerCase() === subName) {
        matchedEmp = emp;
        break;
      }
    }

    if (!matchedEmp) {
      // If employee wasn't in employees table but submitted, track as ad-hoc employee
      const virtualId = 900000 + (employeeMap.size + 1);
      matchedEmp = {
        id: virtualId,
        userId: subUserId,
        name: sub.name || 'Unnamed Employee',
        email: '',
        role: 'developer',
        taskSheetSubmitted: false,
        hoursWorked: 0,
        reportedProjects: new Set(),
        reportedCompletedWork: [],
        reportedInProgressWork: [],
        reportedPendingWork: [],
        reportedBlockers: [],
        reportedNotes: [],
        assignedTickets: [],
        completedTodayTickets: [],
        inProgressTickets: [],
        highPriorityTickets: [],
        overdueTickets: [],
      };
      employeeMap.set(virtualId, matchedEmp);
    }

    matchedEmp.taskSheetSubmitted = true;
    matchedEmp.hoursWorked += Number(sub.hours_worked) || 0;

    const projectsList = parseJsonArray(sub.projects_detail);
    if (projectsList.length) {
      for (const p of projectsList) {
        if (p && typeof p === 'string') matchedEmp.reportedProjects.add(p);
        else if (p?.name) matchedEmp.reportedProjects.add(p.name);
      }
    } else if (sub.project) {
      matchedEmp.reportedProjects.add(sub.project);
    }

    // Work item detail breakdown
    const ticketsDetail = parseJsonArray(sub.tickets_detail);
    if (ticketsDetail.length > 0) {
      for (const t of ticketsDetail) {
        const itemLabel = t.title || t.key || 'Work Item';
        const itemDesc = t.description && t.description !== t.title ? ` — ${t.description}` : '';
        const fullItem = `${t.key ? `[${t.key}] ` : ''}${itemLabel}${itemDesc}`;
        const isDone = t.workState === 'completed' || t.taskStatus === 'completed' || sub.task_state === 'completed';

        if (isDone) {
          matchedEmp.reportedCompletedWork.push(fullItem);
        } else if (t.taskStatus === 'in_progress' || t.workState === 'in_progress') {
          matchedEmp.reportedInProgressWork.push(fullItem);
        } else {
          matchedEmp.reportedPendingWork.push(fullItem);
        }

        if (t.blocker) {
          matchedEmp.reportedBlockers.push(`${t.key ? `[${t.key}] ` : ''}${t.blocker}`);
        }
      }
    } else {
      // Top-level task title / description
      const taskSummary = sub.task_title + (sub.task_description && sub.task_description !== sub.task_title ? ` — ${sub.task_description}` : '');
      if (sub.task_state === 'completed') {
        matchedEmp.reportedCompletedWork.push(taskSummary);
      } else {
        matchedEmp.reportedInProgressWork.push(taskSummary);
      }
      if (sub.blocker) {
        matchedEmp.reportedBlockers.push(sub.blocker);
      }
    }

    if (sub.learning_project) {
      matchedEmp.reportedNotes.push(`Learning / Side Project: ${sub.learning_project}`);
    }
    if (sub.other_activities) {
      matchedEmp.reportedNotes.push(`Other Activities: ${sub.other_activities}`);
    }
  }

  // Associate tickets with employees
  const allOverdueTickets = [];
  const allHighPriorityTickets = [];
  const allCompletedTodayTickets = [];

  for (const ticket of activeTickets) {
    const isCompletedToday = completedTodayTicketIds.has(Number(ticket.id));
    const isOverdue =
      ticket.due_date &&
      ticket.due_date < reportDate &&
      ticket.status !== 'resolved' &&
      ticket.status !== 'closed';
    const isHighPriority =
      (ticket.priority === 'urgent' || ticket.priority === 'high') &&
      ticket.status !== 'resolved' &&
      ticket.status !== 'closed';

    const ticketSummary = {
      id: ticket.id,
      key: `${ticket.project_key || 'TM'}-${ticket.id}`,
      title: ticket.title,
      priority: ticket.priority,
      status: ticket.status,
      type: ticket.type,
      dueDate: ticket.due_date || 'None',
      projectId: ticket.project_id,
      projectName: ticket.project_name || 'No Project',
      projectColor: ticket.project_color || '#667085',
      employeeId: ticket.employee_id,
      employeeName: ticket.employee_name || 'Unassigned',
      isCompletedToday,
      isOverdue,
      isHighPriority,
    };

    if (isCompletedToday) allCompletedTodayTickets.push(ticketSummary);
    if (isOverdue) allOverdueTickets.push(ticketSummary);
    if (isHighPriority) allHighPriorityTickets.push(ticketSummary);

    // Match to employee
    if (ticket.employee_id && employeeMap.has(ticket.employee_id)) {
      const emp = employeeMap.get(ticket.employee_id);
      emp.assignedTickets.push(ticketSummary);
      if (isCompletedToday) emp.completedTodayTickets.push(ticketSummary);
      if (ticket.status === 'in_progress') emp.inProgressTickets.push(ticketSummary);
      if (isHighPriority) emp.highPriorityTickets.push(ticketSummary);
      if (isOverdue) emp.overdueTickets.push(ticketSummary);
    }
  }

  // 6. Project-wise progress aggregation
  const projectMap = new Map();
  for (const p of projectRows) {
    projectMap.set(p.id, {
      id: p.id,
      key: p.key,
      name: p.name,
      color: p.color,
      workspaceName: p.workspace_name || 'General',
      totalActiveTickets: 0,
      completedTodayCount: 0,
      inProgressCount: 0,
      openCount: 0,
      overdueCount: 0,
      highPriorityCount: 0,
      completedTodayTickets: [],
      overdueTickets: [],
      highPriorityTickets: [],
      reportedBlockers: [],
    });
  }

  for (const ticket of activeTickets) {
    if (!ticket.project_id || !projectMap.has(ticket.project_id)) continue;
    const proj = projectMap.get(ticket.project_id);
    proj.totalActiveTickets += 1;
    if (completedTodayTicketIds.has(Number(ticket.id))) {
      proj.completedTodayCount += 1;
      proj.completedTodayTickets.push({
        id: ticket.id,
        key: `${ticket.project_key || 'TM'}-${ticket.id}`,
        title: ticket.title,
        assignee: ticket.employee_name || 'Unassigned',
      });
    }
    if (ticket.status === 'in_progress') proj.inProgressCount += 1;
    if (ticket.status === 'open') proj.openCount += 1;
    if (ticket.due_date && ticket.due_date < reportDate && ticket.status !== 'resolved' && ticket.status !== 'closed') {
      proj.overdueCount += 1;
      proj.overdueTickets.push({
        id: ticket.id,
        key: `${ticket.project_key || 'TM'}-${ticket.id}`,
        title: ticket.title,
        dueDate: ticket.due_date,
        assignee: ticket.employee_name || 'Unassigned',
      });
    }
    if ((ticket.priority === 'urgent' || ticket.priority === 'high') && ticket.status !== 'resolved' && ticket.status !== 'closed') {
      proj.highPriorityCount += 1;
      proj.highPriorityTickets.push({
        id: ticket.id,
        key: `${ticket.project_key || 'TM'}-${ticket.id}`,
        title: ticket.title,
        priority: ticket.priority,
        status: ticket.status,
        assignee: ticket.employee_name || 'Unassigned',
      });
    }
  }

  // Collect blockers per project from task sheets
  for (const emp of employeeMap.values()) {
    if (emp.reportedBlockers.length > 0) {
      for (const proj of projectMap.values()) {
        if (emp.reportedProjects.has(proj.name) || emp.reportedProjects.has(proj.key)) {
          proj.reportedBlockers.push(...emp.reportedBlockers.map((b) => `${emp.name}: ${b}`));
        }
      }
    }
  }

  // Convert employeeMap to serializable list with strictly factual fallback strings
  const employeesList = Array.from(employeeMap.values()).map((emp) => {
    const projectsArray = Array.from(emp.reportedProjects);
    return {
      id: emp.id,
      userId: emp.userId,
      name: emp.name,
      email: emp.email,
      role: emp.role,
      taskSheetSubmitted: emp.taskSheetSubmitted,
      hoursWorked: emp.hoursWorked,
      projectsWorkedOn: projectsArray.length ? projectsArray : ['Not Reported'],
      completedWork: emp.taskSheetSubmitted
        ? (emp.reportedCompletedWork.length ? emp.reportedCompletedWork : ['None reported'])
        : ['Task Sheet Not Submitted'],
      inProgressWork: emp.taskSheetSubmitted
        ? (emp.reportedInProgressWork.length ? emp.reportedInProgressWork : ['None reported'])
        : ['Task Sheet Not Submitted'],
      pendingWork: emp.taskSheetSubmitted
        ? (emp.reportedPendingWork.length ? emp.reportedPendingWork : ['None reported'])
        : ['Task Sheet Not Submitted'],
      blockers: emp.taskSheetSubmitted
        ? (emp.reportedBlockers.length ? emp.reportedBlockers : ['No blockers reported'])
        : ['Task Sheet Not Submitted'],
      notes: emp.reportedNotes,
      assignedTicketsCount: emp.assignedTickets.length,
      completedTodayCount: emp.completedTodayTickets.length,
      inProgressTicketsCount: emp.inProgressTickets.length,
      highPriorityTicketsCount: emp.highPriorityTickets.length,
      overdueTicketsCount: emp.overdueTickets.length,
      highPriorityTickets: emp.highPriorityTickets || [],
      overdueTickets: emp.overdueTickets || [],
      inProgressTickets: emp.inProgressTickets || [],
      completedTodayTickets: emp.completedTodayTickets || [],
      assignedTickets: emp.assignedTickets || [],
    };
  });

  const projectsList = Array.from(projectMap.values()).filter(
    (p) => p.totalActiveTickets > 0 || p.completedTodayCount > 0 || p.reportedBlockers.length > 0
  );

  // Overall Team Metrics
  const totalEmployees = employeeRows.length;
  const submittedCount = employeesList.filter((e) => e.taskSheetSubmitted).length;
  const missingCount = Math.max(0, totalEmployees - submittedCount);
  const totalHoursLogged = employeesList.reduce((sum, e) => sum + e.hoursWorked, 0);

  const metrics = {
    reportDate,
    totalEmployees,
    submittedCount,
    missingCount,
    totalHoursLogged,
    totalCompletedToday: allCompletedTodayTickets.length,
    totalHighPriority: allHighPriorityTickets.length,
    totalOverdue: allOverdueTickets.length,
    activeProjectsCount: projectsList.length,
  };

  return {
    reportDate,
    metrics,
    employees: employeesList,
    projects: projectsList,
    highPriorityTickets: allHighPriorityTickets,
    overdueTickets: allOverdueTickets,
    completedTodayTickets: allCompletedTodayTickets,
    allUsers: userRows,
  };
}
