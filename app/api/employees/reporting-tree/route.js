import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getReportingTree, getEmployeeHierarchy } from '@/lib/reportingTree';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role === 'client') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId');
  const employeeId = searchParams.get('employeeId');

  try {
    if (employeeId) {
      const hierarchy = await getEmployeeHierarchy(Number(employeeId));
      if (!hierarchy) {
        return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
      }
      return NextResponse.json(hierarchy);
    }

    const tree = await getReportingTree({
      workspaceId: workspaceId ? Number(workspaceId) : null,
    });

    return NextResponse.json(tree);
  } catch (err) {
    console.error('[API /api/employees/reporting-tree] GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

