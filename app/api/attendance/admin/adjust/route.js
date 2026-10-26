import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { adminAdjustAttendance, getAttendanceAuditLogs } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized: Admin access required.' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { attendanceId, employeeId, workDate, status, checkInTime, checkOutTime, reason } = body;

    const record = await adminAdjustAttendance({
      attendanceId,
      employeeId,
      workDate,
      status,
      checkInTime,
      checkOutTime,
      reason,
      adminUser: session.user,
    });

    const auditLogs = await getAttendanceAuditLogs(record.id);

    return NextResponse.json({
      ok: true,
      attendance: record,
      auditLogs,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to adjust attendance.' },
      { status: 400 }
    );
  }
}

