import ExcelJS from 'exceljs';
import { STATUS_META, PRIORITY_META } from './ticketMeta.js';

/**
 * Sanitizes untrusted user strings against spreadsheet formula injection (CSV/Excel DDE injection).
 * If a string begins with dangerous characters (=, +, -, @, tab, CR), prefixes it with a single apostrophe.
 * Preserves numeric, boolean, date, and null values safely without coercing them to strings.
 *
 * @param {any} value
 * @returns {any} Sanitized value safe for Excel cells
 */
export function sanitizeExcelValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) {
    return value;
  }
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

const BRAND_BLUE = 'FF0C66E4';
const BRAND_DARK = 'FF091E42';
const HEADER_BG = 'FF0C66E4';
const HEADER_FONT = 'FFFFFFFF';
const SUBHEADER_BG = 'FFDEEBFF';
const SUBHEADER_FONT = 'FF0747A6';
const CARD_BG = 'FFF4F5F7';
const OVERDUE_BG = 'FFFFEBE6';
const OVERDUE_FONT = 'FFBF2600';
const BORDER_COLOR = 'FFDFE1E6';

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: BORDER_COLOR } },
  left: { style: 'thin', color: { argb: BORDER_COLOR } },
  bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
  right: { style: 'thin', color: { argb: BORDER_COLOR } },
};

function applyHeaderStyle(row) {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: HEADER_FONT } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = THIN_BORDER;
  });
  row.height = 26;
}

function applyDataRowStyle(row, { isOverdue = false } = {}) {
  row.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 10, color: { argb: BRAND_DARK } };
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle' };
    if (isOverdue) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OVERDUE_BG } };
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: OVERDUE_FONT } };
    }
  });
}

function autoFitColumns(sheet, { minWidth = 12, maxWidth = 55 } = {}) {
  sheet.columns.forEach((column) => {
    let max = minWidth;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value ? String(cell.value) : '';
      if (v.length > max) {
        max = Math.min(v.length, maxWidth);
      }
    });
    column.width = max + 3;
  });
}

/**
 * Generates the complete 7-sheet Company Weekly AI Ticket Report Excel workbook buffer.
 *
 * @param {{ reportData: object, aiInsights?: object }} options
 * @returns {Promise<Buffer>} In-memory binary Excel workbook buffer (.xlsx)
 */
