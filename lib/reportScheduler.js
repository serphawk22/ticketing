import { db } from './db.js';
import { sendReportEmail } from './mail.js';
import { getReportExecutionData } from './analytics.js';
import { getReportBySlug } from './reportMasterCatalog.js';
import { logAuditEvent } from './audit.js';

/**
 * Get all active or configured report schedules
 */
export async function getReportSchedules() {
  return db
    .prepare('SELECT * FROM report_schedules ORDER BY id DESC')
    .all();
}

/**
 * Create a new scheduled email report
 */
export async function createReportSchedule({
  name,
  reportSlug,
  sectionSlug,
  frequency = 'weekly',
  recipients,
  filterConfig = {},
  format = 'summary',
  userId,
}) {
  const nextRun = computeNextRun(frequency);

  const res = await db
    .prepare(
      `INSERT INTO report_schedules
        (name, report_slug, section_slug, frequency, recipients, filter_config, format, next_run_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      reportSlug,
      sectionSlug,
      frequency,
      recipients,
      JSON.stringify(filterConfig || {}),
      format,
      nextRun.toISOString(),
      userId || null
    );

  await logAuditEvent({
    actorId: userId,
    actorName: 'User',
    action: 'create_report_schedule',
    entityType: 'report_schedule',
    entityId: res.lastInsertRowid,
    details: { name, reportSlug, frequency, recipients },
  });

  return db.prepare('SELECT * FROM report_schedules WHERE id = ?').get(res.lastInsertRowid);
}

/**
 * Delete a schedule
 */
export async function deleteReportSchedule(id, userId) {
  const schedule = await db.prepare('SELECT * FROM report_schedules WHERE id = ?').get(id);
  if (!schedule) return false;

  await db.prepare('DELETE FROM report_schedules WHERE id = ?').run(id);

  await logAuditEvent({
    actorId: userId,
    actorName: 'User',
    action: 'delete_report_schedule',
    entityType: 'report_schedule',
    entityId: id,
    details: { name: schedule.name, reportSlug: schedule.report_slug },
  });

  return true;
}

/**
 * Toggle active state of a schedule
 */
export async function toggleReportSchedule(id, isActive, userId) {
  await db
    .prepare("UPDATE report_schedules SET is_active = ?, updated_at = datetime('now') WHERE id = ?")
    .run(isActive ? 1 : 0, id);

  await logAuditEvent({
    actorId: userId,
    actorName: 'User',
    action: 'toggle_report_schedule',
    entityType: 'report_schedule',
    entityId: id,
    details: { isActive },
  });
}

function computeNextRun(frequency, fromDate = new Date()) {
  const d = new Date(fromDate.getTime());
  if (frequency === 'daily') {
    d.setUTCDate(d.getUTCDate() + 1);
  } else if (frequency === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7);
  } else if (frequency === 'monthly') {
    d.setUTCMonth(d.getUTCMonth() + 1);
  } else {
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return d;
}

/**
 * Execute all due report schedules
 */
export async function runDueReportSchedules({ forceRunId = null } = {}) {
  let query = 'SELECT * FROM report_schedules WHERE is_active = 1';
  const params = [];

  if (forceRunId) {
    query = 'SELECT * FROM report_schedules WHERE id = ?';
    params.push(Number(forceRunId));
  } else {
    query += " AND (next_run_at IS NULL OR next_run_at <= datetime('now'))";
  }

  const schedules = await db.prepare(query).all(...params);
  const results = [];

  for (const schedule of schedules) {
    try {
      const reportDef = getReportBySlug(schedule.report_slug);
      let filters = {};
      try {
        filters = JSON.parse(schedule.filter_config || '{}');
      } catch {}

      // Generate report data as admin system runner
      const reportData = await getReportExecutionData({
        reportSlug: schedule.report_slug,
        filters,
        currentUser: { role: 'admin', id: 1, name: 'System Scheduler' },
      });

      // Prepare email content
      const recipientList = schedule.recipients
        .split(/[,;\s]+/)
        .map((e) => e.trim())
        .filter(Boolean);

      const subject = `[Report Schedule] ${schedule.name}: ${reportDef?.title || schedule.report_slug}`;
      const kpisSummary = (reportData.kpis || [])
        .map((k) => `• ${k.label}: ${k.value}`)
        .join('\n');

      const text = [
        `Scheduled Report: ${schedule.name}`,
        `Report: ${reportDef?.title || schedule.report_slug}`,
        `Frequency: ${schedule.frequency}`,
        `Period: ${reportData.dateRange?.label || 'All'}`,
        '',
        'Key Performance Indicators:',
        kpisSummary,
        '',
        `Total Records: ${reportData.totalCount || 0}`,
        '',
        'This is an automated report email from Serp Hawk Ticketing System.',
      ].join('\n');

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#172b4d;">
          <h2 style="color:#0c66e4;margin-bottom:4px;">${escapeHtml(schedule.name)}</h2>
          <p style="color:#626f86;margin-top:0;">${escapeHtml(reportDef?.title || '')} (${schedule.frequency})</p>
          <div style="background:#f4f5f7;padding:16px;border-radius:8px;margin:20px 0;">
            <h4 style="margin:0 0 12px;color:#172b4d;">Summary KPIs</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              ${(reportData.kpis || [])
                .map(
                  (k) => `
                <div style="background:#fff;padding:10px;border-radius:6px;border:1px solid #dfe1e6;">
                  <div style="font-size:12px;color:#626f86;">${escapeHtml(k.label)}</div>
                  <div style="font-size:18px;font-weight:700;color:#172b4d;">${escapeHtml(k.value)}</div>
                </div>`
                )
                .join('')}
            </div>
          </div>
          <p style="font-size:13px;color:#626f86;">Total Records: <strong>${reportData.totalCount || 0}</strong></p>
          <hr style="border:none;border-top:1px solid #dfe1e6;margin:24px 0;" />
          <p style="font-size:11px;color:#8993a4;">Automated notification generated by Serp Hawk Ticketing Management System.</p>
        </div>
      `;

      // Send to all recipients
      for (const email of recipientList) {
        await sendReportEmail({
          to: email,
          toName: '',
          subject,
          text,
          html,
          trigger: 'scheduled_report',
        });
      }

      // Update schedule status
      const nextRun = computeNextRun(schedule.frequency);
      await db
        .prepare(
          `UPDATE report_schedules
           SET last_sent_at = datetime('now'),
               next_run_at = ?,
               updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(nextRun.toISOString(), schedule.id);

      results.push({ scheduleId: schedule.id, status: 'success', recipients: recipientList.length });
    } catch (err) {
      console.error(`Error running schedule ${schedule.id}:`, err);
      results.push({ scheduleId: schedule.id, status: 'error', error: err.message });
    }
  }

  return results;
}

/**
 * Scan for overdue tasks, missed deadlines, and pending approvals, and send an exception alert
 */
export async function checkAndSendExceptionAlerts() {
  const todayStr = new Date().toISOString().slice(0, 10);

  // Overdue tickets
  const overdueTickets = await db
    .prepare(
      `SELECT t.id, t.title, t.priority, t.due_date, p.key AS project_key, e.name AS employee_name
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN employees e ON e.id = t.employee_id
       WHERE t.archived = 0 AND t.status NOT IN ('resolved', 'closed')
         AND t.due_date IS NOT NULL AND t.due_date < ?
       ORDER BY t.priority = 'urgent' DESC, t.due_date ASC
       LIMIT 20`
    )
    .all(todayStr);

  // Pending product reviews
  const pendingApprovals = await db
    .prepare(
      `SELECT t.id, t.title, p.key AS project_key, t.created_at
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.archived = 0 AND t.product_inclusion_status = 'pending_review'
       ORDER BY t.id ASC
       LIMIT 10`
    )
    .all();

  // If no exceptions, return early
  if (overdueTickets.length === 0 && pendingApprovals.length === 0) {
    return { alertSent: false, reason: 'No pending exceptions found' };
  }

  // Find admin emails
  const admins = await db.prepare("SELECT email, name FROM users WHERE role = 'admin' AND email IS NOT NULL").all();
  if (admins.length === 0) return { alertSent: false, reason: 'No admin emails found' };

  const urgentCount = overdueTickets.filter((t) => t.priority === 'urgent' || t.priority === 'high').length;
  const subject = `[Exception Alert] ${overdueTickets.length} Overdue Tasks, ${pendingApprovals.length} Pending Approvals`;

  const text = [
    'DAILY EXCEPTION ALERT - SERP HAWK TICKETING',
    '============================================',
    '',
    `Overdue Tasks: ${overdueTickets.length} (${urgentCount} High/Urgent)`,
    `Pending Product Inclusion Approvals: ${pendingApprovals.length}`,
    '',
    'Top Overdue Work Items:',
    ...overdueTickets.map(
      (t) => `• [${t.project_key || 'TM'}-${t.id}] ${t.title} (Due: ${t.due_date}, Assignee: ${t.employee_name || 'Unassigned'})`
    ),
    '',
    pendingApprovals.length > 0 ? 'Pending Approvals:' : '',
    ...pendingApprovals.map((t) => `• [${t.project_key || 'TM'}-${t.id}] ${t.title}`),
    '',
    'Please review these exceptions on the Admin Dashboard.',
  ].join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#172b4d;">
      <div style="background:#de350b;color:#fff;padding:12px 16px;border-radius:6px;margin-bottom:16px;">
        <h3 style="margin:0;">🚨 Daily Reporting & Exception Alert</h3>
      </div>
      <p>The following work items require management attention:</p>
      <div style="background:#fff0b3;padding:12px;border-radius:6px;border-left:4px solid #ffab00;margin-bottom:16px;">
        <strong>${overdueTickets.length} Overdue Tasks</strong> (${urgentCount} High / Urgent Priority)
      </div>
      <ul style="padding-left:20px;line-height:1.6;">
        ${overdueTickets
          .slice(0, 10)
          .map(
            (t) => `
          <li>
            <strong>[${t.project_key || 'TM'}-${t.id}]</strong> ${escapeHtml(t.title)}<br/>
            <span style="font-size:12px;color:#626f86;">Due: ${t.due_date} | Assignee: ${escapeHtml(t.employee_name || 'Unassigned')} | Priority: ${t.priority}</span>
          </li>`
          )
          .join('')}
      </ul>
      ${
        pendingApprovals.length > 0
          ? `
        <div style="background:#e9f2ff;padding:12px;border-radius:6px;border-left:4px solid #0c66e4;margin:20px 0 10px;">
          <strong>${pendingApprovals.length} Pending Product Approvals</strong>
        </div>
        <ul style="padding-left:20px;line-height:1.6;">
          ${pendingApprovals
            .map(
              (t) => `
            <li>
              <strong>[${t.project_key || 'TM'}-${t.id}]</strong> ${escapeHtml(t.title)}
            </li>`
            )
            .join('')}
        </ul>`
          : ''
      }
      <hr style="border:none;border-top:1px solid #dfe1e6;margin:24px 0;" />
      <p style="font-size:11px;color:#8993a4;">Automated exception monitoring by Serp Hawk Ticketing System.</p>
    </div>
  `;

  for (const admin of admins) {
    await sendReportEmail({
      to: admin.email,
      toName: admin.name,
      subject,
      text,
      html,
      trigger: 'exception_alert',
    });
  }

  return { alertSent: true, overdueCount: overdueTickets.length, approvalsCount: pendingApprovals.length };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
