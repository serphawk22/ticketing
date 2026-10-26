import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getTodayAttendance, getAttendanceSettings, checkHoliday, isSundayWeeklyOff } from '@/lib/attendance';
import { toKolkata } from '@/lib/businessHours';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Clients have no access to internal attendance
  if (session.user.role === 'client') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const employeeId = session.user.employee_id;
  if (!employeeId) {
    return NextResponse.json({
      error: 'No employee directory record associated with your user account.',
    }, { status: 404 });
  }

  const now = new Date();
  const todayStr = toKolkata(now).toISOString().slice(0, 10);
  const holiday = await checkHoliday(now);
  const isSunday = isSundayWeeklyOff(now);
  const settings = await getAttendanceSettings();
  const attendance = await getTodayAttendance(employeeId);

  return NextResponse.json({
    todayStr,
    isSunday,
    holiday,
    settings,
    attendance,
  });
}

