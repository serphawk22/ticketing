import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { resolveValidWorkspaceId } from '@/lib/payrollAuth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role === 'client') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const workspaceId = await resolveValidWorkspaceId(searchParams.get('workspaceId'));

  try {
    // 1. Periods overview
    const periods = await db
      .prepare(
        `SELECT status, COUNT(*) as count, 
                SUM(total_net_cents) as total_net_cents,
                SUM(total_gross_cents) as total_gross_cents
         FROM payroll_periods
         WHERE workspace_id = ?
         GROUP BY status`
      )
      .all(workspaceId);

    // 2. Disbursed vs Pending
    const totals = {
      draft: 0,
      calculated: 0,
      approved: 0,
      finalized: 0,
      disbursed: 0,
      disbursed_net_cents: 0,
      finalized_net_cents: 0,
    };

    for (const p of periods) {
      if (totals[p.status] != null) totals[p.status] = p.count;
      if (p.status === 'disbursed') totals.disbursed_net_cents = p.total_net_cents || 0;
      if (p.status === 'finalized') totals.finalized_net_cents = p.total_net_cents || 0;
    }

    // 3. Active employees with salary assignments
    const empCount = await db
      .prepare('SELECT COUNT(*) as c FROM employees WHERE active = 1')
      .get();

    const assignedCount = await db
      .prepare('SELECT COUNT(DISTINCT employee_id) as c FROM employee_salary_assignments WHERE is_active = true')
      .get();

    // 4. Recent audit logs
    const auditLogs = await db
      .prepare(
        `SELECT pal.*, u.name as actor_name
         FROM payroll_audit_logs pal
         LEFT JOIN users u ON u.id = pal.actor_id
         WHERE pal.workspace_id = ?
         ORDER BY pal.created_at DESC
         LIMIT 20`
      )
      .all(workspaceId);

    return NextResponse.json({
      summary: {
        ...totals,
        totalEmployees: empCount?.c || 0,
        employeesWithStructure: assignedCount?.c || 0,
      },
      auditLogs,
    });
  } catch (err) {
    console.error('[API /api/payroll/reports] GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
