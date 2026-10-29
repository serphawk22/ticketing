import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { adminAdjustLeaveBalance } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: Only authorized administrators can modify leave balances.' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const {
      employeeId,
      fiscalYear,
      leaveType,
      adjustmentType,
      newValue,
      reason,
      expectedPreviousValue = null,
      idempotencyKey = null,
    } = body;

    if (!employeeId || !fiscalYear || !leaveType || !adjustmentType || newValue === undefined || !reason) {
      return NextResponse.json(
        { error: 'Missing required fields: employeeId, fiscalYear, leaveType, adjustmentType, newValue, and reason are required.' },
        { status: 400 }
      );
    }

    const updatedBalances = await adminAdjustLeaveBalance({
      employeeId: Number(employeeId),
      fiscalYear,
      leaveType,
      adjustmentType,
      newValue,
      reason,
      adminUser: session.user,
      expectedPreviousValue,
      idempotencyKey,
    });

    return NextResponse.json({ ok: true, balances: updatedBalances });
  } catch (err) {
    const statusCode = err.status || 400;
    return NextResponse.json(
      { error: err.message || 'Failed to adjust leave balance.' },
      { status: statusCode }
    );
  }
}

