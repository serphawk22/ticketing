import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getDesignations, createDesignation } from '@/lib/departments';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role === 'client') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId');
  const departmentId = searchParams.get('departmentId');
  const activeOnly = searchParams.get('active') === 'true';

  try {
    const designations = await getDesignations({
      workspaceId: workspaceId ? Number(workspaceId) : null,
      departmentId: departmentId ? Number(departmentId) : null,
      activeOnly,
    });
    return NextResponse.json({ designations });
  } catch (err) {
    console.error('[API /api/designations] GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can create designations.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const designation = await createDesignation({
      workspaceId: body.workspace_id,
      departmentId: body.department_id,
      title: body.title,
      code: body.code,
      level: body.level,
      description: body.description,
      actor: session.user,
    });

    return NextResponse.json({ designation }, { status: 201 });
  } catch (err) {
    console.error('[API /api/designations] POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

