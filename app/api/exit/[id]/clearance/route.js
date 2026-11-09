import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { updateDepartmentClearance } from '@/lib/exitManagement';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can grant departmental clearances.' }, { status: 403 });
  }

  const { id } = await params;
  const exitReqId = Number(id);

  try {
    const body = await request.json();
    const { department, cleared, notes } = body;

    if (!department) {
      return NextResponse.json({ error: 'Department is required (hr, it, or finance).' }, { status: 400 });
    }

    const updated = await updateDepartmentClearance(exitReqId, {
      workspaceId: session.user.workspace_id,
      department,
      cleared: cleared !== undefined ? Boolean(cleared) : true,
      notes: notes || '',
      updatedBy: session.user.id,
    });

    return NextResponse.json({ request: updated });
  } catch (err) {
    console.error('[api/exit/[id]/clearance] POST error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to update clearance.' }, { status: 400 });
  }
}

