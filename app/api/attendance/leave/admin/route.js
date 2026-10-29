import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getAllLeaveRequests,
  adminProcessLeaveRequest,
  detectLeaveConflicts,
  getEmployeeLeaveBalances,
} from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized: Admin access required.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'all';
  const employeeId = searchParams.get('employeeId') || null;

  try {
    const requests = await getAllLeaveRequests({ status, employeeId });
    return NextResponse.json({ ok: true, requests });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to fetch leave requests.' }, { status: 400 });
  }
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized: Admin access required.' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const {
      requestId,
      action,
      conflictResolutions = {},
      reviewerNotes = '',
      checkConflictsOnly = false,
      authorizedPaidDays = null,
      authorizedLopDays = null,
    } = body;

    if (!requestId) {
      return NextResponse.json({ error: 'Leave Request ID is required.' }, { status: 400 });
    }

    if (checkConflictsOnly) {
      const all = await getAllLeaveRequests({ status: 'all' });
      const target = all.find((r) => r.id === Number(requestId));
      if (!target) {
        return NextResponse.json({ error: 'Leave request not found.' }, { status: 404 });
      }
      const conflicts = await detectLeaveConflicts({
        employeeId: target.employee_id,
        startDate: target.start_date,
        endDate: target.end_date,
      });
      const balances = await getEmployeeLeaveBalances({
        employeeId: target.employee_id,
        dateInput: target.start_date,
      });
      return NextResponse.json({ ok: true, conflicts, balances });
    }

    const updated = await adminProcessLeaveRequest({
      requestId,
      action,
      adminUser: session.user,
      conflictResolutions,
      reviewerNotes,
      authorizedPaidDays,
      authorizedLopDays,
    });

    return NextResponse.json({ ok: true, leaveRequest: updated });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to process leave request.' }, { status: 400 });
  }
}

