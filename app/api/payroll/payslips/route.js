import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const employeeIdParam = searchParams.get('employeeId');
  const periodIdParam = searchParams.get('periodId');
  const isAdminOrDev = session.user.role === 'admin' || session.user.role === 'developer';

  let employeeId = session.user.employee_id;
  if (!employeeId) {
    const emp = await db.prepare('SELECT id FROM employees WHERE user_id = ?').get(session.user.id);
    if (emp) employeeId = emp.id;
  }
  if (isAdminOrDev && employeeIdParam) {
    employeeId = Number(employeeIdParam);
  }

  try {
    let sql = `
      SELECT p.id, p.workspace_id, p.period_id, p.employee_id, p.payroll_record_id,
             p.payslip_number, p.version, p.generated_at, p.pdf_url,
             e.name as employee_name, e.email as employee_email, e.department,
             pp.period_name, pp.pay_date, pp.start_date, pp.end_date,
             pr.net_pay_cents, pr.currency
      FROM payslips p
      JOIN employees e ON e.id = p.employee_id
      JOIN payroll_periods pp ON pp.id = p.period_id
      JOIN payroll_records pr ON pr.id = p.payroll_record_id
      WHERE 1=1
    `;
    const params = [];

    if (!isAdminOrDev || employeeId) {
      sql += ' AND p.employee_id = ?';
      params.push(employeeId || -1);
    }

    if (periodIdParam) {
      sql += ' AND p.period_id = ?';
      params.push(Number(periodIdParam));
    }

    sql += ' ORDER BY p.generated_at DESC';

    const payslips = await db.prepare(sql).all(...params);
    return NextResponse.json({ payslips });
  } catch (err) {
    console.error('[API /api/payroll/payslips] GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
