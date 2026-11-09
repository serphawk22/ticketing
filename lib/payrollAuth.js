import crypto from 'crypto';
import { db } from './db.js';

/**
 * Role-Based Access Control checks for Payroll actions
 */
export function canManagePayroll(user) {
  if (!user) return false;
  return user.role === 'admin' || user.role === 'developer' || Boolean(user.can_manage_payroll);
}

export function canCalculatePayroll(user) {
  if (!user) return false;
  return user.role === 'admin' || user.role === 'developer' || Boolean(user.can_calculate_payroll);
}

export function canApprovePayroll(user) {
  if (!user) return false;
  return user.role === 'admin' || user.role === 'developer' || Boolean(user.can_approve_payroll);
}

export function canFinalizePayroll(user) {
  if (!user) return false;
  return user.role === 'admin' || user.role === 'developer' || Boolean(user.can_finalize_payroll);
}

export function canDisbursePayroll(user) {
  if (!user) return false;
  return user.role === 'admin' || user.role === 'developer' || Boolean(user.can_disburse_payroll);
}

/**
 * Record an entry into payroll_audit_logs
 */
export async function logPayrollAudit({
  workspaceId,
  actorId = null,
  action,
  entityType,
  entityId = null,
  details = {},
  ipAddress = '',
}) {
  try {
    await db
      .prepare(
        `INSERT INTO payroll_audit_logs 
          (workspace_id, actor_id, action, entity_type, entity_id, details_json, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        workspaceId,
        actorId,
        action,
        entityType,
        entityId,
        typeof details === 'string' ? details : JSON.stringify(details),
        ipAddress
      );
  } catch (err) {
    console.error('Failed to write payroll audit log:', err);
  }
}

/**
 * Verify Webhook Signature (e.g. Razorpay/Stripe HMAC SHA256)
 */
export function verifyWebhookSignature({ payload, signature, secret }) {
  if (!signature || !secret) return false;
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Resolve a valid workspace_id that exists in the database
 */
export async function resolveValidWorkspaceId(requestedId) {
  if (requestedId != null && !isNaN(requestedId)) {
    const ws = await db
      .prepare('SELECT id FROM workspaces WHERE id = ?')
      .get(Number(requestedId));
    if (ws) return Number(ws.id);
  }

  const defaultWs = await db.prepare('SELECT id FROM workspaces ORDER BY id ASC LIMIT 1').get();
  return defaultWs ? Number(defaultWs.id) : 1;
}

/**
 * Resolve workspace_id from gateway mapping or webhook headers
 */
export async function resolveGatewayWorkspace({ gateway, apiKey, headerWorkspaceId }) {
  // If explicitly passed in trusted internal header
  if (headerWorkspaceId) {
    const ws = await db
      .prepare('SELECT id FROM workspaces WHERE id = ?')
      .get(headerWorkspaceId);
    if (ws) return ws.id;
  }

  // Lookup first active workspace as fallback default in self-hosted/local
  const defaultWs = await db.prepare('SELECT id FROM workspaces ORDER BY id ASC LIMIT 1').get();
  return defaultWs ? defaultWs.id : 1;
}
