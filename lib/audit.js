import { db } from './db.js';

/**
 * Record an audit event for important reporting and system actions:
 * - Ticket status / assignee changes
 * - Manual time-log edits / creations
 * - Report schedule creation / modification
 * - Employee profile / salary / role updates
 */
export async function logAuditEvent({
  actorId,
  actorName,
  action,
  entityType,
  entityId,
  details = {},
}) {
  try {
    const detailStr =
      typeof details === 'string' ? details : JSON.stringify(details || {});

    await db
      .prepare(
        `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        actorId || null,
        actorName || 'System',
        action,
        entityType,
        String(entityId || ''),
        detailStr
      );
  } catch (err) {
    // Audit logging should not crash the main operational mutation if it fails
    console.error('Failed to write audit log:', err);
  }
}

/**
 * Retrieve audit logs with optional filters
 */
export async function getAuditLogs({
  limit = 100,
  offset = 0,
  entityType = null,
  entityId = null,
  action = null,
} = {}) {
  const where = [];
  const params = [];

  if (entityType) {
    where.push('entity_type = ?');
    params.push(entityType);
  }
  if (entityId) {
    where.push('entity_id = ?');
    params.push(String(entityId));
  }
  if (action) {
    where.push('action = ?');
    params.push(action);
  }

  let sql = 'SELECT * FROM audit_logs';
  if (where.length > 0) {
    sql += ' WHERE ' + where.join(' AND ');
  }
  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(Number(limit) || 100, Number(offset) || 0);

  return db.prepare(sql).all(...params);
}

