import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { canDisbursePayroll } from '@/lib/payrollAuth';
import { initiateSalaryPayment } from '@/lib/paymentReconciliation';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canDisbursePayroll(session.user)) {
    return NextResponse.json({ error: 'Forbidden: Insufficient payment disbursement permissions' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { payroll_record_id, amount_cents, payment_method = 'bank_transfer', notes = '' } = body;

    if (!payroll_record_id || !amount_cents) {
      return NextResponse.json({ error: 'payroll_record_id and amount_cents are required' }, { status: 400 });
    }

    const rec = await db
      .prepare('SELECT workspace_id FROM payroll_records WHERE id = ?')
      .get(Number(payroll_record_id));
    if (!rec) return NextResponse.json({ error: 'Payroll record not found' }, { status: 404 });

    const payment = await initiateSalaryPayment({
      workspaceId: rec.workspace_id,
      payrollRecordId: Number(payroll_record_id),
      amountCents: Number(amount_cents),
      paymentMethod: payment_method,
      notes,
      actorId: session.user.id,
    });

    return NextResponse.json({ payment }, { status: 201 });
  } catch (err) {
    console.error('[API /api/payroll/payments/initiate] POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
