import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployeeLeaveBalances } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedEmployeeId = searchParams.get('employeeId');
  const dateInput = searchParams.get('date') || null;

  const currentEmployeeId = session.user.employee_id;
  const isAdmin = session.user.role === 'admin';

  let targetEmployeeId = currentEmployeeId;

  if (requestedEmployeeId) {
    const parsedId = Number(requestedEmployeeId);
    if (!isAdmin && parsedId !== currentEmployeeId) {
      return NextResponse.json(
        { error: 'Forbidden: You are not authorized to view leave balances for other employees.' },
        { status: 403 }
      );
    }
    targetEmployeeId = parsedId;
  }

  if (!targetEmployeeId) {
    return NextResponse.json(
      { error: 'No employee directory record associated with your user account.' },
      { status: 404 }
    );
  }

  try {
    const balances = await getEmployeeLeaveBalances({
      employeeId: targetEmployeeId,
      dateInput,
    });
    return NextResponse.json({ ok: true, balances, ...balances });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to retrieve leave balances.' },
      { status: 400 }
    );
  }
}

