import { db } from './db';
import { getEmployee } from './employees';
import { STATUS_META, PRIORITY_META, FIELD_META, ticketKey } from './ticketMeta';

/**
 * In-app notifications, global to the team.
 *
 * Every event fans out to one row per admin and developer, so the bell shows
 * what happened anywhere in Ticket Manager -- any project, any ticket, any
 * actor -- rather than only what touched the current user. Read state lives on
 * the per-user row, so marking something read never affects anybody else.
 *
 * The fan-out is intentionally plain SQL inserts in a loop: the recipient list
 * is a handful of people, and keeping one statement per person means the
 * dedupe index on (user_id, dedupe_key) can reject a retried event per user
 * without any dialect-specific upsert.
 */

const TEAM_ROLES = ['admin', 'developer'];

export async function getNotificationRecipients() {
  return db
    .prepare("SELECT id FROM users WHERE role IN ('admin', 'developer')")
    .all();
}

/**
 * Where a ticket opens in the list view, the same destination the top-nav
 * search uses. Stored on the row at write time so the panel never has to
 * re-derive a project's key from the ticket id at read time.
 */
function linkFor(ticket) {
  const key = ticketKey(ticket);
  return ticket.project_id
    ? `/projects/${ticket.project_id}/list?selectedIssue=${encodeURIComponent(key)}`
    : `/work-items?selectedIssue=${encodeURIComponent(key)}`;
}

