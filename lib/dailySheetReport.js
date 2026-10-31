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

function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clipText(value, maxLength = 240) {
  const text = compactText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
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

function taskSummaryItems(row) {
  const items = [];
  const seen = new Set();
  const rowCompleted = row.task_state === 'completed';
  const push = (item) => {
    const title = compactText(item.title);
    if (!title) return;
    const key = title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ ...item, title });
  };

  if (compactText(row.task_title) || compactText(row.task_description)) {
    push({
      title: compactText(row.task_title) || 'Task update',
      description: row.task_description,
      completed: rowCompleted,
    });
  }

  for (const ticket of parseTickets(row)) {
    const key = compactText(ticket.key || ticket.id);
    const ticketTitle = compactText(ticket.title);
    const title =
      key && ticketTitle && !ticketTitle.toLowerCase().startsWith(key.toLowerCase())
        ? `${key}: ${ticketTitle}`
        : ticketTitle || key;
    const completed = ticketCompleted(ticket);
    push({
      title,
      description: ticket.description,
      completed: completed == null ? rowCompleted : completed,
    });
  }

  if (!items.length && row.linked_ticket_id) {
    push({
      title: `${(row.linked_key || 'TM').toUpperCase()}-${row.linked_ticket_id}`,
      completed: rowCompleted,
    });
  }

  if (!items.length) {
    push({
      title: 'Task update',
      description: row.task_description,
      completed: rowCompleted,
    });
  }

  return items;
}

function formatWorkItem(item) {
  const meta = [item.project ? `Project: ${item.project}` : '', item.hours].filter(Boolean).join(' · ');
  const description =
    item.description && item.description.toLowerCase() !== item.title.toLowerCase()
      ? ` — ${item.description}`
      : '';
  return `${item.name} — ${item.title}${description}${meta ? ` (${meta})` : ''}`;
}

function collectTaskSummary(rows) {
  const completed = [];
  const inProgress = [];
  const blockers = [];
  const notes = [];
  const employees = new Map();
  const seen = new Set();

  const add = (target, item, keyPrefix) => {
    const text = compactText(item);
    if (!text) return;
    const key = `${keyPrefix}|${text}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    target.push(text);
  };

  for (const row of rows) {
    const name = compactText(row.name) || 'Unnamed employee';
    employees.set(name.toLowerCase(), name);
    const project = submissionProjects(row).join(', ') || compactText(row.project);
    const hours = hoursLabel(row.hours_worked);

    for (const item of taskSummaryItems(row)) {
      const workItem = {
        name,
        title: clipText(item.title, 180),
        description: clipText(item.description),
        project,
        hours,
      };
      add(item.completed ? completed : inProgress, formatWorkItem(workItem), 'work');
    }

    if (compactText(row.blocker)) {
      add(blockers, `${name} — ${clipText(row.blocker)}`, 'blocker');
    }
    for (const ticket of parseTickets(row)) {
      if (compactText(ticket.blocker)) {
        add(blockers, `${name} — ${clipText(ticket.blocker)}`, 'blocker');
      }
    }
    add(notes, row.learning_project ? `${name} — Learning / other project: ${clipText(row.learning_project)}` : '', 'note');
    add(notes, row.other_activities ? `${name} — Other activities: ${clipText(row.other_activities)}` : '', 'note');
  }

  return {
    responseCount: rows.length,
    employeeNames: [...employees.values()].sort((a, b) => a.localeCompare(b)),
    completed,
    inProgress,
    blockers,
    notes,
  };
}

function collectHappySummary(rows) {
  const highlights = [];
  const proud = [];
  const goals = [];
  const notes = [];
  const employees = new Map();
  const seen = new Set();

  const add = (target, name, value, label, keyPrefix) => {
    const text = compactText(value);
    if (!text) return;
    const line = label ? `${name} — ${label}: ${clipText(text)}` : `${name} — ${clipText(text)}`;
    const key = `${keyPrefix}|${line}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    target.push(line);
  };

  for (const row of rows) {
    const name = compactText(row.name) || 'Unnamed employee';
    employees.set(name.toLowerCase(), name);
    add(highlights, name, row.happy_one, '', 'highlight');
    add(proud, name, row.happy_others, '', 'proud');
    add(goals, name, row.happy_goals, '', 'goal');
    add(notes, name, row.happy_dreams, 'Dreams', 'note');
    add(notes, name, row.happy_self_study, 'Self-study / personal project', 'note');
  }

  return {
    responseCount: rows.length,
    employeeNames: [...employees.values()].sort((a, b) => a.localeCompare(b)),
    highlights,
    proud,
    goals,
    notes,
  };
}

