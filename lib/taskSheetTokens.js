import crypto from 'crypto';
import { db } from './db.js';
import { isAdminOrOwner } from './rbac.js';

export const TASK_SHEET_SESSION_COOKIE = 'sh_ts_session';
export const TASK_SHEET_CSRF_COOKIE = 'sh_ts_csrf';
const DEFAULT_TOKEN_DAYS = 30;
const SESSION_TTL_HOURS = 12;

export function hashSecret(rawValue) {
  return crypto.createHash('sha256').update(String(rawValue || '')).digest('hex');
}

function timingSafeHexEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function addHoursIso(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

function addDaysIso(days) {
  return new Date(Date.now() + days * 86400 * 1000).toISOString();
}

function parseIsoMs(value) {
  if (!value) return 0;
  const str = String(value).trim();
  const iso = str.endsWith('Z') || /[+-]\d{2}(:?\d{2})?$/.test(str) ? str : str.replace(' ', 'T') + 'Z';
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Generates a cryptographically strong employee-specific Task Sheet link token.
 * Stores ONLY `token_hash` and `token_hint` (last 6 chars) in the database.
 */
export async function issueTaskSheetToken({
  employeeId,
  expiresInDays = DEFAULT_TOKEN_DAYS,
  issuedBy,
  revokeExisting = false,
}) {
  if (!isAdminOrOwner(issuedBy)) {
    throw new Error('Forbidden: Only Business Owners or Administrators can issue Task Sheet tokens.');
  }
  const empId = Number(employeeId);
  if (!Number.isInteger(empId) || empId <= 0) {
    throw new Error('Valid employee_id is required.');
  }

  const days = Math.min(Math.max(Number(expiresInDays) || DEFAULT_TOKEN_DAYS, 1), 365);
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashSecret(rawToken);
  const tokenHint = rawToken.slice(-6);
  const expiresAt = addDaysIso(days);

  const emp = await db
    .prepare('SELECT id, name, email, role, active, user_id FROM employees WHERE id = ?')
    .get(empId);
  if (!emp || !emp.active) {
    throw new Error('Active employee not found.');
  }
  if (emp.role === 'client') {
    throw new Error('Client accounts cannot receive employee Task Sheet tokens.');
  }

  const record = await db.transaction(async (tx) => {
    if (revokeExisting) {
      const oldTokens = await tx
        .prepare('SELECT id FROM employee_task_sheet_tokens WHERE employee_id = ? AND revoked_at IS NULL')
        .all(empId);
      await tx
        .prepare("UPDATE employee_task_sheet_tokens SET revoked_at = datetime('now'), revoked_by = ? WHERE employee_id = ? AND revoked_at IS NULL")
        .run(issuedBy.id, empId);
      for (const old of oldTokens) {
        await tx
          .prepare("UPDATE task_sheet_sessions SET revoked_at = datetime('now') WHERE token_id = ? AND revoked_at IS NULL")
          .run(old.id);
      }
    }

    const ins = await tx
      .prepare(
        `INSERT INTO employee_task_sheet_tokens (employee_id, user_id, token_hash, token_hint, issued_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(empId, emp.user_id || null, tokenHash, tokenHint, issuedBy.id, expiresAt);

    await tx
      .prepare(
        `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
         VALUES (?, ?, 'task_sheet_token_issued', 'employee', ?, ?)`
      )
      .run(
        issuedBy.id,
        issuedBy.name || issuedBy.email || 'Admin',
        String(empId),
        JSON.stringify({ tokenId: ins.lastInsertRowid, tokenHint, expiresAt, revokeExisting })
      );

    return tx
      .prepare(
        `SELECT id, employee_id, user_id, token_hint, issued_by, expires_at, revoked_at, last_used_at, created_at
         FROM employee_task_sheet_tokens WHERE id = ?`
      )
      .get(ins.lastInsertRowid);
  });

  return {
    tokenRecord: record,
    rawToken,
    employee: { id: emp.id, name: emp.name, email: emp.email },
  };
}

/**
 * Lists token metadata (never token_hash or plaintext secret).
 */
export async function listTaskSheetTokens() {
  return db
    .prepare(
      `SELECT t.id, t.employee_id, t.user_id, t.token_hint, t.issued_by, t.expires_at,
              t.revoked_at, t.revoked_by, t.last_used_at, t.created_at,
              e.name AS employee_name, e.email AS employee_email, e.department AS employee_department,
              u.name AS issued_by_name
       FROM employee_task_sheet_tokens t
       JOIN employees e ON e.id = t.employee_id
       LEFT JOIN users u ON u.id = t.issued_by
       ORDER BY t.revoked_at IS NOT NULL ASC, t.created_at DESC`
    )
    .all();
}

/**
 * Immediately revokes an employee's token and invalidates all active browser sessions derived from it.
 */
export async function revokeTaskSheetToken({ tokenId, actor }) {
  if (!isAdminOrOwner(actor)) {
    throw new Error('Forbidden: Only Business Owners or Administrators can revoke Task Sheet tokens.');
  }
  const id = Number(tokenId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid tokenId.');
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .prepare('SELECT id, employee_id, token_hint, revoked_at FROM employee_task_sheet_tokens WHERE id = ?')
      .get(id);
    if (!existing) {
      throw new Error('Token not found.');
    }

    await tx
      .prepare("UPDATE employee_task_sheet_tokens SET revoked_at = COALESCE(revoked_at, datetime('now')), revoked_by = COALESCE(revoked_by, ?) WHERE id = ?")
      .run(actor.id, id);

    await tx
      .prepare("UPDATE task_sheet_sessions SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE token_id = ?")
      .run(id);

    await tx
      .prepare(
        `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
         VALUES (?, ?, 'task_sheet_token_revoked', 'employee', ?, ?)`
      )
      .run(
        actor.id,
        actor.name || actor.email || 'Admin',
        String(existing.employee_id),
        JSON.stringify({ tokenId: id, tokenHint: existing.token_hint })
      );

    return { ok: true, tokenId: id };
  });
}

/**
 * Exchanges a valid URL token for a short-lived HttpOnly cookie session + CSRF secret.
 * Plaintext token and secrets are never persisted.
 */
export async function exchangeTaskSheetToken({ rawToken, ipPrefix = '' }) {
  const cleaned = String(rawToken || '').trim();
  if (!cleaned || cleaned.length < 16) {
    return null;
  }

  const tokenHash = hashSecret(cleaned);
  const nowMs = Date.now();

  const tokenRow = await db
    .prepare(
      `SELECT t.*, e.name AS employee_name, e.email AS employee_email, e.department AS employee_department,
              e.title AS employee_title, e.role AS employee_role, e.active AS employee_active, e.user_id AS emp_user_id
       FROM employee_task_sheet_tokens t
       JOIN employees e ON e.id = t.employee_id
       WHERE t.token_hash = ?`
    )
    .get(tokenHash);

  if (!tokenRow) return null;
  if (tokenRow.revoked_at) return null;
  if (!tokenRow.employee_active || tokenRow.employee_role === 'client') return null;
  if (parseIsoMs(tokenRow.expires_at) <= nowMs) return null;

  const sessionSecret = crypto.randomBytes(32).toString('base64url');
  const csrfSecret = crypto.randomBytes(24).toString('base64url');
  const sessionHash = hashSecret(sessionSecret);
  const csrfHash = hashSecret(csrfSecret);

  const sessionExpMs = Math.min(nowMs + SESSION_TTL_HOURS * 3600 * 1000, parseIsoMs(tokenRow.expires_at));
  const expiresAt = new Date(sessionExpMs).toISOString();

  await db.transaction(async (tx) => {
    await tx
      .prepare("UPDATE employee_task_sheet_tokens SET last_used_at = datetime('now') WHERE id = ?")
      .run(tokenRow.id);

    await tx
      .prepare(
        `INSERT INTO task_sheet_sessions (session_hash, csrf_token_hash, token_id, employee_id, user_id, ip_prefix, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sessionHash,
        csrfHash,
        tokenRow.id,
        tokenRow.employee_id,
        tokenRow.user_id || tokenRow.emp_user_id || null,
        ipPrefix,
        expiresAt
      );
  });

  return {
    sessionSecret,
    csrfSecret,
    expiresAt,
    maxAgeSeconds: Math.max(60, Math.floor((sessionExpMs - nowMs) / 1000)),
    tokenId: tokenRow.id,
    employee: {
      id: Number(tokenRow.employee_id),
      user_id: tokenRow.user_id || tokenRow.emp_user_id || null,
      name: tokenRow.employee_name,
      email: tokenRow.employee_email,
      department: tokenRow.employee_department || '',
      title: tokenRow.employee_title || '',
    },
  };
}

/**
 * Validates an incoming `sh_ts_session` cookie (and CSRF token on mutations).
 * Rejects immediately if the underlying employee token OR browser session was revoked or expired.
 */
export async function validateTaskSheetCookieSession({
  sessionCookieValue,
  csrfToken = null,
  requireCsrf = false,
}) {
  const raw = String(sessionCookieValue || '').trim();
  if (!raw || raw.length < 16) return null;

  const sessionHash = hashSecret(raw);
  const row = await db
    .prepare(
      `SELECT s.*, t.revoked_at AS token_revoked_at, t.expires_at AS token_expires_at,
              e.name AS employee_name, e.email AS employee_email, e.department AS employee_department,
              e.title AS employee_title, e.role AS employee_role, e.active AS employee_active, e.user_id AS emp_user_id
       FROM task_sheet_sessions s
       JOIN employee_task_sheet_tokens t ON t.id = s.token_id
       JOIN employees e ON e.id = s.employee_id
       WHERE s.session_hash = ?`
    )
    .get(sessionHash);

  if (!row) return null;
  if (row.revoked_at || row.token_revoked_at) return null;
  if (!row.employee_active || row.employee_role === 'client') return null;

  const nowMs = Date.now();
  if (parseIsoMs(row.expires_at) <= nowMs || parseIsoMs(row.token_expires_at) <= nowMs) {
    return null;
  }

  if (requireCsrf) {
    const providedCsrf = String(csrfToken || '').trim();
    if (!providedCsrf) {
      return { csrfInvalid: true };
    }
    const providedHash = hashSecret(providedCsrf);
    if (!timingSafeHexEqual(providedHash, row.csrf_token_hash)) {
      return { csrfInvalid: true };
    }
  }

  return {
    csrfInvalid: false,
    sessionId: Number(row.id),
    tokenId: Number(row.token_id),
    expiresAt: row.expires_at,
    employee: {
      id: Number(row.employee_id),
      user_id: row.user_id || row.emp_user_id || null,
      name: row.employee_name,
      email: row.employee_email,
      department: row.employee_department || '',
      title: row.employee_title || '',
    },
  };
}
