import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployee } from '@/lib/employees';
import { getEmployeeAssets } from '@/lib/assets';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const employeeId = Number(id);

  const employee = await getEmployee(employeeId);
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  // Admin or the employee themselves can view assigned assets
  const isAdmin = session.user.role === 'admin';
  const isSelf = employee.user_id && Number(session.user.id) === Number(employee.user_id);
  if (!isAdmin && !isSelf) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  try {
    const assets = await getEmployeeAssets(employeeId, employee.workspace_id);
    return NextResponse.json({ assets });
  } catch (err) {
    console.error('[api/employees/[id]/assets] GET error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch employee assets.' }, { status: 500 });
  }
}