export async function generateCompanyWorkbookBuffer({ reportData, aiInsights = {} }) {
  if (!reportData || !reportData.executiveSummary) {
    throw new Error('Invalid report data passed to Excel generator.');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SerpHawk Ticketing AI';
  workbook.created = new Date();
  workbook.properties.date1904 = false;

  const kpis = reportData.executiveSummary.companyKPIs || {};
  const weekly = reportData.executiveSummary.weeklyActivityKPIs || {};
  const period = reportData.period || {};

  // -------------------------------------------------------------
  // Sheet 1: Executive Summary
  // -------------------------------------------------------------
  const wsExec = workbook.addWorksheet('Executive Summary', {
    views: [{ showGridLines: true }],
  });

  // Title & Metadata
  wsExec.addRow([sanitizeExcelValue('COMPANY WEEKLY AI TICKET REPORT')]);
  wsExec.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: BRAND_BLUE } };

  wsExec.addRow([
    sanitizeExcelValue(`Reporting Period: ${period.startIstLabel || 'N/A'} to ${period.endIstLabel || 'N/A'} (${period.timezone || 'Asia/Kolkata'}) | Duration: ${period.durationHours || 168} hrs`),
  ]);
  wsExec.getCell('A2').font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF5E6C84' } };

  wsExec.addRow([]); // Blank line 3

  // Company KPI Cards Header
  wsExec.addRow([sanitizeExcelValue('ALL-TIME CUMULATIVE SNAPSHOT (AUTHORITATIVE METRICS)')]);
  wsExec.getCell('A4').font = { name: 'Calibri', size: 11, bold: true, color: { argb: SUBHEADER_FONT } };

  // KPI Cards Table
  const kpiHeader = wsExec.addRow([
    'Total Work Items',
    'Open Tickets',
    'In Progress',
    'Resolved (QA)',
    'Closed',
    'Completion %',
    'Overdue Tickets',
    'Blocked Tickets',
    'Active Projects',
    'Active Employees',
  ]);
  applyHeaderStyle(kpiHeader);

  const kpiData = wsExec.addRow([
    kpis.totalCumulativeTickets ?? 0,
    kpis.statusCounts?.open ?? 0,
    kpis.statusCounts?.in_progress ?? 0,
    kpis.statusCounts?.resolved ?? 0,
    kpis.statusCounts?.closed ?? 0,
    `${kpis.completionPercentage ?? 0}%`,
    kpis.totalOverdueTickets ?? 0,
    kpis.totalBlockedTickets ?? 0,
    kpis.totalProjects ?? 0,
    kpis.totalEmployees ?? 0,
  ]);
  kpiData.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: BRAND_DARK } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CARD_BG } };
    cell.border = THIN_BORDER;
  });
  kpiData.height = 24;

  wsExec.addRow([]); // Blank line 7

  // Weekly Delta Activity Header
  wsExec.addRow([sanitizeExcelValue(`WEEKLY ACTIVITY DELTA [${period.startIstLabel} - ${period.endIstLabel})`)]);
  wsExec.getCell('A8').font = { name: 'Calibri', size: 11, bold: true, color: { argb: SUBHEADER_FONT } };

  const weeklyHeader = wsExec.addRow([
    'Tickets Created',
    'Tickets Completed',
    'Tickets Reopened',
    'Tickets Updated',
    'Reassignments',
    'Blockers Logged',
    'Net Velocity Ratio',
  ]);
  applyHeaderStyle(weeklyHeader);

  const netVelocityRatio = weekly.weeklyCreatedCount > 0
    ? `${Math.round((weekly.weeklyCompletedCount / weekly.weeklyCreatedCount) * 100)}%`
    : '100%';

  const weeklyData = wsExec.addRow([
    weekly.weeklyCreatedCount ?? 0,
    weekly.weeklyCompletedCount ?? 0,
    weekly.weeklyReopenedCount ?? 0,
    weekly.weeklyUpdatedCount ?? 0,
    weekly.weeklyReassignedCount ?? 0,
    (reportData.blockersAndOverdue || []).filter((b) => b.isBlocked).length,
    netVelocityRatio,
  ]);
  weeklyData.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: BRAND_DARK } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CARD_BG } };
    cell.border = THIN_BORDER;
  });
  weeklyData.height = 22;

  wsExec.addRow([]); // Blank line 11

  // Priority Breakdown Table
  wsExec.addRow([sanitizeExcelValue('PRIORITY WORKLOAD DISTRIBUTION')]);
  wsExec.getCell('A12').font = { name: 'Calibri', size: 11, bold: true, color: { argb: SUBHEADER_FONT } };

  const priorityHeader = wsExec.addRow(['Priority Tier', 'Active Work Items', 'Percentage of Total', 'Target Resolution SLA']);
  applyHeaderStyle(priorityHeader);

  const total = kpis.totalCumulativeTickets || 1;
  const priorities = [
    { name: 'Urgent', count: kpis.priorityCounts?.urgent ?? 0, sla: '4 Business Hours' },
    { name: 'High', count: kpis.priorityCounts?.high ?? 0, sla: '8 Business Hours' },
    { name: 'Medium', count: kpis.priorityCounts?.medium ?? 0, sla: '24 Business Hours (3 Days)' },
    { name: 'Low', count: kpis.priorityCounts?.low ?? 0, sla: '24 Business Hours' },
  ];

  for (const p of priorities) {
    const row = wsExec.addRow([
      p.name,
      p.count,
      `${Math.round((p.count / total) * 100)}%`,
      p.sla,
    ]);
    applyDataRowStyle(row);
  }

  autoFitColumns(wsExec, { minWidth: 16 });

  // -------------------------------------------------------------
  // Sheet 2: Project Summary
  // -------------------------------------------------------------
  const wsProj = workbook.addWorksheet('Project Summary', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  const projHeaders = [
    'Project Key',
    'Project Name',
    'Status',
    'Total Tickets',
    'Open Tickets',
    'In Progress',
    'Closed / Resolved',
    'Overdue Tickets',
    'Blocked Tickets',
    'Weekly Created',
    'Weekly Completed',
    'Completion %',
    'Target End Date',
  ];
  const pHeaderRow = wsProj.addRow(projHeaders);
  applyHeaderStyle(pHeaderRow);

  for (const p of reportData.projectSummary || []) {
    const row = wsProj.addRow([
      sanitizeExcelValue(p.key),
      sanitizeExcelValue(p.name),
      sanitizeExcelValue(p.status),
      p.totalTickets,
      p.openTickets,
      // in_progress is within openTickets, calculate if needed
      Math.max(0, p.openTickets),
      p.closedTickets,
      p.overdueTickets,
      p.blockedTickets,
      p.weeklyCreated,
      p.weeklyCompleted,
      `${p.completionPercentage}%`,
      sanitizeExcelValue(p.targetEndDate || 'None'),
    ]);
    applyDataRowStyle(row, { isOverdue: p.overdueTickets > 0 });
  }

  wsProj.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, (reportData.projectSummary || []).length + 1), column: projHeaders.length },
  };
  autoFitColumns(wsProj);

  // -------------------------------------------------------------
  // Sheet 3: Employee Summary
  // -------------------------------------------------------------
  const wsEmp = workbook.addWorksheet('Employee Summary', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  const empHeaders = [
    'Employee Name',
    'Department',
    'Designation / Role',
    'Active Status',
    'Total Assigned Tickets',
    'Open Tickets',
    'Closed Tickets',
    'Overdue Tickets',
    'Blocked Tickets',
    'Weekly Completed (Attributed)',
    'Workload Status',
  ];
  const empHeaderRow = wsEmp.addRow(empHeaders);
  applyHeaderStyle(empHeaderRow);

  for (const emp of reportData.employeeSummary || []) {
    const row = wsEmp.addRow([
      sanitizeExcelValue(emp.name),
      sanitizeExcelValue(emp.department),
      sanitizeExcelValue(emp.title),
      emp.isActive ? 'Active' : 'Inactive',
      emp.totalAssigned,
      emp.openTickets,
      emp.closedTickets,
      emp.overdueTickets,
      emp.blockedTickets,
      emp.weeklyCompleted,
      sanitizeExcelValue(emp.workloadStatus),
    ]);
    applyDataRowStyle(row, { isOverdue: emp.overdueTickets > 0 });
  }

  wsEmp.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, (reportData.employeeSummary || []).length + 1), column: empHeaders.length },
  };
  autoFitColumns(wsEmp);

  // -------------------------------------------------------------
  // Sheet 4: Complete Ticket Register
  // -------------------------------------------------------------
  const wsTickets = workbook.addWorksheet('Complete Ticket Register', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  const ticketHeaders = [
    'Ticket ID',
    'Title',
    'Project',
    'Assignee',
    'Status',
    'Priority',
    'Type',
    'Category',
    'Created Date',
    'Due Date',
    'Completed Date',
    'Days Overdue',
    'Blocker Status',
    'Blocker Reason',
    'Last Updated',
  ];
  const tHeaderRow = wsTickets.addRow(ticketHeaders);
  applyHeaderStyle(tHeaderRow);

  for (const t of reportData.completeTicketRegister || []) {
    const row = wsTickets.addRow([
      sanitizeExcelValue(t.key),
      sanitizeExcelValue(t.title),
      sanitizeExcelValue(t.project),
      sanitizeExcelValue(t.assignee),
      sanitizeExcelValue(t.status),
      sanitizeExcelValue(t.priority),
      sanitizeExcelValue(t.type),
      sanitizeExcelValue(t.category),
      sanitizeExcelValue(t.createdDate),
      sanitizeExcelValue(t.dueDate),
      sanitizeExcelValue(t.completedDate),
      t.daysOverdue > 0 ? t.daysOverdue : 0,
      sanitizeExcelValue(t.blockerClassification),
      sanitizeExcelValue(t.blockerReason),
      sanitizeExcelValue(t.lastUpdated),
    ]);
    applyDataRowStyle(row, { isOverdue: t.isOverdue });
  }

  wsTickets.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, (reportData.completeTicketRegister || []).length + 1), column: ticketHeaders.length },
  };
  autoFitColumns(wsTickets, { maxWidth: 50 });

  // -------------------------------------------------------------
  // Sheet 5: Blockers & Overdue
  // -------------------------------------------------------------
  const wsBlockers = workbook.addWorksheet('Blockers & Overdue', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  const blockerHeaders = [
    'Ticket ID',
    'Title',
    'Project',
    'Assignee',
    'Current Status',
    'Due Date',
    'Days Overdue',
    'Blocker Classification',
    'Blocker Reason / Dependency',
    'Recommended Action',
  ];
  const bHeaderRow = wsBlockers.addRow(blockerHeaders);
  applyHeaderStyle(bHeaderRow);

  for (const item of reportData.blockersAndOverdue || []) {
    const row = wsBlockers.addRow([
      sanitizeExcelValue(item.key),
      sanitizeExcelValue(item.title),
      sanitizeExcelValue(item.project),
      sanitizeExcelValue(item.assignee),
      sanitizeExcelValue(item.status),
      sanitizeExcelValue(item.dueDate || 'None'),
      item.daysOverdue > 0 ? item.daysOverdue : 0,
      sanitizeExcelValue(item.blockerClassification),
      sanitizeExcelValue(item.blockerReason || 'None'),
      sanitizeExcelValue(item.recommendedAction),
    ]);
    applyDataRowStyle(row, { isOverdue: item.isOverdue });
  }

  wsBlockers.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, (reportData.blockersAndOverdue || []).length + 1), column: blockerHeaders.length },
  };
  autoFitColumns(wsBlockers, { maxWidth: 50 });

  // -------------------------------------------------------------
  // Sheet 6: AI Insights
  // -------------------------------------------------------------
  const wsAi = workbook.addWorksheet('AI Insights', {
    views: [{ showGridLines: true }],
  });

  const isAiAvailable = Boolean(aiInsights.aiAvailable);
  const headline = aiInsights.headline || 'Executive Weekly Performance Review';
  const executiveSummary = aiInsights.executiveSummary || 'Weekly progress summary derived from authoritative database records.';
  const modelTag = aiInsights.modelName || 'Database Verified Metrics';

  wsAi.addRow([sanitizeExcelValue('AI EXECUTIVE ANALYSIS & OPERATIONAL INSIGHTS')]);
  wsAi.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: BRAND_BLUE } };

  wsAi.addRow([
    sanitizeExcelValue(
      `Status: ${isAiAvailable ? 'Operational' : 'Unavailable (Database Fallback Active)'} | Engine: ${modelTag} | Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} IST`
    ),
  ]);
  wsAi.getCell('A2').font = { name: 'Calibri', size: 10, italic: true, color: { argb: isAiAvailable ? 'FF00875A' : 'FFBF2600' } };

  wsAi.addRow([]); // Blank line 3

  // Headline
  wsAi.addRow([sanitizeExcelValue(headline)]);
  wsAi.getCell('A4').font = { name: 'Calibri', size: 13, bold: true, color: { argb: BRAND_DARK } };

  // Executive Narrative
  wsAi.addRow([sanitizeExcelValue(executiveSummary)]);
  wsAi.getCell('A5').font = { name: 'Calibri', size: 11, color: { argb: BRAND_DARK } };
  wsAi.getCell('A5').alignment = { wrapText: true };
  wsAi.getRow(5).height = 45;

  wsAi.addRow([]); // Blank line 6

  const renderAiSection = (title, items, startRow) => {
    wsAi.addRow([sanitizeExcelValue(title)]);
    const hRow = wsAi.lastRow;
    hRow.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: SUBHEADER_FONT } };
    hRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBHEADER_BG } };

    if (!items || items.length === 0) {
      wsAi.addRow([sanitizeExcelValue('  • No specific observations recorded.')]);
      wsAi.lastRow.getCell(1).font = { name: 'Calibri', size: 10, italic: true };
    } else {
      for (const item of items) {
        wsAi.addRow([sanitizeExcelValue(`  • ${item}`)]);
        const r = wsAi.lastRow;
        r.getCell(1).font = { name: 'Calibri', size: 10, color: { argb: BRAND_DARK } };
        r.getCell(1).alignment = { wrapText: true };
      }
    }
    wsAi.addRow([]); // Blank line
  };

  renderAiSection('KEY OPERATIONAL OBSERVATIONS', aiInsights.keyObservations);
  renderAiSection('DELIVERY RISKS & DEADLINE CONCERNS', aiInsights.deliveryRisks);
  renderAiSection('PROJECT BOTTLENECKS & WORKLOAD OBSERVATIONS', aiInsights.projectBottlenecks);
  renderAiSection('BLOCKER PATTERNS & SYSTEMIC DEPENDENCIES', aiInsights.blockerPatterns);
  renderAiSection('GROUNDED MANAGEMENT RECOMMENDATIONS', aiInsights.groundedRecommendations);

  if (aiInsights.referencedTicketIds && aiInsights.referencedTicketIds.length > 0) {
    wsAi.addRow([sanitizeExcelValue('REFERENCED TICKET IDENTIFIERS')]);
    wsAi.lastRow.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: SUBHEADER_FONT } };
    wsAi.addRow([sanitizeExcelValue(`  ${aiInsights.referencedTicketIds.join(', ')}`)]);
    wsAi.lastRow.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND_BLUE } };
  }

  wsAi.getColumn(1).width = 110;

  // -------------------------------------------------------------
  // Sheet 7: Weekly Activity
  // -------------------------------------------------------------
  const wsActivity = workbook.addWorksheet('Weekly Activity', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  const actHeaders = [
    'Timestamp (UTC / Recorded)',
    'Ticket ID',
    'Ticket Title',
    'Project',
    'Actor',
    'Action / Field',
    'Previous Value',
    'New Value',
    'Blocker Note',
    'Reason / Context',
  ];
  const aHeaderRow = wsActivity.addRow(actHeaders);
  applyHeaderStyle(aHeaderRow);

  for (const act of reportData.weeklyActivity || []) {
    const row = wsActivity.addRow([
      sanitizeExcelValue(act.timestamp),
      sanitizeExcelValue(act.ticketKey),
      sanitizeExcelValue(act.ticketTitle),
      sanitizeExcelValue(act.project),
      sanitizeExcelValue(act.actor),
      sanitizeExcelValue(act.field),
      sanitizeExcelValue(act.fromValue),
      sanitizeExcelValue(act.toValue),
      sanitizeExcelValue(act.blocker || ''),
      sanitizeExcelValue(act.reason || ''),
    ]);
    applyDataRowStyle(row);
  }

  wsActivity.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, (reportData.weeklyActivity || []).length + 1), column: actHeaders.length },
  };
  autoFitColumns(wsActivity, { maxWidth: 50 });

  // -------------------------------------------------------------
  // Final Buffer Conversion
  // -------------------------------------------------------------
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Generates an individual, strictly scoped 6-sheet Employee Weekly Report Excel workbook buffer.
 * Contains only data belonging to the designated employee.
 *
 * @param {{
 *   employeeReportData: object,
 *   aiObservations?: object,
 *   period?: object
 * }} options
 * @returns {Promise<Buffer>} In-memory binary Excel workbook buffer (.xlsx)
 */