export async function createNotifications({
  type,
  actorId = null,
  ticket = null,
  title,
  body = '',
  link = '',
  dedupeKey = '',
}) {
  const recipients = await getNotificationRecipients();
  if (!recipients.length) return 0;

  let created = 0;
  for (const recipient of recipients) {
    const info = await db
      .prepare(
        `INSERT OR IGNORE INTO notifications
           (user_id, actor_id, type, ticket_id, project_id, title, body, link, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        recipient.id,
        actorId || null,
        type,
        ticket?.id ?? null,
        ticket?.project_id ?? null,
        title,
        body,
        link,
        dedupeKey || ''
      );
    created += info.rowCount;
  }
  return created;
}

export async function notifyTicketCreated({ ticket, actorId, actorName }) {
  const key = ticketKey(ticket);
  await createNotifications({
    type: 'created',
    actorId,
    ticket,
    title: `${key} created`,
    body: `${actorName} created "${ticket.title}"`,
    link: linkFor(ticket),
    // A ticket can only be created once, so the pair is a natural idempotency
    // key: a retried request cannot post the same event twice.
    dedupeKey: `created:${ticket.id}`,
  });
}

export async function notifyTicketAssigned({
  ticket,
  actorId,
  actorName,
  employeeName,
  trigger = 'assignment',
}) {
  const key = ticketKey(ticket);
  const reassigned = trigger === 'reassignment';
  await createNotifications({
    type: trigger,
    actorId,
    ticket,
    title: `${key} ${reassigned ? 'reassigned' : 'assigned'}`,
    body: `${actorName} ${reassigned ? 'reassigned' : 'assigned'} ${key} to ${employeeName || 'nobody'}`,
    link: linkFor(ticket),
    // First assignment happens once per ticket. A reassignment is a fresh
    // event every time -- the same ticket can move between people repeatedly.
    dedupeKey: reassigned ? '' : `assignment:${ticket.id}`,
  });
}

/**
 * Fields that get their own notification type rather than being folded into
 * the generic "updated" summary below. archived_at/archived_by/slack_channel
 * are bookkeeping and never appear here; archived is its own event.
 */
const SPECIAL_FIELDS = new Set([
  'employee_id',
  'status',
  'priority',
  'due_date',
  'resolution',
  'archived',
]);

/**
 * Bookkeeping keys that ride along with a real edit but are not changes worth
 * announcing: archived_at/archived_by accompany the `archived` flag (which has
 * its own event), and slack_channel is plumbing. The activity feed skips the
 * same three, so the bell and the history stay in step.
 */
const IGNORED_FIELDS = new Set(['archived_at', 'archived_by', 'slack_channel']);

/**
 * One PATCH can touch many fields. Each special field becomes its own typed
 * notification (status, priority, due date, resolution, assignment); every
 * remaining edited field collapses into a single "updated" summary so a bulk
 * edit does not spam the bell with one row per field.
 */
export async function notifyTicketUpdated({ before, after, actorId, actorName, fields = [] }) {
  const key = ticketKey(after);
  const link = linkFor(after);
  const events = [];

  const wasAssigned = Number(before.employee_id || 0);
  const isAssigned = Number(after.employee_id || 0);
  if (wasAssigned !== isAssigned) {
    const employee = isAssigned ? await getEmployee(isAssigned) : null;
    events.push({
      type: wasAssigned ? 'reassignment' : 'assignment',
      title: `${key} ${wasAssigned ? 'reassigned' : 'assigned'}`,
      body: `${actorName} ${wasAssigned ? 'reassigned' : 'assigned'} ${key} to ${employee?.name || 'nobody'}`,
      // Empty key: a second reassignment is a new event, not a duplicate.
      dedupeKey: '',
    });
  }

  if (before.status !== after.status) {
    events.push({
      type: 'status',
      title: `${key} status changed`,
      body: `${actorName} moved ${key} from ${STATUS_META[before.status]?.label || before.status} to ${STATUS_META[after.status]?.label || after.status}`,
      dedupeKey: '',
    });
  }

  if (before.priority !== after.priority) {
    events.push({
      type: 'priority',
      title: `${key} priority changed`,
      body: `${actorName} changed ${key} priority from ${PRIORITY_META[before.priority]?.label || before.priority} to ${PRIORITY_META[after.priority]?.label || after.priority}`,
      dedupeKey: '',
    });
  }

  if ((before.due_date || null) !== (after.due_date || null)) {
    events.push({
      type: 'due_date',
      title: `${key} due date changed`,
      body: `${actorName} changed the due date of ${key} from ${before.due_date || 'none'} to ${after.due_date || 'none'}`,
      dedupeKey: '',
    });
  }

  if ((before.resolution || '') !== (after.resolution || '')) {
    events.push({
      type: 'resolution',
      title: `${key} resolution changed`,
      body: after.resolution
        ? `${actorName} set the resolution of ${key} to "${after.resolution}"`
        : `${actorName} cleared the resolution of ${key}`,
      dedupeKey: '',
    });
  }

  if (Boolean(before.archived) !== Boolean(after.archived)) {
    events.push({
      type: 'archive',
      title: `${key} ${after.archived ? 'archived' : 'restored'}`,
      body: after.archived
        ? `${actorName} archived ${key}`
        : `${actorName} restored ${key}`,
      dedupeKey: '',
    });
  }

  const other = fields.filter((f) => !SPECIAL_FIELDS.has(f) && !IGNORED_FIELDS.has(f));
  if (other.length) {
    const labels = other.map((f) => FIELD_META[f]?.label || f).join(', ');
    events.push({
      type: 'update',
      title: `${key} updated`,
      body: `${actorName} updated ${labels.toLowerCase()} on ${key}`,
      dedupeKey: '',
    });
  }

  for (const event of events) {
    await createNotifications({ ...event, actorId, ticket: after, link });
  }
}

/**
 * @-mentions in a comment. A token matches a team member when it equals their
 * email local-part, their full name, or their first name -- the three forms
 * people actually type. Returns display names, in the order the directory
 * lists them, for the notification body.
 */
const MENTION_TOKEN = /@([A-Za-z0-9._+-]+)/g;

export async function findMentionedNames(text) {
  const tokens = new Set();
  const scanner = new RegExp(MENTION_TOKEN.source, 'g');
  let match;
  while ((match = scanner.exec(String(text || '')))) {
    tokens.add(match[1].toLowerCase());
  }
  if (!tokens.size) return [];

  const team = await db
    .prepare("SELECT name, email FROM users WHERE role IN ('admin', 'developer')")
    .all();

  const names = [];
  for (const user of team) {
    const emailLocal = String(user.email || '').split('@')[0].toLowerCase();
    const fullName = String(user.name || '').trim().toLowerCase();
    const firstName = fullName.split(/\s+/)[0];
    if ([emailLocal, fullName, firstName].some((v) => v && tokens.has(v))) {
      names.push(user.name);
    }
  }
  return names;
}

/**
 * A comment is either an ordinary comment event or -- when it names people --
 * a mention event. One row either way: a comment that mentions someone is not
 * also a plain comment, or the bell would show the same message twice.
 */
export async function notifyTicketCommented({
  ticket,
  commentId,
  actorId,
  actorName,
  excerpt,
  mentioned = [],
}) {
  const key = ticketKey(ticket);
  const isMention = mentioned.length > 0;
  await createNotifications({
    type: isMention ? 'mention' : 'comment',
    actorId,
    ticket,
    title: isMention ? `${key} mentioned ${mentioned.join(', ')}` : `${key} new comment`,
    body: isMention
      ? `${actorName} mentioned ${mentioned.join(', ')}: ${excerpt}`
      : `${actorName} commented: ${excerpt}`,
    link: linkFor(ticket),
    // A comment id names exactly one event, so it dedupes a retried POST.
    dedupeKey: `comment:${commentId}:${isMention ? 'mention' : 'comment'}`,
  });
}

/**
 * Status changes that happen outside the ticket PATCH route -- the task sheet
 * syncs a ticket's status when somebody logs completed work against it. Loads
 * the full ticket so the key and link match every other notification.
 */
export async function notifyTicketStatusChanged({ ticketId, from, to, actorId, actorName }) {
  if (!from || !to || from === to) return;
  const ticket = await db
    .prepare(
      `SELECT t.*, p.key AS project_key
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.id = ?`
    )
    .get(Number(ticketId));
  if (!ticket) return;

  const key = ticketKey(ticket);
  await createNotifications({
    type: 'status',
    actorId,
    ticket,
    title: `${key} status changed`,
    body: `${actorName || 'Task sheet'} moved ${key} from ${STATUS_META[from]?.label || from} to ${STATUS_META[to]?.label || to}`,
    link: linkFor(ticket),
    dedupeKey: '',
  });
}

/* ---------------- Reading ---------------- */

const NOTIFICATION_COLUMNS = `
  SELECT n.id, n.user_id, n.actor_id, n.type, n.ticket_id, n.project_id,
         n.title, n.body, n.link, n.read, n.created_at,
         a.name AS actor_name, p.key AS project_key
  FROM notifications n
  LEFT JOIN users a ON a.id = n.actor_id
  LEFT JOIN projects p ON p.id = n.project_id
`;

/**
 * Newest first, cursor-paginated by id. The caller is always the signed-in
 * user and the filter is only on user_id -- never on project, ticket or
 * assignee -- which is what keeps the feed global while read state stays
 * personal.
 */
export async function getNotifications(userId, { limit = 20, before = null } = {}) {
  const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const params = [Number(userId)];
  let where = 'n.user_id = ?';
  if (Number(before) > 0) {
    where += ' AND n.id < ?';
    params.push(Number(before));
  }
  const rows = await db
    .prepare(`${NOTIFICATION_COLUMNS} WHERE ${where} ORDER BY n.id DESC LIMIT ?`)
    .all(...params, size + 1);
  // One extra row tells the panel there is older history without a COUNT.
  const hasMore = rows.length > size;
  return { notifications: rows.slice(0, size), hasMore };
}

export async function getUnreadNotificationCount(userId) {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0')
    .get(Number(userId));
  return Number(row?.c || 0);
}

export async function markNotificationsRead(userId, ids) {
  let changed = 0;
  for (const id of ids) {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric <= 0) continue;
    const info = await db
      .prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ? AND read = 0')
      .run(Number(userId), numeric);
    changed += info.rowCount;
  }
  return changed;
}

export async function markAllNotificationsRead(userId) {
  const info = await db
    .prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0')
    .run(Number(userId));
  return info.rowCount;
}
