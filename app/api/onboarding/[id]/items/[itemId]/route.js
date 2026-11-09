import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { updateChecklistItem, deleteChecklistItem } from '@/lib/onboarding';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Admin or designated verifier/manager can mark items
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can update checklist items.' }, { status: 403 });
  }

  const { itemId } = await params;
  const checklistItemId = Number(itemId);

  try {
    const body = await request.json();
    const { status, notes } = body;

    const workflow = await updateChecklistItem(checklistItemId, {
      workspaceId: session.user.workspace_id,
      status,
      notes,
      completedBy: session.user.id,
    });

    return NextResponse.json({ workflow });
  } catch (err) {
    console.error('[api/onboarding/[id]/items/[itemId]] PATCH error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to update checklist item.' }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can remove checklist items.' }, { status: 403 });
  }

  const { itemId } = await params;
  const checklistItemId = Number(itemId);

  try {
    await deleteChecklistItem(checklistItemId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/onboarding/[id]/items/[itemId]] DELETE error:', err.message);
    return NextResponse.json({ error: 'Failed to delete checklist item.' }, { status: 500 });
  }
}

