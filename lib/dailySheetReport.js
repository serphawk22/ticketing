import { db } from './db.js';
import { listHappySubmissions } from './happySheet.js';
import { sendReportEmail } from './mail.js';
import { listSubmissions, submissionProjects } from './taskSheet.js';

const IST_TIME_ZONE = 'Asia/Kolkata';
const MAX_PAGE_HEIGHT = 980;
const MAX_CONTENT_HEIGHT = 920;
const PAGE_WIDTH = 1120;

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
  // IST has no daylight-saving changes. The stored timestamps are UTC, so this
  // gives one exact reporting day in both SQLite and Postgres.
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

function wrapText(value, maxChars = 110) {
  const words = String(value ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return ['-'];
  const lines = [];
  let line = '';
  for (const word of words) {
    // Preserve long unbroken values (for example a ticket key) without clipping.
    const pieces = word.length > maxChars ? word.match(new RegExp(`.{1,${maxChars}}`, 'g')) : [word];
    for (const piece of pieces) {
      const next = line ? `${line} ${piece}` : piece;
      if (next.length <= maxChars || !line) line = next;
      else {
        lines.push(line);
        line = piece;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
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

function taskFields(row) {
  const tickets = parseTickets(row);
  const fields = [
    ['Employee', row.name],
    ['Submitted', submittedAt(row.created_at)],
    ['Project', submissionProjects(row).join(', ') || row.project],
    ['Hours worked', `${row.hours_worked} hour${Number(row.hours_worked) === 1 ? '' : 's'}`],
    ['Task title', row.task_title],
    ['Task description', row.task_description],
    ['Completion status', row.task_state === 'completed' ? 'Completed' : 'Not completed'],
    ...(row.blocker ? [['Blocker', row.blocker]] : []),
    ...(row.learning_project ? [['Learning or other project', row.learning_project]] : []),
    ...(row.other_activities ? [['Other activities', row.other_activities]] : []),
  ];
  for (const ticket of tickets) {
    const status = ticket.taskStatus || (ticket.workState === 'completed' ? 'Completed' : 'Not completed');
    fields.push(['Work item', `${ticket.key || ticket.id || 'Ticket'}${ticket.title ? `: ${ticket.title}` : ''} (${status})`]);
    if (ticket.blocker) fields.push(['Work item blocker', ticket.blocker]);
  }
  if (!tickets.length && row.linked_ticket_id) {
    fields.push(['Linked ticket', `${(row.linked_key || 'TM').toUpperCase()}-${row.linked_ticket_id}`]);
  }
  return fields;
}

function happyFields(row) {
  return [
    ['Employee', row.name],
    ['Submitted', submittedAt(row.created_at)],
    ['What made your day happy', row.happy_one],
    ['Did you make anybody else happy', row.happy_others],
    ['Goals and self-satisfaction', row.happy_goals],
    ['Dreams', row.happy_dreams],
    ['Self-study or personal project', row.happy_self_study],
  ];
}

function sectionPages(title, rows, fieldBuilder) {
  const entries = rows.length
    ? rows.map((row) => fieldBuilder(row))
    : [[['Status', 'No responses submitted for this reporting date.']]];
  const pages = [];
  let current = [];
  let height = 180;
  for (const fields of entries) {
    const entryHeight = 32 + fields.reduce(
      (total, [, value]) => total + wrapText(value).length * 19 + 20,
      0
    );
    if (current.length && height + entryHeight + 14 > MAX_CONTENT_HEIGHT) {
      pages.push(current);
      current = [];
      height = 180;
    }
    current.push(fields);
    height += entryHeight + 14;
  }
  pages.push(current);
  return pages.map((entries, index) => ({ title, entries, continuation: index > 0 }));
}

function pageSvg({ reportDate, title, entries, continuation, pageNumber, pageCount }) {
  let y = 145;
  const body = [];
  body.push(`<rect x="0" y="0" width="${PAGE_WIDTH}" height="${MAX_PAGE_HEIGHT}" fill="#ffffff"/>`);
  body.push('<rect x="48" y="38" width="1024" height="4" fill="#0c66e4"/>');
  body.push('<text x="48" y="76" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#172b4d">Ticket Manager</text>');
  body.push('<text x="48" y="108" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#101828">Daily Task Sheet &amp; Happy Sheet Summary</text>');
  body.push(`<text x="48" y="132" font-family="Arial, sans-serif" font-size="14" fill="#626f86">${escapeXml(reportDateLabel(reportDate))}</text>`);
  body.push(`<text x="48" y="166" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#172b4d">${escapeXml(title)}${continuation ? ' (continued)' : ''}</text>`);
  y = 185;

  for (const fields of entries) {
    const fieldLines = fields.map(([label, value]) => [label, wrapText(value)]);
    const entryHeight = 24 + fieldLines.reduce((total, [, lines]) => total + lines.length * 19 + 20, 0);
    body.push(`<rect x="48" y="${y}" width="1024" height="${entryHeight}" rx="4" fill="#ffffff" stroke="#dfe1e6"/>`);
    let fieldY = y + 20;
    for (const [label, lines] of fieldLines) {
      body.push(`<text x="66" y="${fieldY}" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#44546f">${escapeXml(label)}</text>`);
      lines.forEach((line, index) => {
        body.push(`<text x="270" y="${fieldY + index * 19}" font-family="Arial, sans-serif" font-size="14" fill="#172b4d">${escapeXml(line)}</text>`);
      });
      fieldY += lines.length * 19 + 20;
    }
    y += entryHeight + 14;
  }
  body.push(`<text x="48" y="950" font-family="Arial, sans-serif" font-size="11" fill="#8590a2">Confidential employee response summary | Page ${pageNumber} of ${pageCount}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${MAX_PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${MAX_PAGE_HEIGHT}">${body.join('')}</svg>`;
}

export async function getDailySheetResponses(reportDate = reportDateParts()) {
  const { after, before } = istDayBounds(reportDate);
  // Fetch the two UTC dates which can overlap an IST day through the same
  // public query functions that power Sheet History. Filter exact instants in
  // JavaScript so SQLite and Postgres timezone parsing cannot disagree.
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
  const taskSubmissions = taskRows.filter(withinReportDay);
  const happySubmissions = happyRows.filter(withinReportDay);
  return { reportDate, taskSubmissions, happySubmissions };
}

export function buildDailySheetReportAttachments({ reportDate, taskSubmissions, happySubmissions }) {
  const pages = [
    ...sectionPages('Task Sheet Responses', taskSubmissions, taskFields),
    ...sectionPages('Happy Sheet Responses', happySubmissions, happyFields),
  ];
  return pages.map((page, index) => ({
    filename: `daily-task-happy-sheet-summary-${reportDate}-page-${index + 1}.svg`,
    content: Buffer.from(pageSvg({ ...page, reportDate, pageNumber: index + 1, pageCount: pages.length })),
    contentType: 'image/svg+xml',
  }));
}

async function claimReportDelivery(reportDate, runToken) {
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
  if (!delivery || delivery.status === 'sent' || delivery.status === 'running') return false;

  await db
    .prepare(
      `UPDATE daily_sheet_report_deliveries
       SET run_token = ?, status = 'running', completed_at = NULL
       WHERE report_date = ? AND status IN ('failed', 'partial_failure', 'no_admins')`
    )
    .run(runToken, reportDate);
  delivery = await db
    .prepare('SELECT * FROM daily_sheet_report_deliveries WHERE report_date = ?')
    .get(reportDate);
  return delivery?.run_token === runToken;
}

async function claimRecipientDelivery(reportDate, admin, runToken) {
  await db
    .prepare(
      `INSERT INTO daily_sheet_report_recipient_deliveries
       (report_date, recipient_email, recipient_name, run_token, status)
       VALUES (?, ?, ?, ?, 'running')
       ON CONFLICT (report_date, recipient_email) DO NOTHING`
    )
    .run(reportDate, admin.email, admin.name || '', runToken);
  let delivery = await db
    .prepare(
      `SELECT * FROM daily_sheet_report_recipient_deliveries
       WHERE report_date = ? AND recipient_email = ?`
    )
    .get(reportDate, admin.email);
  if (delivery?.run_token === runToken) return true;
  if (!delivery || delivery.status === 'sent' || delivery.status === 'running') return false;

  await db
    .prepare(
      `UPDATE daily_sheet_report_recipient_deliveries
       SET recipient_name = ?, run_token = ?, status = 'running', error = NULL, completed_at = NULL
       WHERE report_date = ? AND recipient_email = ? AND status = 'failed'`
    )
    .run(admin.name || '', runToken, reportDate, admin.email);
  delivery = await db
    .prepare(
      `SELECT * FROM daily_sheet_report_recipient_deliveries
       WHERE report_date = ? AND recipient_email = ?`
    )
    .get(reportDate, admin.email);
  return delivery?.run_token === runToken;
}

export async function sendDailySheetReport({ reportDate = reportDateParts(), force = false } = {}) {
  const runToken = crypto.randomUUID();
  if (!force && !(await claimReportDelivery(reportDate, runToken))) {
    return { status: 'already_processed', reportDate };
  }

  try {
    const [responses, admins] = await Promise.all([
      getDailySheetResponses(reportDate),
      db.prepare("SELECT name, email FROM users WHERE role = 'admin' AND email IS NOT NULL AND TRIM(email) <> ''").all(),
    ]);

    if (responses.taskSubmissions.length === 0 && responses.happySubmissions.length === 0) {
      return {
        status: 'no_responses',
        reportDate,
        taskCount: 0,
        happyCount: 0,
        recipientCount: 0,
      };
    }

    const attachments = buildDailySheetReportAttachments(responses);
    const dateLabel = reportDateLabel(reportDate);
    const subject = `Daily Task Sheet & Happy Sheet Summary — ${dateLabel}`;
    const text = [
      'Hello Admin,',
      '',
      `Please find attached the daily Task Sheet and Happy Sheet summary for ${dateLabel}.`,
      '',
      'The attached image or images contain the responses submitted for the reporting date, retrieved from Sheet History.',
      '',
      'Regards,',
      'Ticket Manager',
    ].join('\n');
    const html = `<p>Hello Admin,</p><p>Please find attached the daily Task Sheet and Happy Sheet summary for <strong>${escapeXml(dateLabel)}</strong>.</p><p>The attached image or images contain the responses submitted for the reporting date, retrieved from Sheet History.</p><p>Regards,<br>Ticket Manager</p>`;
    if (admins.length === 0) {
      return {
        status: 'no_admins',
        reportDate,
        taskCount: responses.taskSubmissions.length,
        happyCount: responses.happySubmissions.length,
        recipientCount: 0,
      };
    }
    let sent = 0;
    let failed = 0;
    for (const admin of admins) {
      if (!force && !(await claimRecipientDelivery(reportDate, admin, runToken))) {
        continue;
      }
      const result = await sendReportEmail({
        to: admin.email,
        toName: admin.name,
        subject,
        text,
        html,
        attachments,
        trigger: 'daily_sheet_summary',
      });
      if (!result) {
        failed += 1;
        continue;
      }
      const delivered = result.status === 'sent';
      if (delivered) sent += 1;
      else failed += 1;
    }
    return {
      status: failed ? 'partial_failure' : 'sent',
      reportDate,
      taskCount: responses.taskSubmissions.length,
      happyCount: responses.happySubmissions.length,
      recipientCount: admins.length,
      sent,
      failed,
    };
  } catch (error) {
    throw error;
  }
}
