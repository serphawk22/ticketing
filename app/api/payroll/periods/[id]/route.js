import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role === 'client') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const periodId = Number(id);

  try {
    const period = await db
      .prepare(
        `SELECT pp.*,
                u_app.name as approved_by_name,
                u_fin.name as finalized_by_name,
                u_dis.name as disbursed_by_name
         FROM payroll_periods pp
         LEFT JOIN users u_app ON u_app.id = pp.approved_by
         LEFT JOIN users u_fin ON u_fin.id = pp.finalized_by
         LEFT JOIN users u_dis ON u_dis.id = pp.disbursed_by
         WHERE pp.id = ?`
      )
      .get(periodId);

    if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 });

    const records = await db
      .prepare(
        `SELECT pr.*, e.name as employee_name, e.email as employee_email, e.department, e.title
         FROM payroll_records pr
         JOIN employees e ON e.id = pr.employee_id
         WHERE pr.period_id = ?
         ORDER BY e.name ASC`
      )
      .all(periodId);

    for (const rec of records) {
      rec.earnings = await db
        .prepare('SELECT * FROM payroll_earnings WHERE payroll_record_id = ?')
        .all(rec.id);
      rec.deductions = await db
        .prepare('SELECT * FROM payroll_deductions WHERE payroll_record_id = ?')
        .all(rec.id);
      rec.payments = await db
        .prepare('SELECT * FROM salary_payments WHERE payroll_record_id = ? ORDER BY id DESC')
        .all(rec.id);
    }

    return NextResponse.json({ period, records });
  } catch (err) {
    console.error(`[API /api/payroll/periods/${periodId}] GET error:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
