import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { reconcileUnclosedAttendance } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await requireAuth();
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron && (!session || session.user.role !== 'admin')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { workDate, employeeId } = await request.json().catch(() => ({}));
    const result = await reconcileUnclosedAttendance({ workDate, employeeId });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Reconciliation failed.' }, { status: 500 });
  }
}

