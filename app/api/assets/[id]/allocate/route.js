import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { allocateAsset } from '@/lib/assets';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can allocate assets.' }, { status: 403 });
  }

  const { id } = await params;
  const assetId = Number(id);

  try {
    const body = await request.json();
    const { employee_id, allocated_at, condition, notes } = body;

    if (!employee_id) {
      return NextResponse.json({ error: 'Employee ID is required for allocation.' }, { status: 400 });
    }

    const asset = await allocateAsset({
      workspaceId: session.user.workspace_id,
      assetId,
      employeeId: Number(employee_id),
      allocatedAt: allocated_at || null,
      condition: condition || null,
      notes: notes || '',
      allocatedBy: session.user.id,
    });

    return NextResponse.json({ asset });
  } catch (err) {
    console.error('[api/assets/[id]/allocate] POST error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to allocate asset.' }, { status: 400 });
  }
}

