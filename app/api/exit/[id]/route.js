import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getExitRequest, updateExitRequest, deleteExitRequest } from '@/lib/exitManagement';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const exitReqId = Number(id);

  try {
    const exitReq = await getExitRequest(exitReqId, session.user.workspace_id);
    if (!exitReq) {
      return NextResponse.json({ error: 'Exit request not found.' }, { status: 404 });
    }
    return NextResponse.json({ request: exitReq });
  } catch (err) {
    console.error('[api/exit/[id]] GET error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch exit request.' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can update exit requests.' }, { status: 403 });
  }

  const { id } = await params;
  const exitReqId = Number(id);

  try {
    const body = await request.json();
    const { status, last_working_day, notice_period_days, reason, exit_interview_notes } = body;

    const updated = await updateExitRequest(exitReqId, {
      workspaceId: session.user.workspace_id,
      status,
      lastWorkingDay: last_working_day,
      noticePeriodDays: notice_period_days,
      reason,
      exitInterviewNotes: exit_interview_notes,
      approvedBy: session.user.id,
    });

    return NextResponse.json({ request: updated });
  } catch (err) {
    console.error('[api/exit/[id]] PATCH error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to update exit request.' }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can delete exit requests.' }, { status: 403 });
  }

  const { id } = await params;
  const exitReqId = Number(id);

  try {
    await deleteExitRequest(exitReqId, session.user.workspace_id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/exit/[id]] DELETE error:', err.message);
    return NextResponse.json({ error: 'Failed to delete exit request.' }, { status: 500 });
  }
}