function responseLine(responseCount, employeeNames) {
  const count = `${responseCount} response${responseCount === 1 ? '' : 's'}`;
  return employeeNames.length ? `${count} from ${employeeNames.join(', ')}.` : `${count}.`;
}

function textSection(lines, heading, items, emptyMessage) {
  lines.push('', heading);
  if (items.length) {
    for (const item of items) lines.push(`- ${item}`);
  } else {
    lines.push(`- ${emptyMessage}`);
  }
}

function htmlList(items, emptyMessage) {
  if (!items.length) {
    return `<p style="margin:0;font-size:14px;line-height:1.5;color:#626f86">${escapeXml(emptyMessage)}</p>`;
  }
  return `<ul style="margin:0;padding-left:18px">${items
    .map(
      (item) =>
        `<li style="margin:0 0 6px;font-size:14px;line-height:1.5;color:#172b4d">${escapeXml(item)}</li>`
    )
    .join('')}</ul>`;
}

function htmlBlock(heading, items, emptyMessage, note = '') {
  return `<h3 style="margin:16px 0 6px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#626f86">${escapeXml(heading)}</h3>${
    note ? `<p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:#44546f">${escapeXml(note)}</p>` : ''
  }${htmlList(items, emptyMessage)}`;
}

function htmlSection(title, intro, blocks) {
  return `<div style="margin:24px 0 0;padding:18px 20px;border:1px solid #dfe1e6;border-radius:8px;background:#ffffff;color:#172b4d">
    <h2 style="margin:0 0 8px;font-size:18px;line-height:1.3;color:#172b4d">${escapeXml(title)}</h2>
    <p style="margin:0 0 4px;font-size:14px;line-height:1.5;color:#44546f">${escapeXml(intro)}</p>
    ${blocks.join('')}
  </div>`;
}

export function buildDailySheetSummary({ taskSubmissions = [], happySubmissions = [] } = {}) {
  const task = collectTaskSummary(taskSubmissions);
  const happy = collectHappySummary(happySubmissions);

  const taskLines = ['TASK SHEET SUMMARY'];
  taskLines.push(responseLine(task.responseCount, task.employeeNames));
  if (!task.responseCount) {
    taskLines.push('No Task Sheet responses were submitted for this reporting date.');
  } else {
    textSection(
      taskLines,
      'Completed Work / Key Achievements',
      task.completed,
      'No tasks were reported as completed.'
    );
    textSection(taskLines, 'In Progress', task.inProgress, 'No in-progress work was reported.');
    textSection(
      taskLines,
      'Blockers & Dependencies',
      task.blockers,
      'No blockers or dependencies were reported.'
    );
    taskLines.push('', 'Plans for Tomorrow');
    taskLines.push(
      task.inProgress.length
        ? 'No dedicated plans-for-tomorrow field was submitted. The in-progress items above are the only unfinished work reported.'
        : 'No dedicated plans-for-tomorrow field was submitted, and no unfinished work was reported.'
    );
    textSection(taskLines, 'Additional Notes', task.notes, 'No additional notes were submitted.');
  }

  const happyLines = ['HAPPY SHEET SUMMARY'];
  happyLines.push(responseLine(happy.responseCount, happy.employeeNames));
  if (!happy.responseCount) {
    happyLines.push('No Happy Sheet responses were submitted for this reporting date.');
  } else {
    happyLines.push(
      'The Happy Sheet does not ask for a numeric mood rating; the submitted reflections are summarised below.'
    );
    textSection(happyLines, "Today's Highlights", happy.highlights, 'No highlights were submitted.');
    textSection(
      happyLines,
      'Made Others Happy / Proud Of',
      happy.proud,
      'No responses were submitted for this section.'
    );
    textSection(
      happyLines,
      'Goals & Self-Satisfaction',
      happy.goals,
      'No goals were submitted.'
    );
    happyLines.push('', 'Challenges Faced');
    happyLines.push(
      'The Happy Sheet does not include a challenges field; any Task Sheet blockers are listed in the summary above.'
    );
    happyLines.push('', 'Goals for Tomorrow');
    happyLines.push(
      'No dedicated plans-for-tomorrow field was included in the Happy Sheet. Longer-term goals and dreams are listed under Additional Notes.'
    );
    textSection(happyLines, 'Additional Notes', happy.notes, 'No additional notes were submitted.');
  }

  const taskIntro = task.responseCount
    ? responseLine(task.responseCount, task.employeeNames)
    : 'No Task Sheet responses were submitted for this reporting date.';
  const happyIntro = happy.responseCount
    ? responseLine(happy.responseCount, happy.employeeNames)
    : 'No Happy Sheet responses were submitted for this reporting date.';

  const taskHtml = task.responseCount
    ? htmlSection('Task Sheet Summary', taskIntro, [
        htmlBlock(
          'Completed Work / Key Achievements',
          task.completed,
          'No tasks were reported as completed.'
        ),
        htmlBlock('In Progress', task.inProgress, 'No in-progress work was reported.'),
        htmlBlock(
          'Blockers & Dependencies',
          task.blockers,
          'No blockers or dependencies were reported.'
        ),
        htmlBlock(
          'Plans for Tomorrow',
          [],
          '',
          task.inProgress.length
            ? 'No dedicated plans-for-tomorrow field was submitted. The in-progress items above are the only unfinished work reported.'
            : 'No dedicated plans-for-tomorrow field was submitted, and no unfinished work was reported.'
        ),
        htmlBlock('Additional Notes', task.notes, 'No additional notes were submitted.'),
      ])
    : htmlSection('Task Sheet Summary', taskIntro, []);

  const happyHtml = happy.responseCount
    ? htmlSection(
        'Happy Sheet Summary',
        `${happyIntro} The Happy Sheet does not ask for a numeric mood rating; the submitted reflections are summarised below.`,
        [
          htmlBlock("Today's Highlights", happy.highlights, 'No highlights were submitted.'),
          htmlBlock(
            'Made Others Happy / Proud Of',
            happy.proud,
            'No responses were submitted for this section.'
          ),
          htmlBlock('Goals & Self-Satisfaction', happy.goals, 'No goals were submitted.'),
          htmlBlock(
            'Challenges Faced',
            [],
            '',
            'The Happy Sheet does not include a challenges field; any Task Sheet blockers are listed in the summary above.'
          ),
          htmlBlock(
            'Goals for Tomorrow',
            [],
            '',
            'No dedicated plans-for-tomorrow field was included in the Happy Sheet. Longer-term goals and dreams are listed under Additional Notes.'
          ),
          htmlBlock('Additional Notes', happy.notes, 'No additional notes were submitted.'),
        ]
      )
    : htmlSection('Happy Sheet Summary', happyIntro, []);

  return {
    text: [...taskLines, '', ...happyLines].join('\n'),
    html: `${taskHtml}${happyHtml}`,
  };
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

    let summary = null;
    try {
      summary = buildDailySheetSummary(responses);
    } catch (error) {
      console.error(`[daily-sheet-report] summary generation failed: ${error?.message || error}`);
    }

    const textLines = [
      'Hello Admin,',
      '',
      `Please find attached the daily Task Sheet and Happy Sheet summary for ${dateLabel}.`,
      '',
      'The attached image or images contain the responses submitted for the reporting date, retrieved from Sheet History.',
    ];
    if (summary?.text) textLines.push('', 'A text summary is included below.', '', summary.text);
    textLines.push('', 'Regards,', 'Ticket Manager');
    const text = textLines.join('\n');

    const html = `<p>Hello Admin,</p><p>Please find attached the daily Task Sheet and Happy Sheet summary for <strong>${escapeXml(dateLabel)}</strong>.</p><p>The attached image or images contain the responses submitted for the reporting date, retrieved from Sheet History.</p>${
      summary?.html ? `<p>A text summary is included below.</p>${summary.html}` : ''
    }<p>Regards,<br>Ticket Manager</p>`;
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
