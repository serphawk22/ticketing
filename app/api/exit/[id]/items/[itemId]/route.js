import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { updateExitChecklistItem } from '@/lib/exitManagement';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const { itemId } = await params;
  const checklistItemId = Number(itemId);

  try {
    const body = await request.json();
    const { status, notes } = body;

    const exitReq = await updateExitChecklistItem(checklistItemId, {
      workspaceId: session.user.workspace_id,
      status,
      notes,
      completedBy: session.user.id,
    });

    return NextResponse.json({ request: exitReq });
  } catch (err) {
    console.error('[api/exit/[id]/items/[itemId]] PATCH error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to update item.' }, { status: 400 });
  }
}

