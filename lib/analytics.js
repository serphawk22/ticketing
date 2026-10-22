import { db } from './db.js';
import { resolveDateRange, isWithinRange, calculateMonthsMultiplier, parseUtcDate } from './dateFilters.js';
import { getReportBySlug } from './reportMasterCatalog.js';
import { ticketKey, DONE_STATUSES } from './ticketMeta.js';
import { calculateReportData } from './reportCalculators.js';

const DONE_SET = new Set(DONE_STATUSES);

/**
 * Format duration in minutes into a friendly string (e.g., "3h 45m" or "45m")
 */
function formatMinutes(mins) {
  if (!mins || mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Extract currency symbol or code
 */
function formatCurrency(amount, currency = 'USD') {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

/**
 * Fetches company-wide aggregated overview for the Admin Dashboard
 */
export async function getAdminDashboardSummary({
  preset = 'this_month',
  startDate = '',
  endDate = '',
  projectId = 'all',
} = {}) {
  const dateRange = resolveDateRange({ preset, startDate, endDate });

  // 1. Fetch Projects dynamically from DB
  const projects = await db
    .prepare('SELECT id, key, name, color, client_id, workspace_id, created_at FROM projects ORDER BY name ASC')
    .all();

  // 2. Fetch Employees
  const employees = await db
    .prepare(
      `SELECT e.*, u.role AS user_role, u.email AS user_email
       FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
       ORDER BY e.name ASC`
    )
    .all();

  // 3. Fetch Tickets
  let ticketQuery = `
    SELECT t.*, p.key AS project_key, p.name AS project_name, e.name AS employee_name
    FROM tickets t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN employees e ON e.id = t.employee_id
    WHERE t.archived = 0
  `;
  const ticketParams = [];
  if (projectId && projectId !== 'all') {
    ticketQuery += ' AND t.project_id = ?';
    ticketParams.push(Number(projectId));
  }
  const tickets = await db.prepare(ticketQuery).all(...ticketParams);

  // 4. Fetch Time Logs
  const timeLogs = await db
    .prepare(
      `SELECT tl.*, t.project_id, t.title AS ticket_title, p.key AS project_key, u.name AS user_name
       FROM ticket_time_logs tl
       JOIN tickets t ON t.id = tl.ticket_id
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = tl.user_id
       ORDER BY tl.created_at DESC`
    )
    .all();

  // 5. Fetch Task Sheet Submissions
  const taskSheets = await db
    .prepare('SELECT * FROM task_sheet_submissions ORDER BY created_at DESC')
    .all();

  // Filter time logs & task sheets by date range
  const filteredTimeLogs = timeLogs.filter((l) => {
    if (projectId !== 'all' && String(l.project_id) !== String(projectId)) return false;
    const dateToCheck = l.work_date || l.created_at;
    return isWithinRange(dateToCheck, dateRange.startMs, dateRange.endMs);
  });

  const filteredTaskSheets = taskSheets.filter((s) => {
    return isWithinRange(s.created_at, dateRange.startMs, dateRange.endMs);
  });

  // Filter tickets by date range:
  // Tickets active in the period (created on or before period end, and either still open or resolved within/after period start)
  const inRangeTickets = tickets.filter((t) => {
    const created = parseUtcDate(t.created_at);
    if (!created || created.getTime() > dateRange.endMs) return false;
    if (DONE_SET.has(t.status)) {
      const resolved = parseUtcDate(t.updated_at || t.created_at);
      if (resolved && resolved.getTime() < dateRange.startMs) return false;
    }
    return true;
  });

  const monthsMult = calculateMonthsMultiplier(dateRange.preset, dateRange.startMs, dateRange.endMs);

  // Calculate KPIs on in-range tickets
  const totalTickets = inRangeTickets.length;
  const openTickets = inRangeTickets.filter((t) => t.status === 'open').length;
  const inProgressTickets = inRangeTickets.filter((t) => t.status === 'in_progress').length;
  const resolvedTickets = inRangeTickets.filter((t) => DONE_SET.has(t.status)).length;
  const completionRate = totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0;

  const overdueTickets = inRangeTickets.filter(
    (t) => !DONE_SET.has(t.status) && t.due_date && t.due_date < dateRange.endDate
  );

  const urgentTickets = inRangeTickets.filter(
    (t) => !DONE_SET.has(t.status) && (t.priority === 'urgent' || t.priority === 'high')
  );

  // Workforce KPIs
  const activeEmployees = employees.filter((e) => e.active === 1 && e.role !== 'client');
  const departments = [...new Set(activeEmployees.map((e) => e.department).filter(Boolean))];
  const totalMonthlyPayroll = Math.round(
    activeEmployees.reduce((sum, e) => sum + (Number(e.base_salary) || 0), 0) * monthsMult
  );

  // Time & Work Logging KPIs
  const totalLoggedMinutes = filteredTimeLogs.reduce(
    (sum, l) => sum + (Number(l.duration_minutes) || Math.round(Number(l.seconds || 0) / 60)),
    0
  );
  const taskSheetHours = filteredTaskSheets.reduce((sum, s) => sum + (Number(s.hours_worked) || 0), 0);
  const distinctLoggers = new Set(filteredTimeLogs.map((l) => l.user_id).filter(Boolean)).size;

  // Project Progress KPIs
  const projectStats = projects.map((p) => {
    const projTickets = inRangeTickets.filter((t) => Number(t.project_id) === Number(p.id));
    const done = projTickets.filter((t) => DONE_SET.has(t.status)).length;
    const pct = projTickets.length > 0 ? Math.round((done / projTickets.length) * 100) : 0;
    const overdue = projTickets.filter(
      (t) => !DONE_SET.has(t.status) && t.due_date && t.due_date < dateRange.endDate
    ).length;
    const budget = projTickets.reduce((sum, t) => sum + (Number(t.budget) || 0), 0);
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      color: p.color,
      totalTickets: projTickets.length,
      doneTickets: done,
      progressPct: pct,
      overdueTickets: overdue,
      budget,
    };
  });

  // Approvals & Exceptions
  const productInclusionPending = inRangeTickets.filter(
    (t) => t.product_inclusion_status === 'pending_review'
  );

  const unassignedTickets = inRangeTickets.filter(
    (t) => !DONE_SET.has(t.status) && t.assigned_to == null && t.employee_id == null
  );

  const taskSheetBlockers = filteredTaskSheets.filter(
    (s) => s.task_state === 'not_completed' && s.blocker
  );

  // Status Distribution Chart
  const statusCounts = [
    { label: 'Open', key: 'open', count: openTickets, color: '#0052cc' },
    { label: 'In Progress', key: 'in_progress', count: inProgressTickets, color: '#ff991f' },
    { label: 'Resolved / Closed', key: 'resolved', count: resolvedTickets, color: '#00875a' },
  ];

  // Priority Distribution Chart
  const priorityCounts = [
    { label: 'Urgent', key: 'urgent', count: inRangeTickets.filter((t) => t.priority === 'urgent').length, color: '#de350b' },
    { label: 'High', key: 'high', count: inRangeTickets.filter((t) => t.priority === 'high').length, color: '#ff5630' },
    { label: 'Medium', key: 'medium', count: inRangeTickets.filter((t) => t.priority === 'medium').length, color: '#ffab00' },
    { label: 'Low', key: 'low', count: inRangeTickets.filter((t) => t.priority === 'low').length, color: '#4c9aff' },
  ];

  // Department workforce breakdown for HR
  const deptEmpMap = {};
  for (const e of activeEmployees) {
    const d = e.department || 'General';
    deptEmpMap[d] = (deptEmpMap[d] || 0) + 1;
  }
  const deptEmployeeCounts = Object.entries(deptEmpMap).map(([label, count]) => ({
    label,
    count,
  }));

  // Department salary breakdown for Finance
  const deptSalMap = {};
  for (const e of activeEmployees) {
    const d = e.department || 'General';
    deptSalMap[d] = (deptSalMap[d] || 0) + Math.round((Number(e.base_salary) || 0) * monthsMult);
  }
  const deptSalaryCounts = Object.entries(deptSalMap).map(([label, count]) => ({
    label,
    count: Math.round(count),
  }));

  // Payment status breakdown for Finance
  const paidEmployeesCount = activeEmployees.filter((e) => e.payment_status === 'paid').length;
  const pendingPayrollCount = activeEmployees.filter((e) => e.payment_status !== 'paid').length;
  const paymentStatusCounts = [
    { label: 'Disbursed / Paid', key: 'paid', count: paidEmployeesCount, color: '#00875a' },
    { label: 'Pending / Unpaid', key: 'pending', count: pendingPayrollCount, color: '#ffab00' },
  ];

  const totalProjectBudgets = projectStats.reduce((sum, p) => sum + (Number(p.budget) || 0), 0);

  return {
    dateRange,
    selectedProjectId: projectId,
    projects,
    kpis: {
      totalTickets,
      openTickets,
      inProgressTickets,
      resolvedTickets,
      completionRate,
      overdueCount: overdueTickets.length,
      urgentCount: urgentTickets.length,
      activeEmployeesCount: activeEmployees.length,
      departmentsCount: departments.length,
      totalMonthlyPayroll,
      loggedHours: Math.round((totalLoggedMinutes / 60) * 10) / 10,
      taskSheetHours: Math.round(taskSheetHours * 10) / 10,
      distinctLoggers,
      activeProjectsCount: projects.length,
      unassignedCount: unassignedTickets.length,
      pendingApprovalsCount: productInclusionPending.length,
      blockersCount: taskSheetBlockers.length,
      totalProjectBudgets,
      paidEmployeesCount,
      pendingPayrollCount,
    },
    charts: {
      statusCounts,
      priorityCounts,
      projectStats,
      deptEmployeeCounts,
      deptSalaryCounts,
      paymentStatusCounts,
    },
    exceptions: {
      overdueTickets: overdueTickets.slice(0, 10).map((t) => ({
        id: t.id,
        key: ticketKey(t),
        title: t.title,
        dueDate: t.due_date,
        priority: t.priority,
        projectName: t.project_name,
        employeeName: t.employee_name || 'Unassigned',
      })),
      pendingApprovals: productInclusionPending.slice(0, 10).map((t) => ({
        id: t.id,
        key: ticketKey(t),
        title: t.title,
        projectName: t.project_name,
        status: t.product_inclusion_status,
        submittedAt: t.created_at,
      })),
      blockers: taskSheetBlockers.slice(0, 10).map((s) => ({
        id: s.id,
        name: s.name,
        project: s.project,
        taskTitle: s.task_title,
        blocker: s.blocker,
        createdAt: s.created_at,
      })),
    },
    charts: {
      statusCounts,
      priorityCounts,
      projectStats,
      deptEmployeeCounts,
      deptSalaryCounts,
      paymentStatusCounts,
    },
  };
}

/**
 * Fetches personal developer dashboard data for the Employee Dashboard
 */
export async function getEmployeeDashboardSummary({
  userId,
  employeeId,
  preset = 'this_month',
  startDate = '',
  endDate = '',
  projectId = 'all',
}) {
  const dateRange = resolveDateRange({ preset, startDate, endDate });
  const todayStr = new Date().toISOString().slice(0, 10);

  // 1. Projects
  const projects = await db
    .prepare('SELECT id, key, name, color FROM projects ORDER BY name ASC')
    .all();

  // 2. My Tickets
  const tickets = await db
    .prepare(
      `SELECT t.*, p.key AS project_key, p.name AS project_name
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.archived = 0 AND (t.assigned_to = ? OR t.employee_id = ?)
       ORDER BY t.id DESC`
    )
    .all(userId, employeeId || -1);

  // 3. My Time Logs
  const timeLogs = await db
    .prepare(
      `SELECT tl.*, t.title AS ticket_title, p.key AS project_key
       FROM ticket_time_logs tl
       JOIN tickets t ON t.id = tl.ticket_id
       JOIN projects p ON p.id = t.project_id
       WHERE tl.user_id = ?
       ORDER BY tl.created_at DESC`
    )
    .all(userId);

  // 4. My Task Sheets
  const userRow = await db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  const userName = userRow?.name || '';

  const taskSheets = await db
    .prepare(
      `SELECT * FROM task_sheet_submissions
       WHERE submitted_by = ? OR name = ?
       ORDER BY created_at DESC`
    )
    .all(userId, userName);

  // Filter by project and date range
  const filteredTickets = tickets.filter((t) => {
    if (projectId !== 'all' && String(t.project_id) !== String(projectId)) return false;
    const created = parseUtcDate(t.created_at);
    if (!created || created.getTime() > dateRange.endMs) return false;
    if (DONE_SET.has(t.status)) {
      const resolved = parseUtcDate(t.updated_at || t.created_at);
      if (resolved && resolved.getTime() < dateRange.startMs) return false;
    }
    return true;
  });

  const filteredTimeLogs = timeLogs.filter((l) => {
    const d = l.work_date || l.created_at;
    return isWithinRange(d, dateRange.startMs, dateRange.endMs);
  });

  const filteredTaskSheets = taskSheets.filter((s) => {
    return isWithinRange(s.created_at, dateRange.startMs, dateRange.endMs);
  });

  // Buckets
  const dueTodayTickets = [];
  const todoTickets = [];
  const completedTickets = [];
  const overdueTickets = [];

  for (const t of filteredTickets) {
    if (DONE_SET.has(t.status)) {
      completedTickets.push(t);
    } else if (t.due_date && t.due_date < todayStr) {
      overdueTickets.push(t);
      todoTickets.push(t);
    } else if (t.due_date === todayStr) {
      dueTodayTickets.push(t);
    } else {
      todoTickets.push(t);
    }
  }

  // Work time calculations
  const totalLoggedMins = filteredTimeLogs.reduce(
    (sum, l) => sum + (Number(l.duration_minutes) || Math.round(Number(l.seconds || 0) / 60)),
    0
  );
  const taskSheetHours = filteredTaskSheets.reduce(
    (sum, s) => sum + (Number(s.hours_worked) || 0),
    0
  );

  // Blockers reported
  const myBlockers = filteredTaskSheets.filter(
    (s) => s.task_state === 'not_completed' && s.blocker
  );

  const totalAssigned = filteredTickets.length;
  const completionRate =
    totalAssigned > 0 ? Math.round((completedTickets.length / totalAssigned) * 100) : 0;

  return {
    dateRange,
    selectedProjectId: projectId,
    projects,
    kpis: {
      assignedTotal: totalAssigned,
      dueTodayCount: dueTodayTickets.length,
      todoCount: todoTickets.length,
      completedCount: completedTickets.length,
      overdueCount: overdueTickets.length,
      completionRate,
      loggedHours: Math.round((totalLoggedMins / 60) * 10) / 10,
      taskSheetHours: Math.round(taskSheetHours * 10) / 10,
      blockersCount: myBlockers.length,
    },
    sections: {
      dueToday: dueTodayTickets,
      todo: todoTickets,
      completed: completedTickets,
      overdue: overdueTickets,
      recentTimeLogs: filteredTimeLogs.slice(0, 10),
      recentTaskSheets: filteredTaskSheets.slice(0, 10),
      blockers: myBlockers,
    },
  };
}

/**
 * Execute report query and calculations for any of the 76 catalogue reports
 */
export async function getReportExecutionData({
  reportSlug,
  filters = {},
  currentUser,
}) {
  const reportDef = getReportBySlug(reportSlug);
  if (!reportDef) {
    throw new Error(`Report "${reportSlug}" not found in catalogue.`);
  }

  const isAdmin = currentUser.role === 'admin';
  const isDeveloper = currentUser.role === 'developer';

  // Role Security Check
  if (currentUser.role === 'client') {
    throw new Error('Client role does not have authorization to access internal reports.');
  }

  // Section 4 (Salary/Payroll) and Section 6 (Business Finance) are strictly admin only!
  if (!isAdmin && (reportDef.sectionSlug === 'salary-payroll-and-cost' || reportDef.sectionSlug === 'finance-and-startup-expense')) {
    throw new Error('Access denied. Salary, payroll, and financial reports are restricted to authorized administrators.');
  }

  const dateRange = resolveDateRange({
    preset: filters.preset || 'this_month',
    startDate: filters.startDate || '',
    endDate: filters.endDate || '',
  });

  const selectedProjectId = filters.projectId || 'all';
  const selectedEmployeeId = filters.employeeId || 'all';
  const selectedDepartment = filters.department || 'all';
  const selectedStatus = filters.status || 'all';
  const selectedPriority = filters.priority || 'all';
  const selectedClientId = filters.clientId || 'all';
  const searchQuery = (filters.search || '').trim().toLowerCase();

  // If report data is not yet collected by the system, return informative structure with empty rows
  if (!reportDef.dataAvailable) {
    return {
      report: reportDef,
      dateRange,
      kpis: (reportDef.kpis || []).map((k) => ({
        key: k,
        label: formatKpiLabel(k),
        value: '—',
        subtitle: 'Awaiting integration',
      })),
      columns: [
        { key: 'item', label: 'Item / Record' },
        { key: 'category', label: 'Category' },
        { key: 'status', label: 'Status' },
        { key: 'date', label: 'Date' },
        { key: 'details', label: 'Notes' },
      ],
      rows: [],
      series: [],
      chartType: reportDef.chartType || 'bar',
      totalCount: 0,
      unavailableNotice: reportDef.unavailableNotice,
    };
  }

  // Common data queries
  let allProjects = await db.prepare('SELECT id, key, name, color, client_id, workspace_id, created_at FROM projects ORDER BY name ASC').all();
  let allEmployees = await db
    .prepare('SELECT id, name, email, role, department, title, base_salary, salary_currency, payment_status, active, user_id, created_at FROM employees ORDER BY name ASC')
    .all();

  if (selectedProjectId !== 'all') {
    allProjects = allProjects.filter((p) => p.id === Number(selectedProjectId));
  }
  if (selectedClientId !== 'all') {
    allProjects = allProjects.filter((p) => p.client_id === Number(selectedClientId));
  }
  if (selectedDepartment !== 'all') {
    allEmployees = allEmployees.filter((e) => e.department === selectedDepartment);
  }
  if (selectedEmployeeId !== 'all') {
    allEmployees = allEmployees.filter((e) => e.id === Number(selectedEmployeeId) || e.user_id === Number(selectedEmployeeId));
  }

  let ticketsQuery = `
    SELECT t.*, p.key AS project_key, p.name AS project_name, p.client_id, e.name AS employee_name, e.department AS employee_department, u.name AS creator_name
    FROM tickets t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN employees e ON e.id = t.employee_id
    LEFT JOIN users u ON u.id = t.created_by
    WHERE t.archived = 0
  `;
  const tParams = [];
  if (selectedProjectId !== 'all') {
    ticketsQuery += ' AND t.project_id = ?';
    tParams.push(Number(selectedProjectId));
  }
  if (selectedClientId !== 'all') {
    ticketsQuery += ' AND p.client_id = ?';
    tParams.push(Number(selectedClientId));
  }
  if (selectedDepartment !== 'all') {
    ticketsQuery += ' AND e.department = ?';
    tParams.push(selectedDepartment);
  }
  if (!isAdmin) {
    // Developers can only see tasks assigned to them or created by them
    ticketsQuery += ' AND (t.assigned_to = ? OR t.employee_id = ? OR t.created_by = ?)';
    tParams.push(currentUser.id, currentUser.employee_id || -1, currentUser.id);
  } else if (selectedEmployeeId !== 'all') {
    ticketsQuery += ' AND (t.employee_id = ? OR t.assigned_to = ?)';
    tParams.push(Number(selectedEmployeeId), Number(selectedEmployeeId));
  }
  if (selectedStatus !== 'all') {
    ticketsQuery += ' AND t.status = ?';
    tParams.push(selectedStatus);
  }
  if (selectedPriority !== 'all') {
    ticketsQuery += ' AND t.priority = ?';
    tParams.push(selectedPriority);
  }

  const tickets = await db.prepare(ticketsQuery).all(...tParams);

  // Compute specific report data
  const result = await generateSpecificReportData({
    reportDef,
    tickets,
    allProjects,
    allEmployees,
    dateRange,
    filters,
    searchQuery,
    currentUser,
    isAdmin,
  });

  return {
    report: reportDef,
    dateRange,
    ...result,
  };
}

function formatKpiLabel(key) {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Report calculations dispatcher
 */
async function generateSpecificReportData({
  reportDef,
  tickets,
  allProjects,
  allEmployees,
  dateRange,
  filters,
  searchQuery,
  currentUser,
  isAdmin,
}) {
  // Query supplementary data tables needed across report categories
  let [timeLogs, taskSheets, activities] = await Promise.all([
    db.prepare(`
      SELECT tl.*, t.title AS ticket_title, p.key AS project_key, p.name AS project_name, p.client_id, u.name AS user_name, e.department AS employee_department
      FROM ticket_time_logs tl
      JOIN tickets t ON t.id = tl.ticket_id
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = tl.user_id
      LEFT JOIN employees e ON e.user_id = u.id
      ORDER BY tl.created_at DESC
    `).all(),
    db.prepare(`
      SELECT ts.*, e.department AS employee_department
      FROM task_sheet_submissions ts
      LEFT JOIN employees e ON e.user_id = ts.submitted_by
      ORDER BY ts.created_at DESC
    `).all(),
    db.prepare(`
      SELECT a.*, u.name AS actor_name, t.title AS ticket_title, t.project_id, p.key AS project_key, p.client_id
      FROM ticket_activity a
      LEFT JOIN users u ON u.id = a.actor_id
      LEFT JOIN tickets t ON t.id = a.ticket_id
      LEFT JOIN projects p ON p.id = t.project_id
      ORDER BY a.created_at DESC
    `).all(),
  ]);

  if (filters.projectId && filters.projectId !== 'all') {
    timeLogs = timeLogs.filter((tl) => Number(tl.project_id) === Number(filters.projectId));
    activities = activities.filter((a) => Number(a.project_id) === Number(filters.projectId));
  }
  if (filters.clientId && filters.clientId !== 'all') {
    timeLogs = timeLogs.filter((tl) => Number(tl.client_id) === Number(filters.clientId));
    activities = activities.filter((a) => Number(a.client_id) === Number(filters.clientId));
  }
  if (filters.employeeId && filters.employeeId !== 'all') {
    timeLogs = timeLogs.filter((tl) => Number(tl.user_id) === Number(filters.employeeId));
    taskSheets = taskSheets.filter(
      (ts) => Number(ts.employee_id) === Number(filters.employeeId) || Number(ts.submitted_by) === Number(filters.employeeId)
    );
    activities = activities.filter((a) => Number(a.user_id) === Number(filters.employeeId));
  }
  if (filters.department && filters.department !== 'all') {
    timeLogs = timeLogs.filter((tl) => tl.employee_department === filters.department);
    taskSheets = taskSheets.filter((ts) => ts.employee_department === filters.department);
  }

  return calculateReportData({
    reportDef,
    tickets,
    allProjects,
    allEmployees,
    timeLogs,
    taskSheets,
    activities,
    dateRange,
    filters,
    searchQuery,
    currentUser,
    isAdmin,
    db,
  });
}

