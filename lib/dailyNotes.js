import { db } from './db.js';
import {
  assertCanAccessTicket,
  assertCanViewEmployee,
  getEmployeeIdForUser,
  isAdminOrOwner,
  isTeamUser,
  resolveUserScope,
} from './rbac.js';
import { todayKolkataDate } from './workLedger.js';

export const DAILY_NOTE_CATEGORIES = [
  { code: 'general', label: 'General Update' },
  { code: 'meeting', label: 'Internal Meeting' },
  { code: 'client_discussion', label: 'Client Discussion' },
  { code: 'documentation', label: 'Documentation' },
  { code: 'research', label: 'Research & R&D' },
  { code: 'training', label: 'Training & Learning' },
  { code: 'helping_teammate', label: 'Helping a Teammate' },
  { code: 'other', label: 'Other Activity' },
];

const VALID_CATEGORY_CODES = new Set(DAILY_NOTE_CATEGORIES.map((c) => c.code));
const SELF_EDIT_WINDOW_MS = 48 * 3600 * 1000;

function isValidIsoDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(str || '').trim())) return false;
  const [y, m, d] = String(str).trim().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const NOTE_SELECT = `
  SELECT n.*,
         e.name AS employee_name,
         e.department AS employee_department,
         e.title AS employee_title,
         t.title AS ticket_title,
         p.key AS project_key
  FROM daily_employee_notes n
  JOIN employees e ON e.id = n.employee_id
  LEFT JOIN tickets t ON t.id = n.ticket_id
  LEFT JOIN projects p ON p.id = t.project_id
`;

