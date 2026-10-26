import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { recordCheckIn } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function POST() {
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

  try {
    const record = await recordCheckIn({
      employeeId,
      userId: session.user.id,
    });

    return NextResponse.json({
      ok: true,
      attendance: record,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Check-in failed.' },
      { status: 400 }
    );
  }
}

