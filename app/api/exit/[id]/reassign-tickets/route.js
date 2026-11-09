import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getExitRequest, reassignExitEmployeeTickets } from '@/lib/exitManagement';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can reassign tickets.' }, { status: 403 });
  }

  const { id } = await params;
  const exitReqId = Number(id);

  const exitReq = await getExitRequest(exitReqId, session.user.workspace_id);
  if (!exitReq) {
    return NextResponse.json({ error: 'Exit request not found.' }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { target_employee_id } = body;

    if (!target_employee_id) {
      return NextResponse.json({ error: 'Target employee ID is required.' }, { status: 400 });
    }

    const result = await reassignExitEmployeeTickets(
      exitReq.employee_id,
      Number(target_employee_id),
      session.user.workspace_id
    );

    const refreshed = await getExitRequest(exitReqId, session.user.workspace_id);
    return NextResponse.json({ ...result, request: refreshed });
  } catch (err) {
    console.error('[api/exit/[id]/reassign-tickets] Error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to reassign tickets.' }, { status: 400 });
  }
}