function formatNoteRow(row) {
  if (!row) return null;
  const catMeta = DAILY_NOTE_CATEGORIES.find((c) => c.code === row.category) || DAILY_NOTE_CATEGORIES[0];
  return {
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    userId: row.user_id != null ? Number(row.user_id) : null,
    employeeName: row.employee_name || '',
    department: row.employee_department || '',
    title: row.employee_title || '',
    workDate: row.work_date,
    ticketId: row.ticket_id != null ? Number(row.ticket_id) : null,
    ticketKey: row.ticket_id != null ? `${row.project_key || 'TM'}-${row.ticket_id}` : null,
    ticketTitle: row.ticket_title || null,
    category: row.category || 'general',
    categoryLabel: catMeta.label,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDailyNotes({
  user,
  from = null,
  to = null,
  employeeId = null,
  limit = 100,
}) {
  if (!user || !isTeamUser(user)) {
    const err = new Error('Forbidden: Team access required.');
    err.statusCode = 403;
    throw err;
  }

  const scope = await resolveUserScope(user);
  const where = [];
  const params = [];

  if (employeeId != null && employeeId !== '') {
    const access = await assertCanViewEmployee(user, employeeId);
    if (!access.allowed) {
      const err = new Error(access.error || 'Forbidden');
      err.statusCode = access.status || 403;
      throw err;
    }
    where.push('n.employee_id = ?');
    params.push(Number(employeeId));
  } else if (scope.canViewAll) {
    // No employee restriction
  } else if (scope.isManager) {
    const ids = Array.from(scope.scopedEmployeeIds);
    if (ids.length === 0) return [];
    where.push(`n.employee_id IN (${ids.map(() => '?').join(', ')})`);
    params.push(...ids);
  } else {
    if (!scope.employeeId) return [];
    where.push('n.employee_id = ?');
    params.push(Number(scope.employeeId));
  }

  if (from && isValidIsoDate(from)) {
    where.push('n.work_date >= ?');
    params.push(String(from).trim());
  }
  if (to && isValidIsoDate(to)) {
    where.push('n.work_date <= ?');
    params.push(String(to).trim());
  }

  const cleanLimit = Math.min(Math.max(1, Number(limit) || 100), 500);
  const sql = `${NOTE_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY n.work_date DESC, n.created_at DESC, n.id DESC LIMIT ?`;
  const rows = (await db.prepare(sql).all(...params, cleanLimit)) || [];
  return rows.map(formatNoteRow);
}

export async function createDailyNote({
  user,
  body,
  category = 'general',
  workDate = null,
  ticketId = null,
  testRunId = null,
}) {
  if (!user || !isTeamUser(user)) {
    const err = new Error('Forbidden: Only internal team members can post daily updates.');
    err.statusCode = 403;
    throw err;
  }

  const employeeId = await getEmployeeIdForUser(user);
  if (!employeeId) {
    const err = new Error('Forbidden: Your account is not linked to an active employee profile.');
    err.statusCode = 403;
    throw err;
  }

  const empRow = await db
    .prepare('SELECT id, active FROM employees WHERE id = ?')
    .get(Number(employeeId));
  if (!empRow || Number(empRow.active) !== 1) {
    const err = new Error('Forbidden: Inactive employee profile cannot submit daily updates.');
    err.statusCode = 403;
    throw err;
  }

  const cleanBody = String(body ?? '').trim();
  if (!cleanBody) {
    const err = new Error('Update note cannot be empty.');
    err.statusCode = 400;
    throw err;
  }
  if (cleanBody.length > 2000) {
    const err = new Error('Update note is too long (max 2000 characters).');
    err.statusCode = 400;
    throw err;
  }

  const cleanCat = String(category || 'general').trim().toLowerCase();
  const finalCategory = VALID_CATEGORY_CODES.has(cleanCat) ? cleanCat : 'general';

  const finalDate = workDate ? String(workDate).trim() : todayKolkataDate();
  if (!isValidIsoDate(finalDate)) {
    const err = new Error('workDate must be a valid YYYY-MM-DD date.');
    err.statusCode = 400;
    throw err;
  }

  let finalTicketId = null;
  if (ticketId != null && ticketId !== '') {
    const access = await assertCanAccessTicket(user, ticketId, { action: 'read' });
    if (!access.allowed) {
      const err = new Error(access.error || 'Forbidden ticket reference.');
      err.statusCode = access.status || 403;
      throw err;
    }
    finalTicketId = Number(access.ticket.id);
  }

  const res = await db
    .prepare(
      `INSERT INTO daily_employee_notes (employee_id, user_id, work_date, ticket_id, category, body, test_run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(employeeId),
      Number(user.id),
      finalDate,
      finalTicketId,
      finalCategory,
      cleanBody,
      testRunId || null
    );

  const created = await db
    .prepare(`${NOTE_SELECT} WHERE n.id = ?`)
    .get(Number(res.lastInsertRowid));
  return formatNoteRow(created);
}

async function assertCanMutateNote(user, noteId) {
  if (!user || !isTeamUser(user)) {
    const err = new Error('Forbidden: Team access required.');
    err.statusCode = 403;
    throw err;
  }
  const id = Number(noteId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('Invalid note ID.');
    err.statusCode = 400;
    throw err;
  }
  const existing = await db.prepare('SELECT * FROM daily_employee_notes WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('Daily update not found.');
    err.statusCode = 404;
    throw err;
  }

  if (isAdminOrOwner(user)) {
    return existing;
  }

  const ownEmployeeId = await getEmployeeIdForUser(user);
  const isOwnerOfNote =
    (ownEmployeeId != null && Number(existing.employee_id) === Number(ownEmployeeId)) ||
    (existing.user_id != null && Number(existing.user_id) === Number(user.id));
  if (!isOwnerOfNote) {
    const err = new Error('Forbidden: You can only modify your own daily updates.');
    err.statusCode = 403;
    throw err;
  }

  const createdMs = existing.created_at
    ? new Date(
        String(existing.created_at).endsWith('Z') || /[+-]\d{2}/.test(String(existing.created_at))
          ? existing.created_at
          : String(existing.created_at).replace(' ', 'T') + 'Z'
      ).getTime()
    : Date.now();
  if (!Number.isNaN(createdMs) && Date.now() - createdMs > SELF_EDIT_WINDOW_MS) {
    const err = new Error('Self-edits are only permitted within 48 hours of submission.');
    err.statusCode = 403;
    throw err;
  }

  return existing;
}

export async function updateDailyNote({ user, noteId, body, category }) {
  const existing = await assertCanMutateNote(user, noteId);

  const cleanBody = body !== undefined ? String(body ?? '').trim() : existing.body;
  if (!cleanBody) {
    const err = new Error('Update note cannot be empty.');
    err.statusCode = 400;
    throw err;
  }
  if (cleanBody.length > 2000) {
    const err = new Error('Update note is too long (max 2000 characters).');
    err.statusCode = 400;
    throw err;
  }

  const cleanCat =
    category !== undefined
      ? String(category || 'general').trim().toLowerCase()
      : existing.category;
  const finalCategory = VALID_CATEGORY_CODES.has(cleanCat) ? cleanCat : existing.category;
  const nowIso = new Date().toISOString();

  await db
    .prepare(
      `UPDATE daily_employee_notes
       SET body = ?, category = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(cleanBody, finalCategory, nowIso, existing.id);

  const updated = await db.prepare(`${NOTE_SELECT} WHERE n.id = ?`).get(existing.id);
  return formatNoteRow(updated);
}

export async function deleteDailyNote({ user, noteId }) {
  const existing = await assertCanMutateNote(user, noteId);
  await db.prepare('DELETE FROM daily_employee_notes WHERE id = ?').run(existing.id);
  return { deleted: true, id: Number(existing.id) };
}
