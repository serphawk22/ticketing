import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getDepartments, createDepartment } from '@/lib/departments';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role === 'client') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId');
  const activeOnly = searchParams.get('active') === 'true';

  try {
    const departments = await getDepartments({
      workspaceId: workspaceId ? Number(workspaceId) : null,
      activeOnly,
    });
    return NextResponse.json({ departments });
  } catch (err) {
    console.error('[API /api/departments] GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can create departments.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const department = await createDepartment({
      workspaceId: body.workspace_id,
      name: body.name,
      code: body.code,
      description: body.description,
      headEmployeeId: body.head_employee_id,
      actor: session.user,
    });

    return NextResponse.json({ department }, { status: 201 });
  } catch (err) {
    console.error('[API /api/departments] POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

