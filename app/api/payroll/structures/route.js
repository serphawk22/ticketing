import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { canManagePayroll, resolveValidWorkspaceId } from '@/lib/payrollAuth';
import { withPayrollTransaction } from '@/lib/payrollTx';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role === 'client') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const workspaceId = await resolveValidWorkspaceId(searchParams.get('workspaceId'));

  try {
    const structures = await db
      .prepare('SELECT * FROM employee_salary_structures WHERE workspace_id = ? ORDER BY name ASC')
      .all(workspaceId);

    for (const struct of structures) {
      struct.components = await db
        .prepare(
          `SELECT esca.*, sc.name, sc.code, sc.type, sc.calculation_type, sc.is_taxable, sc.is_statutory
           FROM employee_salary_component_assignments esca
           JOIN salary_components sc ON sc.id = esca.component_id
           WHERE esca.structure_id = ?`
        )
        .all(struct.id);
    }

    return NextResponse.json({ structures });
  } catch (err) {
    console.error('[API /api/payroll/structures] GET error:', err);
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
    const { name, description = '', components = [] } = body;

    if (!name) {
      return NextResponse.json({ error: 'Structure name is required' }, { status: 400 });
    }

    const structureId = await withPayrollTransaction(workspaceId, async (txDb) => {
      const res = await txDb
        .prepare(
          `INSERT INTO employee_salary_structures (workspace_id, name, description, is_active)
           VALUES (?, ?, ?, true)`
        )
        .run(workspaceId, name, description);

      const sId = res.lastInsertRowid;

      for (const comp of components) {
        if (!comp.component_id) continue;
        await txDb
          .prepare(
            `INSERT INTO employee_salary_component_assignments
              (workspace_id, structure_id, component_id, amount_cents, percentage_rate, is_active)
             VALUES (?, ?, ?, ?, ?, true)`
          )
          .run(
            workspaceId,
            sId,
            comp.component_id,
            comp.amount_cents || 0,
            comp.percentage_rate || 0
          );
      }
      return sId;
    });

    return NextResponse.json({ structureId, name, success: true }, { status: 201 });
  } catch (err) {
    console.error('[API /api/payroll/structures] POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
