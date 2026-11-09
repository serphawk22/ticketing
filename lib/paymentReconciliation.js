import { db } from './db.js';
import { withPayrollTransaction } from './payrollTx.js';
import { logPayrollAudit, resolveGatewayWorkspace } from './payrollAuth.js';

/**
 * SerpHawk HRMS - Payment Initiation & Webhook Reconciliation
 * 
 * Handles salary payments, idempotency, overpayment quarantine,
 * and ledger updates.
 */

/**
 * Initiate a salary payment for a payroll record
 */
export async function initiateSalaryPayment({
  workspaceId,
  payrollRecordId,
  amountCents,
  paymentMethod = 'bank_transfer',
  notes = '',
  actorId,
}) {
  return await withPayrollTransaction(workspaceId, async (txDb) => {
    const record = await txDb
      .prepare('SELECT * FROM payroll_records WHERE id = ? AND workspace_id = ?')
      .get(payrollRecordId, workspaceId);

    if (!record) throw new Error('Payroll record not found');
    if (record.status !== 'finalized' && record.status !== 'disbursed') {
      throw new Error(`Payments can only be initiated for finalized or disbursed records. Current status: ${record.status}`);
    }

    const currentPaid = record.total_paid_cents || 0;
    const remaining = record.net_pay_cents - currentPaid;

    if (amountCents > remaining) {
      throw new Error(`Payment amount (₹${amountCents / 100}) exceeds remaining balance (₹${remaining / 100})`);
    }

    const referenceId = `PAY-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const res = await txDb
      .prepare(
        `INSERT INTO salary_payments
          (workspace_id, period_id, payroll_record_id, employee_id, amount_cents, payment_method, reference_id, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'initiated', ?)`
      )
      .run(
        workspaceId,
        record.period_id,
        record.id,
        record.employee_id,
        amountCents,
        paymentMethod,
        referenceId,
        notes
      );

    const paymentId = res.lastInsertRowid;

    await logPayrollAudit({
      workspaceId,
      actorId,
      action: 'payment_initiated',
      entityType: 'salary_payment',
      entityId: paymentId,
      details: { referenceId, amountCents, paymentMethod },
    });

    return {
      id: paymentId,
      referenceId,
      amountCents,
      status: 'initiated',
    };
  });
}

/**
 * Process Gateway Webhook Callback (with Idempotency and Quarantine)
 * 
 * Flow:
 * 1. Resolve workspace_id from gateway mapping prior to opening transaction.
 * 2. Set tenant context in transaction.
 * 3. Enforce idempotency: return early if already processed.
 * 4. Safe quarantine: on mismatch or overpayment, do not crash; record as quarantined.
 */
export async function processWebhookCallback({
  gateway,
  eventId,
  eventType,
  payload,
  signature = '',
  referenceId,
  headerWorkspaceId = null,
}) {
  // Pre-transaction: Resolve workspace context
  const workspaceId = await resolveGatewayWorkspace({
    gateway,
    headerWorkspaceId,
  });

  return await withPayrollTransaction(workspaceId, async (txDb) => {
    // 1. Idempotency Check on (gateway, event_id)
    const existingEvent = await txDb
      .prepare('SELECT id, status FROM payment_webhook_events WHERE gateway = ? AND event_id = ?')
      .get(gateway, eventId);

    if (existingEvent) {
      if (existingEvent.status === 'processed') {
        return { status: 'idempotent_ok', message: 'Event already processed' };
      }
      if (existingEvent.status === 'quarantined') {
        return { status: 'quarantined', message: 'Event is already under quarantine review' };
      }
    }

    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

    // Record webhook event if not already present
    let webhookEventId = existingEvent?.id;
    if (!webhookEventId) {
      const insRes = await txDb
        .prepare(
          `INSERT INTO payment_webhook_events
            (gateway, event_id, event_type, payload_json, status, signature, reference_id)
           VALUES (?, ?, ?, ?, 'received', ?, ?)`
        )
        .run(gateway, eventId, eventType, payloadStr, signature, referenceId || null);
      webhookEventId = insRes.lastInsertRowid;
    }

    // 2. Lookup payment record using composite workspace_id AND reference_id
    if (!referenceId) {
      await txDb
        .prepare('UPDATE payment_webhook_events SET status = \'quarantined\' WHERE id = ?')
        .run(webhookEventId);

      await logPayrollAudit({
        workspaceId,
        action: 'webhook_quarantined',
        entityType: 'payment_webhook_event',
        entityId: webhookEventId,
        details: { reason: 'Missing reference_id in webhook payload' },
      });

      return { status: 'quarantined', reason: 'Missing reference_id' };
    }

    const payment = await txDb
      .prepare(
        'SELECT * FROM salary_payments WHERE workspace_id = ? AND reference_id = ?'
      )
      .get(workspaceId, referenceId);

    if (!payment) {
      await txDb
        .prepare('UPDATE payment_webhook_events SET status = \'quarantined\' WHERE id = ?')
        .run(webhookEventId);

      await logPayrollAudit({
        workspaceId,
        action: 'webhook_quarantined',
        entityType: 'payment_webhook_event',
        entityId: webhookEventId,
        details: { reason: 'No matching payment found for reference_id', referenceId },
      });

      return { status: 'quarantined', reason: 'Payment reference not found' };
    }

    // 3. Check for Overpayment or Tampering
    const record = await txDb
      .prepare('SELECT * FROM payroll_records WHERE id = ? AND workspace_id = ?')
      .get(payment.payroll_record_id, workspaceId);

    if (!record) {
      await txDb
        .prepare('UPDATE payment_webhook_events SET status = \'quarantined\' WHERE id = ?')
        .run(webhookEventId);

      return { status: 'quarantined', reason: 'Payroll record not found' };
    }

    const currentPaid = record.total_paid_cents || 0;
    const newTotalPaid = currentPaid + payment.amount_cents;

    // Check if new total would exceed net pay
    if (newTotalPaid > record.net_pay_cents) {
      await txDb
        .prepare('UPDATE payment_webhook_events SET status = \'quarantined\' WHERE id = ?')
        .run(webhookEventId);

      await logPayrollAudit({
        workspaceId,
        action: 'webhook_quarantined',
        entityType: 'payment_webhook_event',
        entityId: webhookEventId,
        details: {
          reason: 'Overpayment detected',
          netPayCents: record.net_pay_cents,
          currentPaidCents: currentPaid,
          attemptedPaymentCents: payment.amount_cents,
        },
      });

      return { status: 'quarantined', reason: 'Overpayment detected' };
    }

    // 4. Successful Reconciliation
    const newPaymentStatus = newTotalPaid >= record.net_pay_cents ? 'paid' : 'partially_paid';

    // Update payment record
    await txDb
      .prepare('UPDATE salary_payments SET status = \'completed\', updated_at = datetime(\'now\') WHERE id = ?')
      .run(payment.id);

    // Update payroll record paid balance
    await txDb
      .prepare(
        `UPDATE payroll_records
         SET total_paid_cents = ?,
             payment_status = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(newTotalPaid, newPaymentStatus, record.id);

    // Update webhook event status to processed
    await txDb
      .prepare(
        `UPDATE payment_webhook_events
         SET status = 'processed',
             processed_at = datetime('now')
         WHERE id = ?`
      )
      .run(webhookEventId);

    await logPayrollAudit({
      workspaceId,
      action: 'payment_reconciled',
      entityType: 'salary_payment',
      entityId: payment.id,
      details: {
        referenceId,
        amountCents: payment.amount_cents,
        newPaymentStatus,
        totalPaidCents: newTotalPaid,
      },
    });

    return {
      status: 'processed',
      paymentId: payment.id,
      referenceId,
      paymentStatus: newPaymentStatus,
      totalPaidCents: newTotalPaid,
    };
  });
}
