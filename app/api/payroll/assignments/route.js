import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { canManagePayroll, resolveValidWorkspaceId } from '@/lib/payrollAuth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role === 'client') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const workspaceId = await resolveValidWorkspaceId(searchParams.get('workspaceId'));

  try {
    const assignments = await db
      .prepare(
        `SELECT e.id as employee_id,
                e.id as id,
                esa.id as assignment_id,
                esa.structure_id,
                COALESCE(esa.base_salary_cents, CAST(ROUND(COALESCE(e.base_salary, 0) * 100) AS INTEGER), 0) as base_salary_cents,
                COALESCE(esa.currency, e.salary_currency, 'INR') as currency,
                esa.effective_from,
                e.name as employee_name,
                e.email as employee_email,
                e.department,
                e.title,
                ess.name as structure_name
         FROM employees e
         LEFT JOIN employee_salary_assignments esa ON esa.employee_id = e.id AND esa.is_active = true
         LEFT JOIN employee_salary_structures ess ON ess.id = esa.structure_id
         WHERE e.active = 1
         ORDER BY e.name ASC`
      )
      .all();

    return NextResponse.json({ assignments });
  } catch (err) {
    console.error('[API /api/payroll/assignments] GET error:', err);
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
    const empId = Number(body.employee_id || body.employeeId);
    const salaryCents = Number(body.base_salary_cents ?? body.baseSalaryCents ?? 0);
    const structureId = body.structure_id ? Number(body.structure_id) : null;
    const currency = String(body.currency || 'INR');
    const effectiveFrom = body.effective_from || new Date().toISOString().slice(0, 10);

    if (!empId || isNaN(salaryCents) || salaryCents <= 0) {
      return NextResponse.json({ error: 'Valid employee_id and base_salary_cents (> 0) are required' }, { status: 400 });
    }

    // Resolve or auto-seed a default structure if none chosen to satisfy database non-null constraints
    let finalStructureId = structureId;
    if (!finalStructureId) {
      let defaultStruct = await db
        .prepare('SELECT id FROM employee_salary_structures WHERE workspace_id = ? ORDER BY id ASC LIMIT 1')
        .get(workspaceId);

      if (!defaultStruct) {
        defaultStruct = await db
          .prepare('SELECT id FROM employee_salary_structures ORDER BY id ASC LIMIT 1')
          .get();
      }

      if (!defaultStruct) {
        const ins = await db
          .prepare(
            `INSERT INTO employee_salary_structures (workspace_id, name, description, is_active)
             VALUES (?, 'Standard Compensation Package', 'Default company package (Basic Salary + Allowances)', true)`
          )
          .run(workspaceId);
        finalStructureId = ins.lastInsertRowid;
      } else {
        finalStructureId = defaultStruct.id;
      }
    }

    // Deactivate previous active assignment for this employee
    await db
      .prepare('UPDATE employee_salary_assignments SET is_active = false, effective_to = ? WHERE employee_id = ? AND is_active = true')
      .run(effectiveFrom, empId);

    // Insert new assignment
    const res = await db
      .prepare(
        `INSERT INTO employee_salary_assignments
          (workspace_id, employee_id, structure_id, base_salary_cents, currency, effective_from, is_active)
         VALUES (?, ?, ?, ?, ?, ?, true)`
      )
      .run(
        workspaceId,
        empId,
        finalStructureId,
        salaryCents,
        currency,
        effectiveFrom
      );

    // Also sync to employees table so base_salary is preserved across the whole HRMS
    await db
      .prepare('UPDATE employees SET base_salary = ?, salary_currency = ?, last_payment_date = ? WHERE id = ?')
      .run(salaryCents / 100, currency, effectiveFrom, empId);

    return NextResponse.json({ assignmentId: res.lastInsertRowid, success: true }, { status: 201 });
  } catch (err) {
    console.error('[API /api/payroll/assignments] POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
