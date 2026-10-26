import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployeeAttendanceHistory } from '@/lib/attendance';
import { toKolkata } from '@/lib/businessHours';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role === 'client') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const employeeId = session.user.employee_id;
  if (!employeeId) {
    return NextResponse.json({
      error: 'No employee directory record associated with your user account.',
    }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const currentMonthStr = toKolkata(now).toISOString().slice(0, 7); // 'YYYY-MM'

  const month = searchParams.get('month') || currentMonthStr;
  const startDate = searchParams.get('startDate') || `${month}-01`;
  const endDate = searchParams.get('endDate') || `${month}-31`;

  const history = await getEmployeeAttendanceHistory({
    employeeId,
    startDate,
    endDate,
  });

  return NextResponse.json({
    month,
    startDate,
    endDate,
    ...history,
  });
}

