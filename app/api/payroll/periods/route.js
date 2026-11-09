import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { canManagePayroll, resolveValidWorkspaceId } from '@/lib/payrollAuth';
import { createPayrollPeriod } from '@/lib/payrollService';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role === 'client') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const workspaceId = await resolveValidWorkspaceId(searchParams.get('workspaceId'));

  try {
    const periods = await db
      .prepare(
        `SELECT pp.*,
                (SELECT COUNT(*) FROM payroll_records pr WHERE pr.period_id = pp.id) as record_count,
                u_app.name as approved_by_name,
                u_fin.name as finalized_by_name,
                u_dis.name as disbursed_by_name
         FROM payroll_periods pp
         LEFT JOIN users u_app ON u_app.id = pp.approved_by
         LEFT JOIN users u_fin ON u_fin.id = pp.finalized_by
         LEFT JOIN users u_dis ON u_dis.id = pp.disbursed_by
         WHERE pp.workspace_id = ?
         ORDER BY pp.start_date DESC`
      )
      .all(workspaceId);

    return NextResponse.json({ periods });
  } catch (err) {
    console.error('[API /api/payroll/periods] GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManagePayroll(session.user)) {
    return NextResponse.json({ error: 'Forbidden: Insufficient payroll permissions' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const workspaceId = await resolveValidWorkspaceId(body.workspace_id);
    const { period_name, start_date, end_date, pay_date } = body;

    const period = await createPayrollPeriod({
      workspaceId,
      periodName: period_name,
      startDate: start_date,
      endDate: end_date,
      payDate: pay_date,
      actorId: session.user.id,
    });

    return NextResponse.json({ period }, { status: 201 });
  } catch (err) {
    console.error('[API /api/payroll/periods] POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
