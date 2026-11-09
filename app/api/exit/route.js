import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getExitRequests, createExitRequest } from '@/lib/exitManagement';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || null;
  const employeeId = searchParams.get('employee_id') ? Number(searchParams.get('employee_id')) : null;

  try {
    const requests = await getExitRequests({
      workspaceId: session.user.workspace_id,
      status,
      employeeId,
    });
    return NextResponse.json({ requests });
  } catch (err) {
    console.error('[api/exit] GET error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch exit requests.' }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { employee_id, resignation_date, last_working_day, notice_period_days, reason, custom_tasks } = body;

    if (!employee_id) {
      return NextResponse.json({ error: 'Employee ID is required.' }, { status: 400 });
    }

    const exitReq = await createExitRequest({
      workspaceId: session.user.workspace_id,
      employeeId: Number(employee_id),
      resignationDate: resignation_date || null,
      lastWorkingDay: last_working_day || null,
      noticePeriodDays: notice_period_days ? Number(notice_period_days) : 30,
      reason: reason || '',
      submittedBy: session.user.id,
      customTasks: custom_tasks || null,
    });

    return NextResponse.json({ request: exitReq }, { status: 201 });
  } catch (err) {
    console.error('[api/exit] POST error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to submit exit request.' }, { status: 400 });
  }
}

