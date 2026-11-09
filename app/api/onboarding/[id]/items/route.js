import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOnboardingWorkflow, addChecklistItem } from '@/lib/onboarding';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can add checklist items.' }, { status: 403 });
  }

  const { id } = await params;
  const workflowId = Number(id);

  const workflow = await getOnboardingWorkflow(workflowId, session.user.workspace_id);
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found.' }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { task_name, category, due_date } = body;

    if (!task_name || !task_name.trim()) {
      return NextResponse.json({ error: 'Task name is required.' }, { status: 400 });
    }

    const item = await addChecklistItem(workflowId, {
      workspaceId: session.user.workspace_id,
      taskName: task_name,
      category: category || 'General',
      dueDate: due_date || null,
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    console.error('[api/onboarding/[id]/items] POST error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to add checklist item.' }, { status: 400 });
  }
}

