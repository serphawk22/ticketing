import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getOnboardingWorkflow,
  updateOnboardingWorkflow,
  deleteOnboardingWorkflow,
} from '@/lib/onboarding';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const workflowId = Number(id);

  try {
    const workflow = await getOnboardingWorkflow(workflowId, session.user.workspace_id);
    if (!workflow) {
      return NextResponse.json({ error: 'Onboarding workflow not found.' }, { status: 404 });
    }
    return NextResponse.json({ workflow });
  } catch (err) {
    console.error('[api/onboarding/[id]] GET error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch onboarding details.' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can update onboarding workflows.' }, { status: 403 });
  }

  const { id } = await params;
  const workflowId = Number(id);

  try {
    const body = await request.json();
    const { status, target_joining_date, buddy_employee_id } = body;

    const updated = await updateOnboardingWorkflow(workflowId, {
      workspaceId: session.user.workspace_id,
      status,
      targetJoiningDate: target_joining_date,
      buddyEmployeeId: buddy_employee_id,
    });

    return NextResponse.json({ workflow: updated });
  } catch (err) {
    console.error('[api/onboarding/[id]] PATCH error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to update workflow.' }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can delete onboarding workflows.' }, { status: 403 });
  }

  const { id } = await params;
  const workflowId = Number(id);

  try {
    await deleteOnboardingWorkflow(workflowId, session.user.workspace_id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/onboarding/[id]] DELETE error:', err.message);
    return NextResponse.json({ error: 'Failed to delete workflow.' }, { status: 500 });
  }
}

