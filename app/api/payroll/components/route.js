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
    const components = await db
      .prepare('SELECT * FROM salary_components WHERE workspace_id = ? ORDER BY type ASC, name ASC')
      .all(workspaceId);
    return NextResponse.json({ components });
  } catch (err) {
    console.error('[API /api/payroll/components] GET error:', err);
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
    const { name, code, type, calculation_type, is_taxable = true, is_statutory = false } = body;

    if (!name || !code || !type || !calculation_type) {
      return NextResponse.json(
        { error: 'Fields name, code, type (earning/deduction), and calculation_type are required' },
        { status: 400 }
      );
    }

    const res = await db
      .prepare(
        `INSERT INTO salary_components
          (workspace_id, name, code, type, calculation_type, is_taxable, is_statutory, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, true)`
      )
      .run(
        workspaceId,
        name,
        code.toUpperCase().trim(),
        type,
        calculation_type,
        Boolean(is_taxable),
        Boolean(is_statutory)
      );

    return NextResponse.json(
      { component: { id: res.lastInsertRowid, ...body, code: code.toUpperCase().trim() } },
      { status: 201 }
    );
  } catch (err) {
    console.error('[API /api/payroll/components] POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
