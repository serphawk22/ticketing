import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { submitLeaveRequest, getEmployeeLeaveRequests } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const employeeId = session.user.employee_id;
  if (!employeeId) {
    return NextResponse.json({ error: 'No employee record linked to user account.' }, { status: 404 });
  }

  try {
    const requests = await getEmployeeLeaveRequests(employeeId);
    return NextResponse.json({ ok: true, requests });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to fetch leave requests.' }, { status: 400 });
  }
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role === 'client') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const employeeId = session.user.employee_id;
  if (!employeeId) {
    return NextResponse.json({ error: 'No employee record linked to user account.' }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { leaveType, dayType = 'full_day', startDate, endDate, reason } = body;

    const leaveRequest = await submitLeaveRequest({
      employeeId,
      userId: session.user.id,
      leaveType,
      dayType,
      startDate,
      endDate,
      reason,
    });

    return NextResponse.json({ ok: true, leaveRequest });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to submit leave request.' }, { status: 400 });
  }
}

