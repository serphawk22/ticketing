import { db } from './db.js';
import { collectEndOfDayData } from './endOfDayData.js';
import { generateEndOfDayAiSummaries } from './endOfDayAi.js';
import { buildEmployeeEodEmail, buildAdminEodEmail } from './endOfDayEmailTemplates.js';
import { sendReportEmail } from './mail.js';

function deliverableEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  const domain = email.split('@')[1];
  if (!domain || domain === 'example.com' || domain.endsWith('.example') || domain === 'test.com') {
    return '';
  }
  return email;
}

/**
 * Normalizes a database report record into a rich JSON response
 */
function formatReportRow(reportRow, employeeRows = [], deliveryRows = []) {
  if (!reportRow) return null;

  let metrics = {};
  let teamSummary = {};
  let projectSummaries = [];
  let managementSummary = {};
  let highPriorityTickets = [];
  let overdueTickets = [];

  try { metrics = JSON.parse(reportRow.metrics_json || '{}'); } catch {}
  try { teamSummary = JSON.parse(reportRow.team_summary_json || '{}'); } catch {}
  try { projectSummaries = JSON.parse(reportRow.project_summaries_json || '[]'); } catch {}
  try { managementSummary = JSON.parse(reportRow.management_summary_json || '{}'); } catch {}
  try { highPriorityTickets = JSON.parse(reportRow.high_priority_tickets_json || '[]'); } catch {}
  try { overdueTickets = JSON.parse(reportRow.overdue_tickets_json || '[]'); } catch {}

  const employees = (employeeRows || []).map((row) => {
    let projectsWorkedOn = [];
    let completedWork = [];
    let inProgressWork = [];
    let pendingWork = [];
    let highPriority = [];
    let overdue = [];
    let blockers = [];
    let nextSteps = [];

    try { projectsWorkedOn = JSON.parse(row.projects_json || '[]'); } catch {}
    try { completedWork = JSON.parse(row.completed_work_json || '[]'); } catch {}
    try { inProgressWork = JSON.parse(row.in_progress_work_json || '[]'); } catch {}
    try { pendingWork = JSON.parse(row.pending_work_json || '[]'); } catch {}
    try { highPriority = JSON.parse(row.high_priority_tickets_json || '[]'); } catch {}
    try { overdue = JSON.parse(row.overdue_tickets_json || '[]'); } catch {}
    try { blockers = JSON.parse(row.blockers_json || '[]'); } catch {}
    try { nextSteps = JSON.parse(row.next_steps_json || '[]'); } catch {}

    return {
      id: row.id,
      reportId: row.report_id,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      employeeEmail: row.employee_email,
      taskSheetSubmitted: Boolean(row.task_sheet_submitted),
      projectsWorkedOn,
      completedWork,
      inProgressWork,
      pendingWork,
      highPriorityTickets: highPriority,
      overdueTickets: overdue,
      blockers,
      nextSteps,
      overallProgress: row.overall_progress,
      summaryText: row.summary_text,
    };
  });

  const deliveries = (deliveryRows || []).map((d) => ({
    id: d.id,
    reportId: d.report_id,
    recipientEmail: d.recipient_email,
    recipientName: d.recipient_name,
    recipientRole: d.recipient_role,
    status: d.status,
    messageId: d.message_id,
    error: d.error,
    attempts: d.attempts,
    sentAt: d.sent_at,
    createdAt: d.created_at,
  }));

  return {
    id: reportRow.id,
    reportDate: reportRow.report_date,
    version: reportRow.version,
    status: reportRow.status,
    generatedBy: reportRow.generated_by,
    generatedByName: reportRow.generated_by_name,
    aiModel: reportRow.ai_model,
    createdAt: reportRow.created_at,
    updatedAt: reportRow.updated_at,
    metrics,
    teamSummary,
    projectSummaries,
    managementSummary,
    highPriorityTickets,
    overdueTickets,
    employees,
    deliveries,
  };
}

/**
 * Retrieves the saved End of Day Report for a given date
 * Zero AI or heavy calculations are run when a saved report exists.
 */
