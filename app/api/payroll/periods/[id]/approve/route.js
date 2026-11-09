import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { canApprovePayroll } from '@/lib/payrollAuth';
import { approvePayrollPeriod } from '@/lib/payrollService';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canApprovePayroll(session.user)) {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions to approve payroll' }, { status: 403 });
  }

  const { id } = await params;
  const periodId = Number(id);

  try {
    const period = await db.prepare('SELECT workspace_id FROM payroll_periods WHERE id = ?').get(periodId);
    if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 });

    const result = await approvePayrollPeriod({
      workspaceId: period.workspace_id,
      periodId,
      actorId: session.user.id,
    });

    return NextResponse.json({ result });
  } catch (err) {
    console.error(`[API /api/payroll/periods/${periodId}/approve] POST error:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
