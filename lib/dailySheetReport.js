import crypto from 'node:crypto';
import { db } from './db.js';
import { buildDailySheetReportImages } from './dailySheetReportImages.js';
import { listHappySubmissions } from './happySheet.js';
import { sendReportEmail } from './mail.js';
import { listSubmissions, submissionProjects } from './taskSheet.js';

const IST_TIME_ZONE = 'Asia/Kolkata';
const DELIVERY_STALE_MS = 15 * 60 * 1000;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function reportDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function istDayBounds(reportDate) {
  const start = new Date(`${reportDate}T00:00:00+05:30`);
  return {
    after: start.toISOString(),
    before: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function utcDateBefore(reportDate) {
  const date = new Date(`${reportDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function timestamp(value) {
  if (value instanceof Date) return value.getTime();
  const text = String(value || '');
  return new Date(!text.includes('T') && text.includes(' ') ? `${text.replace(' ', 'T')}Z` : text).getTime();
}

function reportDateLabel(reportDate) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${reportDate}T12:00:00+05:30`));
}

function reportDateSubjectLabel(reportDate) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${reportDate}T12:00:00+05:30`));
}

function submittedAt(value) {
  if (value instanceof Date) {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: IST_TIME_ZONE,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(value);
  }
  const text = String(value || '');
  const iso = !text.includes('T') && text.includes(' ') ? `${text.replace(' ', 'T')}Z` : text;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseTickets(row) {
  if (!row.tickets_detail) return [];
  try {
    const tickets = typeof row.tickets_detail === 'string'
      ? JSON.parse(row.tickets_detail)
      : row.tickets_detail;
    return Array.isArray(tickets) ? tickets : [];
  } catch {
    return [];
  }
}

function hoursLabel(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return '';
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

function ticketCompleted(ticket) {
  const status = compactText(ticket?.workState || ticket?.taskStatus).toLowerCase();
  if (!status) return null;
  if (
    status === 'not_completed' ||
    status.includes('not complete') ||
    status.includes('in progress') ||
    status.includes('pending') ||
    status.includes('blocked')
  ) {
    return false;
  }
  return (
    status === 'completed' ||
    status === 'done' ||
    status === 'closed' ||
    status.includes('complete') ||
    status.includes('resolved')
  );
}

function taskEntries(rows) {
  return rows
    .map((row) => {
      const tickets = parseTickets(row).map((ticket) => {
        const key = compactText(ticket.key || ticket.id);
        const title = compactText(ticket.title);
        const label =
          key && title && !title.toLowerCase().startsWith(key.toLowerCase())
            ? `${key}: ${title}`
            : title || key || 'Work item';
        const completed = ticketCompleted(ticket);
        return {
          title: label,
          description: compactText(ticket.description),
          status: (completed == null ? row.task_state === 'completed' : completed)
            ? 'Completed'
            : 'Not completed',
          blocker: compactText(ticket.blocker),
        };
      });

      return {
        name: compactText(row.name) || 'Unnamed employee',
        submitted: submittedAt(row.created_at),
        projects: submissionProjects(row).join(', ') || compactText(row.project) || 'Not specified',
        hours: hoursLabel(row.hours_worked) || 'Not specified',
        taskTitle: compactText(row.task_title) || 'Not specified',
        taskDescription: compactText(row.task_description),
        status: row.task_state === 'completed' ? 'Completed' : 'Not completed',
        blocker: compactText(row.blocker),
        learning: compactText(row.learning_project),
        other: compactText(row.other_activities),
        linkedTicket:
          !tickets.length && row.linked_ticket_id
            ? `${(row.linked_key || 'TM').toUpperCase()}-${row.linked_ticket_id}`
            : '',
        tickets,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function happyEntries(rows) {
  return rows
    .map((row) => ({
      name: compactText(row.name) || 'Unnamed employee',
      submitted: submittedAt(row.created_at),
      answers: [
        ['What made your day happy', row.happy_one],
        ['Did you make anybody else happy', row.happy_others],
        ['Goals and self-satisfaction', row.happy_goals],
        ['Dreams', row.happy_dreams],
        ['Self-study or personal project', row.happy_self_study],
      ].map(([label, value]) => [label, compactText(value) || 'Not provided']),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function responseLine(entries) {
  const count = `${entries.length} response${entries.length === 1 ? '' : 's'}`;
  const names = [...new Set(entries.map((entry) => entry.name).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  if (!names.length) return `${count}.`;
  if (names.length === 1) return `${count} from ${names[0]}.`;
  return `${count} from ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`;
}

function taskEntryLines(entry) {
  const lines = [`${entry.name} - submitted ${entry.submitted}`];
  lines.push(`  Project: ${entry.projects}`);
  lines.push(`  Hours worked: ${entry.hours}`);
  const taskSummary = entry.taskTitle + (entry.taskDescription && entry.taskDescription !== entry.taskTitle ? ` - ${entry.taskDescription}` : '');
  lines.push(`  Work summary: ${taskSummary}`);
  lines.push(`  Completion status: ${entry.status}`);
  lines.push(`  Blockers: ${entry.blocker ? `Yes - ${entry.blocker}` : 'No'}`);
  if (entry.learning) lines.push(`  Learning / other project: ${entry.learning}`);
  if (entry.other) lines.push(`  Other activities: ${entry.other}`);
  if (entry.tickets.length) {
    for (const ticket of entry.tickets) {
      lines.push(`  Work item: ${ticket.title} (${ticket.status})`);
      if (ticket.description && ticket.description.toLowerCase() !== ticket.title.toLowerCase()) {
        lines.push(`    Description: ${ticket.description}`);
      }
      if (ticket.blocker) lines.push(`    Work item blocker: ${ticket.blocker}`);
    }
  } else if (entry.linkedTicket) {
    lines.push(`  Linked ticket: ${entry.linkedTicket}`);
  }
  return lines;
}

function happyEntryLines(entry) {
  const lines = [`${entry.name} - submitted ${entry.submitted}`];
  for (const [label, value] of entry.answers) lines.push(`  ${label}: ${value}`);
  return lines;
}

function htmlField(label, value) {
  return `<p style="margin:4px 0;font-size:14px;line-height:1.6;color:#1f2937"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

function taskEntryHtml(entry) {
  const parts = [
    '<div style="margin:12px 0 0;padding:12px 14px;border:1px solid #e5e7eb;border-radius:6px;background:#ffffff">',
    `<div style="font-size:15px;font-weight:700;color:#111827">${escapeHtml(entry.name)}</div>`,
    `<div style="margin-top:2px;font-size:12px;color:#6b7280">Submitted ${escapeHtml(entry.submitted)}</div>`,
    htmlField('Project', entry.projects),
    htmlField('Hours worked', entry.hours),
    htmlField('Work summary', entry.taskTitle + (entry.taskDescription && entry.taskDescription !== entry.taskTitle ? ` — ${entry.taskDescription}` : '')),
    htmlField('Completion status', entry.status),
    htmlField('Blockers', entry.blocker ? `Yes — ${entry.blocker}` : 'No'),
  ];
  if (entry.learning) parts.push(htmlField('Learning / other project', entry.learning));
  if (entry.other) parts.push(htmlField('Other activities', entry.other));
  if (entry.tickets.length) {
    parts.push('<div style="margin-top:8px;font-size:14px;font-weight:700;color:#111827">Work items</div>');
    for (const ticket of entry.tickets) {
      parts.push(
        `<p style="margin:4px 0;font-size:14px;line-height:1.6;color:#1f2937"><strong>Work item:</strong> ${escapeHtml(ticket.title)} (${escapeHtml(ticket.status)})</p>`
      );
      if (ticket.description && ticket.description.toLowerCase() !== ticket.title.toLowerCase()) {
        parts.push(htmlField('Description', ticket.description));
      }
      if (ticket.blocker) parts.push(htmlField('Work item blocker', ticket.blocker));
    }
  } else if (entry.linkedTicket) {
    parts.push(htmlField('Linked ticket', entry.linkedTicket));
  }
  parts.push('</div>');
  return parts.join('');
}

function happyEntryHtml(entry) {
  const parts = [
    '<div style="margin:12px 0 0;padding:12px 14px;border:1px solid #e5e7eb;border-radius:6px;background:#ffffff">',
    `<div style="font-size:15px;font-weight:700;color:#111827">${escapeHtml(entry.name)}</div>`,
    `<div style="margin-top:2px;font-size:12px;color:#6b7280">Submitted ${escapeHtml(entry.submitted)}</div>`,
  ];
  for (const [label, value] of entry.answers) parts.push(htmlField(label, value));
  parts.push('</div>');
  return parts.join('');
}

export function buildDailySheetEmail({
  reportDate,
  taskSubmissions = [],
  happySubmissions = [],
} = {}) {
  const dateLabel = reportDateLabel(reportDate);
  const subject = `Daily Task Sheet & Happy Sheet Summary - ${reportDateSubjectLabel(reportDate)}`;
  const tasks = taskEntries(taskSubmissions);
  const happy = happyEntries(happySubmissions);
  const taskIntro = tasks.length
    ? responseLine(tasks)
    : 'No Task Sheet responses were submitted for this reporting date.';
  const happyIntro = happy.length
    ? responseLine(happy)
    : 'No Happy Sheet responses were submitted for this reporting date.';
  const completedCount = tasks.filter((entry) => entry.status === 'Completed').length;
  const taskStats = tasks.length
    ? `Completed: ${completedCount} | Not completed: ${tasks.length - completedCount}`
    : '';

  const textLines = [
    'Hello Team,',
    '',
    `Please find below the daily Task Sheet and Happy Sheet summary for ${dateLabel}.`,
    'PNG snapshots of both sheets are attached.',
    '',
    'TASK SHEET SUMMARY',
    taskIntro,
  ];
  if (taskStats) textLines.push(taskStats);
  if (tasks.length) {
    for (const entry of tasks) textLines.push('', ...taskEntryLines(entry));
  }
  textLines.push('', 'HAPPY SHEET SUMMARY', happyIntro);
  if (happy.length) {
    for (const entry of happy) textLines.push('', ...happyEntryLines(entry));
  }
  textLines.push('', 'Regards,', 'Serphawk Ticket Manager');

  const taskHtml = tasks.map(taskEntryHtml).join('');
  const happyHtml = happy.map(happyEntryHtml).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f6f8fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px">
    <h1 style="margin:0;font-size:22px;line-height:1.3;color:#111827">Daily Task Sheet &amp; Happy Sheet Summary</h1>
    <p style="margin:6px 0 0;font-size:14px;line-height:1.6;color:#6b7280">${escapeHtml(dateLabel)}</p>
    <p style="margin:20px 0 0;font-size:15px;line-height:1.6;color:#1f2937">Hello Team,</p>
    <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#1f2937">Please find below the daily Task Sheet and Happy Sheet summary for <strong>${escapeHtml(dateLabel)}</strong>.</p>
    <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#1f2937">PNG snapshots of both sheets are attached.</p>
    <h2 style="margin:24px 0 0;font-size:18px;line-height:1.3;color:#111827">Task Sheet Summary</h2>
    <p style="margin:6px 0 0;font-size:14px;line-height:1.6;color:#374151">${escapeHtml(taskIntro)}</p>
    ${taskStats ? `<p style="margin:4px 0 0;font-size:14px;line-height:1.6;color:#374151">${escapeHtml(taskStats)}</p>` : ''}
    ${taskHtml}
    <h2 style="margin:24px 0 0;font-size:18px;line-height:1.3;color:#111827">Happy Sheet Summary</h2>
    <p style="margin:6px 0 0;font-size:14px;line-height:1.6;color:#374151">${escapeHtml(happyIntro)}</p>
    ${happyHtml}
    <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#1f2937">Regards,<br>Serphawk Ticket Manager</p>
  </div>
</body>
</html>`;

  const imageSections = [
    {
      title: 'Task Sheet Responses',
      entries: tasks.map((entry) => ({
        name: entry.name,
        submitted: entry.submitted,
        fields: [
          ['Project', entry.projects],
          ['Hours worked', entry.hours],
          ['Work summary', entry.taskTitle + (entry.taskDescription && entry.taskDescription !== entry.taskTitle ? ` — ${entry.taskDescription}` : '')],
          ['Completion status', entry.status],
          ['Blockers', entry.blocker ? `Yes — ${entry.blocker}` : 'No'],
          ...(entry.learning ? [['Learning / other project', entry.learning]] : []),
          ...(entry.other ? [['Other activities', entry.other]] : []),
          ...entry.tickets.map((ticket) => [
            'Work item',
            `${ticket.title} (${ticket.status})${ticket.blocker ? ` — Blocker: ${ticket.blocker}` : ''}`,
          ]),
          ...(!entry.tickets.length && entry.linkedTicket
            ? [['Linked ticket', entry.linkedTicket]]
            : []),
        ].map(([label, value]) => ({ label, value })),
      })),
    },
    {
      title: 'Happy Sheet Responses',
      entries: happy.map((entry) => ({
        name: entry.name,
        submitted: entry.submitted,
        fields: entry.answers.map(([label, value]) => ({ label, value })),
      })),
    },
  ];
  return { subject, text: textLines.join('\n'), html, dateLabel, imageSections };
}

export async function getDailySheetResponses(reportDate = reportDateParts()) {
  const { after, before } = istDayBounds(reportDate);
  const [taskRows, happyRows] = await Promise.all([
    listSubmissions({ from: utcDateBefore(reportDate), to: reportDate, limit: 2000 }),
    listHappySubmissions({ from: utcDateBefore(reportDate), to: reportDate, limit: 2000 }),
  ]);
  const start = new Date(after).getTime();
  const end = new Date(before).getTime();
  const withinReportDay = (row) => {
    const createdAt = timestamp(row.created_at);
    return Number.isFinite(createdAt) && createdAt >= start && createdAt < end;
  };
  return {
    reportDate,
    taskSubmissions: taskRows.filter(withinReportDay),
    happySubmissions: happyRows.filter(withinReportDay),
  };
}

function deliveryIsStale(delivery) {
  const createdAt = timestamp(delivery?.created_at);
  return Number.isFinite(createdAt) && Date.now() - createdAt > DELIVERY_STALE_MS;
}

function deliverableEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  const domain = email.split('@')[1];
  if (!domain || domain === 'example.com' || domain.endsWith('.example') || domain === 'test.com') {
    return '';
  }
  return email;
}

async function markReportDelivery(reportDate, runToken, status) {
  await db
    .prepare(
      `UPDATE daily_sheet_report_deliveries
       SET status = ?, completed_at = CURRENT_TIMESTAMP
       WHERE report_date = ? AND run_token = ?`
    )
    .run(status, reportDate, runToken);
}

async function markRecipientDelivery(reportDate, recipientEmail, runToken, status, error = null) {
  await db
    .prepare(
      `UPDATE daily_sheet_report_recipient_deliveries
       SET status = ?, error = ?, completed_at = CURRENT_TIMESTAMP
       WHERE report_date = ? AND recipient_email = ? AND run_token = ?`
    )
    .run(status, error ? String(error).slice(0, 1000) : null, reportDate, recipientEmail, runToken);
}

async function claimReportDelivery(reportDate, runToken, force = false) {
  if (force) {
    await db
      .prepare(
        `INSERT INTO daily_sheet_report_deliveries (report_date, run_token, status)
         VALUES (?, ?, 'running')
         ON CONFLICT (report_date) DO UPDATE
         SET run_token = excluded.run_token, status = 'running', completed_at = NULL, created_at = CURRENT_TIMESTAMP`
      )
      .run(reportDate, runToken);
    return true;
  }
  await db
    .prepare(
      `INSERT INTO daily_sheet_report_deliveries (report_date, run_token, status)
       VALUES (?, ?, 'running')
       ON CONFLICT (report_date) DO NOTHING`
    )
    .run(reportDate, runToken);
  let delivery = await db
    .prepare('SELECT * FROM daily_sheet_report_deliveries WHERE report_date = ?')
    .get(reportDate);
  if (delivery?.run_token === runToken) return true;
  if (!delivery || delivery.status === 'sent') return false;
  if (delivery.status === 'running' && !deliveryIsStale(delivery)) return false;

  await db
    .prepare(
      `UPDATE daily_sheet_report_deliveries
       SET run_token = ?, status = 'running', completed_at = NULL, created_at = CURRENT_TIMESTAMP
       WHERE report_date = ?`
    )
    .run(runToken, reportDate);
  delivery = await db
    .prepare('SELECT * FROM daily_sheet_report_deliveries WHERE report_date = ?')
    .get(reportDate);
  return delivery?.run_token === runToken;
}

async function claimRecipientDelivery(reportDate, admin, runToken, force = false) {
  const recipientEmail = String(admin.email || '').trim().toLowerCase();
  if (force) {
    await db
      .prepare(
        `INSERT INTO daily_sheet_report_recipient_deliveries
         (report_date, recipient_email, recipient_name, run_token, status)
         VALUES (?, ?, ?, ?, 'running')
         ON CONFLICT (report_date, recipient_email) DO UPDATE
         SET recipient_name = excluded.recipient_name, run_token = excluded.run_token,
             status = 'running', error = NULL, completed_at = NULL, created_at = CURRENT_TIMESTAMP`
      )
      .run(reportDate, recipientEmail, admin.name || '', runToken);
    return true;
  }
  await db
    .prepare(
      `INSERT INTO daily_sheet_report_recipient_deliveries
       (report_date, recipient_email, recipient_name, run_token, status)
       VALUES (?, ?, ?, ?, 'running')
       ON CONFLICT (report_date, recipient_email) DO NOTHING`
    )
    .run(reportDate, recipientEmail, admin.name || '', runToken);
  let delivery = await db
    .prepare(
      `SELECT * FROM daily_sheet_report_recipient_deliveries
       WHERE report_date = ? AND recipient_email = ?`
    )
    .get(reportDate, recipientEmail);
  if (delivery?.run_token === runToken) return true;
  if (!delivery || delivery.status === 'sent') return false;
  if (delivery.status === 'running' && !deliveryIsStale(delivery)) return false;

  await db
    .prepare(
      `UPDATE daily_sheet_report_recipient_deliveries
       SET recipient_name = ?, run_token = ?, status = 'running', error = NULL,
           completed_at = NULL, created_at = CURRENT_TIMESTAMP
       WHERE report_date = ? AND recipient_email = ?`
    )
    .run(admin.name || '', runToken, reportDate, recipientEmail);
  delivery = await db
    .prepare(
      `SELECT * FROM daily_sheet_report_recipient_deliveries
       WHERE report_date = ? AND recipient_email = ?`
    )
    .get(reportDate, recipientEmail);
  return delivery?.run_token === runToken;
}

export async function sendDailySheetReport({ reportDate = reportDateParts(), force = false } = {}) {
  const runToken = crypto.randomUUID();
  if (!(await claimReportDelivery(reportDate, runToken, force))) {
    return { status: 'already_processed', reportDate };
  }

  try {
    const [responses, recipientRows] = await Promise.all([
      getDailySheetResponses(reportDate),
      db
        .prepare(
          `SELECT name, email, role
           FROM users
           WHERE (role = 'admin' OR LOWER(name) LIKE '%bhavana%' OR LOWER(email) LIKE '%bhavana%')
             AND email IS NOT NULL AND TRIM(email) != ''`
        )
        .all(),
    ]);

    const seen = new Set();
    const admins = [];
    for (const row of recipientRows) {
      const email = deliverableEmail(row.email);
      if (!email || seen.has(email)) continue;
      seen.add(email);
      admins.push({ name: compactText(row.name), email });
    }

    const taskCount = responses.taskSubmissions.length;
    const happyCount = responses.happySubmissions.length;
    if (!taskCount && !happyCount) {
      await markReportDelivery(reportDate, runToken, 'no_responses');
      return { status: 'no_responses', reportDate, taskCount, happyCount, recipientCount: 0 };
    }
    if (!admins.length) {
      await markReportDelivery(reportDate, runToken, 'no_admins');
      return { status: 'no_admins', reportDate, taskCount, happyCount, recipientCount: 0 };
    }

    const email = buildDailySheetEmail({ reportDate, ...responses });
    const attachments = await buildDailySheetReportImages({
      reportDate,
      sections: email.imageSections,
    });

    const outcomes = [];
    for (const admin of admins) {
      const claimed = await claimRecipientDelivery(reportDate, admin, runToken, force);
      if (!claimed) {
        outcomes.push({ email: admin.email, status: 'skipped' });
        continue;
      }

      try {
        const result = await sendReportEmail({
          to: admin.email,
          toName: admin.name,
          subject: email.subject,
          text: email.text,
          html: email.html,
          attachments,
          trigger: 'daily_sheet_summary',
        });

        if (result?.status === 'sent') {
          await markRecipientDelivery(reportDate, admin.email, runToken, 'sent');
          outcomes.push({ email: admin.email, status: 'sent', messageId: result?.messageId });
        } else {
          const message = result?.error || 'SMTP did not accept the message';
          await markRecipientDelivery(reportDate, admin.email, runToken, 'failed', message);
          outcomes.push({ email: admin.email, status: 'failed', error: message });
        }
      } catch (error) {
        const message = error?.message || String(error);
        console.error(`[daily-sheet-report] delivery to ${admin.email} failed: ${message}`);
        await markRecipientDelivery(reportDate, admin.email, runToken, 'failed', message);
        outcomes.push({ email: admin.email, status: 'failed', error: message });
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const sent = outcomes.filter((o) => o.status === 'sent').length;
    const failed = outcomes.filter((o) => o.status === 'failed').length;
    const skipped = outcomes.filter((o) => o.status === 'skipped').length;
    const deliveryStatus = failed === 0 ? 'sent' : sent > 0 ? 'partial_failure' : 'failed';
    await markReportDelivery(reportDate, runToken, deliveryStatus);

    return {
      status: deliveryStatus,
      reportDate,
      taskCount,
      happyCount,
      recipientCount: admins.length,
      sent,
      failed,
      skipped,
      recipients: outcomes,
    };
  } catch (error) {
    await markReportDelivery(reportDate, runToken, 'failed');
    throw error;
  }
}