export async function getEndOfDayReport(reportDate) {
  const reportRow = await db
    .prepare(
      `SELECT * FROM end_of_day_reports
       WHERE report_date = ?
       ORDER BY version DESC, id DESC
       LIMIT 1`
    )
    .get(reportDate);

  if (!reportRow) return null;

  const [employeeRows, deliveryRows] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM end_of_day_employee_summaries
         WHERE report_id = ?
         ORDER BY employee_name ASC`
      )
      .all(reportRow.id),
    db
      .prepare(
        `SELECT * FROM end_of_day_email_deliveries
         WHERE report_id = ?
         ORDER BY recipient_role ASC, recipient_name ASC`
      )
      .all(reportRow.id),
  ]);

  return formatReportRow(reportRow, employeeRows, deliveryRows);
}

/**
 * Returns date-wise records of previously generated reports
 */
export async function getEndOfDayReportHistory(limit = 30) {
  const rows = await db
    .prepare(
      `SELECT id, report_date, version, status, generated_by_name, ai_model, created_at
       FROM end_of_day_reports
       ORDER BY report_date DESC, version DESC
       LIMIT ?`
    )
    .all(Number(limit) || 30);

  return rows;
}

/**
 * Enforces employee data privacy:
 * - Admin users can view the full report with all employee summaries.
 * - Non-admin users can view team-level metrics and their OWN detailed summary only.
 * - Other employees' private detailed summaries and delivery logs are excluded.
 */
export function sanitizeReportForUser(report, user) {
  if (!report) return null;
  if (!user || user.role === 'admin') return report;

  const userEmail = String(user.email || '').trim().toLowerCase();
  const userName = String(user.name || '').trim().toLowerCase();
  const userId = user.id ? Number(user.id) : null;

  const userSummaries = (report.employees || []).filter((emp) => {
    const empEmail = String(emp.employeeEmail || '').trim().toLowerCase();
    const empName = String(emp.employeeName || '').trim().toLowerCase();
    const empId = emp.employeeId ? Number(emp.employeeId) : null;
    return (
      (userEmail && empEmail === userEmail) ||
      (userName && empName === userName) ||
      (userId && empId === userId)
    );
  });

  return {
    ...report,
    employees: userSummaries,
    deliveries: [],
  };
}

/**
 * Generates and saves a complete End of Day Report
 *
 * @param {object} options
 * @param {string} options.reportDate - YYYY-MM-DD
 * @param {object} options.adminUser - The current Admin session user
 * @param {boolean} [options.forceRegenerate=false] - When true, creates a new version
 * @param {boolean} [options.sendEmails=false] - Whether to immediately dispatch role-specific emails
 */
export async function generateEndOfDayReport({
  reportDate,
  adminUser,
  forceRegenerate = false,
  sendEmails = false,
}) {
  // Check if report already exists
  const existing = await getEndOfDayReport(reportDate);
  if (existing && !forceRegenerate) {
    if (sendEmails) {
      await sendEndOfDayEmails({ reportId: existing.id, retryOnly: false });
      return await getEndOfDayReport(reportDate);
    }
    return existing;
  }

  const nextVersion = existing ? existing.version + 1 : 1;

  // 1. Collect all verified data
  const collectedData = await collectEndOfDayData(reportDate);

  // 2. Synthesize AI / factual summaries
  const aiResult = await generateEndOfDayAiSummaries(collectedData);

  const metricsJson = JSON.stringify(collectedData.metrics || {});
  const teamSummaryJson = JSON.stringify(aiResult.teamSummary || {});
  const projectSummariesJson = JSON.stringify(aiResult.projectSummaries || []);
  const managementSummaryJson = JSON.stringify(aiResult.managementSummary || {});
  const highPriorityTicketsJson = JSON.stringify(collectedData.highPriorityTickets || []);
  const overdueTicketsJson = JSON.stringify(collectedData.overdueTickets || []);

  // 3. Save report in end_of_day_reports
  const reportInsert = await db
    .prepare(
      `INSERT INTO end_of_day_reports (
         report_date, version, status, generated_by, generated_by_name,
         metrics_json, team_summary_json, project_summaries_json, management_summary_json,
         high_priority_tickets_json, overdue_tickets_json, ai_model
       ) VALUES (?, ?, 'generated', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      reportDate,
      nextVersion,
      adminUser?.id || null,
      adminUser?.name || 'Admin',
      metricsJson,
      teamSummaryJson,
      projectSummariesJson,
      managementSummaryJson,
      highPriorityTicketsJson,
      overdueTicketsJson,
      aiResult.aiModel || 'factual-fallback'
    );

  const reportId = reportInsert.lastInsertRowid;

  // 4. Save individual employee summaries in end_of_day_employee_summaries
  for (const emp of aiResult.employeeSummaries) {
    await db
      .prepare(
        `INSERT INTO end_of_day_employee_summaries (
           report_id, report_date, employee_id, employee_name, employee_email,
           task_sheet_submitted, projects_json, completed_work_json, in_progress_work_json,
           pending_work_json, high_priority_tickets_json, overdue_tickets_json,
           blockers_json, next_steps_json, overall_progress, summary_text
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        reportId,
        reportDate,
        emp.employeeId,
        emp.employeeName,
        emp.employeeEmail || '',
        emp.taskSheetSubmitted ? 1 : 0,
        JSON.stringify(emp.projectsWorkedOn || []),
        JSON.stringify(emp.completedWork || []),
        JSON.stringify(emp.inProgressWork || []),
        JSON.stringify(emp.pendingWork || []),
        JSON.stringify(emp.highPriorityTickets || []),
        JSON.stringify(emp.overdueTickets || []),
        JSON.stringify(emp.blockers || []),
        JSON.stringify(emp.nextSteps || []),
        emp.overallProgress || '',
        emp.summaryText || ''
      );
  }

  // 5. Send role-specific emails if requested
  if (sendEmails) {
    await sendEndOfDayEmails({ reportId, retryOnly: false });
  }

  return await getEndOfDayReport(reportDate);
}

/**
 * Dispatches role-specific End of Day emails
 * - Active Admins receive the Consolidated Report.
 * - Active Developers/Employees receive ONLY their own individual summary + team overview.
 * - If a user has both roles, sends ONLY the Admin consolidated email.
 * - Tracks delivery per recipient in end_of_day_email_deliveries.
 * - Allows retrying only failed deliveries.
 */
export async function sendEndOfDayEmails({ reportId, retryOnly = false }) {
  const reportRow = await db
    .prepare('SELECT * FROM end_of_day_reports WHERE id = ?')
    .get(reportId);

  if (!reportRow) throw new Error('Report not found.');

  const [employeeRows, existingDeliveries, adminUsers, developerUsers] = await Promise.all([
    db
      .prepare('SELECT * FROM end_of_day_employee_summaries WHERE report_id = ?')
      .all(reportId),
    db
      .prepare('SELECT * FROM end_of_day_email_deliveries WHERE report_id = ?')
      .all(reportId),
    db
      .prepare("SELECT id, name, email, role FROM users WHERE role = 'admin' AND email IS NOT NULL AND TRIM(email) != ''")
      .all(),
    db
      .prepare("SELECT id, name, email, role FROM users WHERE role = 'developer' AND email IS NOT NULL AND TRIM(email) != ''")
      .all(),
  ]);

  const report = formatReportRow(reportRow, employeeRows, existingDeliveries);

  // Delivery status lookup map: email -> existing delivery
  const deliveryMap = new Map(existingDeliveries.map((d) => [d.recipient_email.toLowerCase(), d]));

  // Build unique recipient lists
  // Admins get consolidated email
  const adminRecipients = new Map();
  for (const u of adminUsers) {
    const email = deliverableEmail(u.email);
    if (email && !adminRecipients.has(email)) {
      adminRecipients.set(email, { name: u.name, email, role: 'admin' });
    }
  }

  // Developers/Employees get individual email (EXCLUDING anyone who is already receiving an Admin email)
  const employeeRecipients = new Map();
  for (const u of developerUsers) {
    const email = deliverableEmail(u.email);
    if (email && !adminRecipients.has(email) && !employeeRecipients.has(email)) {
      employeeRecipients.set(email, { name: u.name, email, role: 'employee' });
    }
  }

  // Also include any active employee whose email is valid and not already in admin list
  for (const emp of report.employees) {
    const email = deliverableEmail(emp.employeeEmail);
    if (email && !adminRecipients.has(email) && !employeeRecipients.has(email)) {
      employeeRecipients.set(email, { name: emp.employeeName, email, role: 'employee' });
    }
  }

  const allRecipients = [
    ...Array.from(adminRecipients.values()),
    ...Array.from(employeeRecipients.values()),
  ];

  let totalSent = 0;
  let totalFailed = 0;

  for (const recipient of allRecipients) {
    const existing = deliveryMap.get(recipient.email);

    // If retryOnly is true, skip recipients that were already sent successfully
    if (retryOnly && existing?.status === 'sent') {
      continue;
    }

    // Ensure delivery row exists in pending state
    await db
      .prepare(
        `INSERT INTO end_of_day_email_deliveries (
           report_id, report_date, recipient_email, recipient_name, recipient_role, status, attempts
         ) VALUES (?, ?, ?, ?, ?, 'pending', 0)
         ON CONFLICT (report_id, recipient_email) DO NOTHING`
      )
      .run(reportId, report.reportDate, recipient.email, recipient.name, recipient.role);

    // Build the role-appropriate email
    let emailPayload = null;
    if (recipient.role === 'admin') {
      emailPayload = buildAdminEodEmail({
        reportDate: report.reportDate,
        adminName: recipient.name,
        metrics: report.metrics,
        teamSummary: report.teamSummary,
        managementSummary: report.managementSummary,
        projectSummaries: report.projectSummaries,
        employeeSummaries: report.employees,
        highPriorityTickets: report.highPriorityTickets,
        overdueTickets: report.overdueTickets,
      });
    } else {
      // Find employee's individual summary
      const empSummary = report.employees.find(
        (e) =>
          deliverableEmail(e.employeeEmail) === recipient.email ||
          e.employeeName.toLowerCase() === recipient.name.toLowerCase()
      ) || {
        taskSheetSubmitted: false,
        hoursWorked: 0,
        projectsWorkedOn: ['Not reported'],
        completedWork: ['None reported'],
        inProgressWork: ['None reported'],
        pendingWork: ['None reported'],
        blockers: ['No blockers reported'],
        nextSteps: ['Proceed with board priorities'],
        overallProgress: 'Routine work progression.',
      };

      emailPayload = buildEmployeeEodEmail({
        reportDate: report.reportDate,
        employeeName: recipient.name,
        employeeSummary: empSummary,
        teamSummary: report.teamSummary,
      });
    }

    // Send via SMTP
    try {
      const result = await sendReportEmail({
        to: recipient.email,
        toName: recipient.name,
        subject: emailPayload.subject,
        text: emailPayload.text,
        html: emailPayload.html,
        trigger: 'end_of_day_report',
      });

      if (result?.status === 'sent') {
        totalSent += 1;
        await db
          .prepare(
            `UPDATE end_of_day_email_deliveries
             SET status = 'sent', message_id = ?, error = NULL, attempts = attempts + 1, sent_at = CURRENT_TIMESTAMP
             WHERE report_id = ? AND recipient_email = ?`
          )
          .run(result.messageId || null, reportId, recipient.email);
      } else {
        totalFailed += 1;
        const errMsg = result?.error || 'Mail server did not accept message';
        await db
          .prepare(
            `UPDATE end_of_day_email_deliveries
             SET status = 'failed', error = ?, attempts = attempts + 1
             WHERE report_id = ? AND recipient_email = ?`
          )
          .run(errMsg, reportId, recipient.email);
      }
    } catch (err) {
      totalFailed += 1;
      const errMsg = err?.message || String(err);
      console.error(`[end-of-day:email] Delivery to ${recipient.email} failed:`, errMsg);
      await db
        .prepare(
          `UPDATE end_of_day_email_deliveries
           SET status = 'failed', error = ?, attempts = attempts + 1
           WHERE report_id = ? AND recipient_email = ?`
        )
        .run(errMsg, reportId, recipient.email);
    }

    // 300ms pause between sequential SMTP deliveries to prevent rate-limit / burst heuristics
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // Update overall report status
  const finalStatus = totalFailed === 0 ? 'sent' : totalSent > 0 ? 'partial_delivery' : 'failed';
  await db
    .prepare('UPDATE end_of_day_reports SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(finalStatus, reportId);

  return {
    status: finalStatus,
    totalSent,
    totalFailed,
  };
}