export async function generateEmployeeWorkbookBuffer({ employeeReportData, aiObservations = {}, period = {} }) {
  if (!employeeReportData || !employeeReportData.employee) {
    throw new Error('Invalid employee report data passed to Excel generator.');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SerpHawk Ticketing AI';
  workbook.created = new Date();
  workbook.properties.date1904 = false;

  const emp = employeeReportData.employee;
  const kpis = employeeReportData.kpis || {};
  const activeTickets = employeeReportData.activeTickets || [];
  const completedTickets = employeeReportData.completedTickets || [];
  const overdueTickets = employeeReportData.overdueTickets || [];
  const blockedTickets = employeeReportData.blockedTickets || [];
  const recentActivity = employeeReportData.recentActivity || [];

  // -------------------------------------------------------------
  // Sheet 1: My Work Overview
  // -------------------------------------------------------------
  const wsOverview = workbook.addWorksheet('My Work Overview', {
    views: [{ showGridLines: true }],
  });

  wsOverview.addRow([sanitizeExcelValue(`WEEKLY WORK REPORT — ${emp.name.toUpperCase()}`)]);
  wsOverview.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: BRAND_BLUE } };

  wsOverview.addRow([
    sanitizeExcelValue(`Role: ${emp.title} | Department: ${emp.department} | Period: ${period.startIstLabel || 'N/A'} to ${period.endIstLabel || 'N/A'}`),
  ]);
  wsOverview.getCell('A2').font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF5E6C84' } };

  wsOverview.addRow([]); // Blank line 3

  wsOverview.addRow([sanitizeExcelValue('CURRENT WORKLOAD & VELOCITY SNAPSHOT')]);
  wsOverview.getCell('A4').font = { name: 'Calibri', size: 11, bold: true, color: { argb: SUBHEADER_FONT } };

  const kpiHeaders = [
    'Total Assigned',
    'Open / Active',
    'Completed',
    'Overdue Tasks',
    'Blocked Tasks',
    'Weekly Completed',
    'Workload Status',
  ];
  const hRow = wsOverview.addRow(kpiHeaders);
  applyHeaderStyle(hRow);

  const workloadLabel = kpis.totalAssigned === 0
    ? 'Available / Zero Assignment'
    : kpis.overdueCount > 0
      ? 'Attention Required (Overdue)'
      : kpis.openCount > 5
        ? 'High Workload'
        : 'Normal';

  const dRow = wsOverview.addRow([
    kpis.totalAssigned ?? 0,
    kpis.openCount ?? 0,
    kpis.completedCount ?? 0,
    kpis.overdueCount ?? 0,
    kpis.blockedCount ?? 0,
    kpis.weeklyCompleted ?? 0,
    sanitizeExcelValue(workloadLabel),
  ]);
  dRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: BRAND_DARK } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CARD_BG } };
    cell.border = THIN_BORDER;
  });
  dRow.height = 24;

  wsOverview.addRow([]); // Blank line 7

  if (kpis.totalAssigned === 0) {
    wsOverview.addRow([sanitizeExcelValue('STATUS NOTE: No active work items currently assigned. Capacity is open for upcoming sprint allocations.')]);
    wsOverview.lastRow.getCell(1).font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FF00875A' } };
  } else {
    wsOverview.addRow([sanitizeExcelValue(`SUMMARY: You have ${kpis.openCount} active task(s) currently open, with ${kpis.completedCount} total deliverables completed to date.`)]);
    wsOverview.lastRow.getCell(1).font = { name: 'Calibri', size: 11, color: { argb: BRAND_DARK } };
  }

  autoFitColumns(wsOverview, { minWidth: 16 });

  // -------------------------------------------------------------
  // Sheet 2: Active & Upcoming Tickets
  // -------------------------------------------------------------
  const wsActive = workbook.addWorksheet('Active & Upcoming Tickets', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  const actHeaders = [
    'Ticket ID',
    'Title',
    'Project',
    'Priority',
    'Status',
    'Due Date',
    'Days Overdue',
    'Blocker Status',
    'Blocker Reason / Context',
  ];
  const actHRow = wsActive.addRow(actHeaders);
  applyHeaderStyle(actHRow);

  for (const t of activeTickets) {
    const row = wsActive.addRow([
      sanitizeExcelValue(t.key),
      sanitizeExcelValue(t.title),
      sanitizeExcelValue(t.project),
      sanitizeExcelValue(t.priority),
      sanitizeExcelValue(t.status),
      sanitizeExcelValue(t.dueDate || 'None'),
      t.daysOverdue > 0 ? t.daysOverdue : 0,
      sanitizeExcelValue(t.isBlocked ? 'Blocked' : 'Clear'),
      sanitizeExcelValue(t.blockerReason || 'None'),
    ]);
    applyDataRowStyle(row, { isOverdue: t.isOverdue });
  }

  wsActive.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, activeTickets.length + 1), column: actHeaders.length },
  };
  autoFitColumns(wsActive, { maxWidth: 50 });

  // -------------------------------------------------------------
  // Sheet 3: Completed Tickets
  // -------------------------------------------------------------
  const wsCompleted = workbook.addWorksheet('Completed Tickets', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  const compHeaders = [
    'Ticket ID',
    'Title',
    'Project',
    'Status',
    'Priority',
    'Completed Date',
    'Completion Attribution',
  ];
  const compHRow = wsCompleted.addRow(compHeaders);
  applyHeaderStyle(compHRow);

  for (const t of completedTickets) {
    const row = wsCompleted.addRow([
      sanitizeExcelValue(t.key),
      sanitizeExcelValue(t.title),
      sanitizeExcelValue(t.project),
      sanitizeExcelValue(t.status),
      sanitizeExcelValue(t.priority),
      sanitizeExcelValue(t.completedDate || 'Recorded'),
      sanitizeExcelValue(t.assignee ? `Completed by ${t.assignee}` : 'Verified Completion'),
    ]);
    applyDataRowStyle(row);
  }

  wsCompleted.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, completedTickets.length + 1), column: compHeaders.length },
  };
  autoFitColumns(wsCompleted, { maxWidth: 50 });

  // -------------------------------------------------------------
  // Sheet 4: Overdue & Blockers
  // -------------------------------------------------------------
  const wsRisk = workbook.addWorksheet('Overdue & Blockers', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  const riskHeaders = [
    'Ticket ID',
    'Title',
    'Project',
    'Current Status',
    'Due Date',
    'Days Overdue',
    'Blocker Status',
    'Blocker Reason',
    'Recommended Action',
  ];
  const riskHRow = wsRisk.addRow(riskHeaders);
  applyHeaderStyle(riskHRow);

  const combinedRisk = Array.from(new Set([...overdueTickets, ...blockedTickets]));
  for (const t of combinedRisk) {
    const row = wsRisk.addRow([
      sanitizeExcelValue(t.key),
      sanitizeExcelValue(t.title),
      sanitizeExcelValue(t.project),
      sanitizeExcelValue(t.status),
      sanitizeExcelValue(t.dueDate || 'None'),
      t.daysOverdue > 0 ? t.daysOverdue : 0,
      sanitizeExcelValue(t.blockerClassification || (t.isBlocked ? 'Confirmed Active' : 'None')),
      sanitizeExcelValue(t.blockerReason || 'None'),
      sanitizeExcelValue(t.recommendedAction || (t.isBlocked ? 'Sync with team to unblock' : 'Prioritize resolution')),
    ]);
    applyDataRowStyle(row, { isOverdue: t.isOverdue });
  }

  wsRisk.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, combinedRisk.length + 1), column: riskHeaders.length },
  };
  autoFitColumns(wsRisk, { maxWidth: 50 });

  // -------------------------------------------------------------
  // Sheet 5: My Recent Activity
  // -------------------------------------------------------------
  const wsMyAct = workbook.addWorksheet('My Recent Activity', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  const myActHeaders = [
    'Timestamp (Recorded)',
    'Ticket ID',
    'Ticket Title',
    'Action / Field',
    'Previous Value',
    'New Value',
    'Blocker Note',
  ];
  const myActHRow = wsMyAct.addRow(myActHeaders);
  applyHeaderStyle(myActHRow);

  for (const act of recentActivity) {
    const row = wsMyAct.addRow([
      sanitizeExcelValue(act.timestamp),
      sanitizeExcelValue(act.ticketKey),
      sanitizeExcelValue(act.ticketTitle),
      sanitizeExcelValue(act.field),
      sanitizeExcelValue(act.fromValue),
      sanitizeExcelValue(act.toValue),
      sanitizeExcelValue(act.blocker || ''),
    ]);
    applyDataRowStyle(row);
  }

  wsMyAct.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, recentActivity.length + 1), column: myActHeaders.length },
  };
  autoFitColumns(wsMyAct, { maxWidth: 50 });

  // -------------------------------------------------------------
  // Sheet 6: My AI Observations
  // -------------------------------------------------------------
  const wsAiObs = workbook.addWorksheet('My AI Observations', {
    views: [{ showGridLines: true }],
  });

  const isAiAvail = Boolean(aiObservations.aiAvailable);
  const headline = aiObservations.headline || 'Weekly Personal Delivery Observations';
  const summary = aiObservations.summary || 'Weekly personal observations based on verified ticket activity.';
  const engine = aiObservations.modelName || 'Verified Metrics';

  wsAiObs.addRow([sanitizeExcelValue('PERSONAL AI OBSERVATIONS & WORKLOAD GUIDANCE')]);
  wsAiObs.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: BRAND_BLUE } };

  wsAiObs.addRow([
    sanitizeExcelValue(
      `Status: ${isAiAvail ? 'Operational' : 'Unavailable (Database Fallback Active)'} | Engine: ${engine} | Employee: ${emp.name} (${emp.title})`
    ),
  ]);
  wsAiObs.getCell('A2').font = { name: 'Calibri', size: 10, italic: true, color: { argb: isAiAvail ? 'FF00875A' : 'FFBF2600' } };

  wsAiObs.addRow([]); // Blank line 3

  wsAiObs.addRow([sanitizeExcelValue(headline)]);
  wsAiObs.getCell('A4').font = { name: 'Calibri', size: 13, bold: true, color: { argb: BRAND_DARK } };

  wsAiObs.addRow([sanitizeExcelValue(summary)]);
  wsAiObs.getCell('A5').font = { name: 'Calibri', size: 11, color: { argb: BRAND_DARK } };
  wsAiObs.getCell('A5').alignment = { wrapText: true };
  wsAiObs.getRow(5).height = 40;

  wsAiObs.addRow([]); // Blank line 6

  const renderSection = (title, items) => {
    wsAiObs.addRow([sanitizeExcelValue(title)]);
    const h = wsAiObs.lastRow;
    h.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: SUBHEADER_FONT } };
    h.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBHEADER_BG } };

    if (!items || items.length === 0) {
      wsAiObs.addRow([sanitizeExcelValue('  • None recorded for this period.')]);
      wsAiObs.lastRow.getCell(1).font = { name: 'Calibri', size: 10, italic: true };
    } else {
      for (const it of items) {
        wsAiObs.addRow([sanitizeExcelValue(`  • ${it}`)]);
        const r = wsAiObs.lastRow;
        r.getCell(1).font = { name: 'Calibri', size: 10, color: { argb: BRAND_DARK } };
        r.getCell(1).alignment = { wrapText: true };
      }
    }
    wsAiObs.addRow([]); // Blank line
  };

  renderSection('DELIVERABLES COMPLETED DURING REPORTING PERIOD', aiObservations.completedHighlights);
  renderSection('UPCOMING DEADLINES & TARGET MILESTONES', aiObservations.upcomingDeadlines);
  renderSection('ACTIVE DEPENDENCIES REQUIRING ATTENTION', aiObservations.activeBlockers);
  renderSection('PRIORITIZATION & DELIVERY SUGGESTIONS', aiObservations.prioritizationSuggestions);

  wsAiObs.getColumn(1).width = 110;

  // -------------------------------------------------------------
  // Final Buffer Conversion
  // -------------------------------------------------------------
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

