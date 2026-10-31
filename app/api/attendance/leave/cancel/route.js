import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { cancelLeaveRequest } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const employeeId = session.user.employee_id;
  try {
    const body = await request.json().catch(() => ({}));
    const { requestId, reason } = body;

    if (!requestId) {
      return NextResponse.json({ error: 'Leave Request ID is required.' }, { status: 400 });
    }

    const updated = await cancelLeaveRequest({
      requestId,
      employeeId,
      adminUser: session.user,
      cancelReason: reason || 'Cancelled by user',
    });

    return NextResponse.json({ ok: true, leaveRequest: updated });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to cancel leave request.' }, { status: 400 });
  }
}

