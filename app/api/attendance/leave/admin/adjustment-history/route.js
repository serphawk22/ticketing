import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getLeaveBalanceAdjustments } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: Only authorized administrators can view leave balance adjustment history.' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get('employeeId') || null;
  const fiscalYear = searchParams.get('fiscalYear') || null;

  try {
    const adjustments = await getLeaveBalanceAdjustments({ employeeId, fiscalYear });
    return NextResponse.json({ ok: true, adjustments });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch adjustment history.' },
      { status: 400 }
    );
  }
}

