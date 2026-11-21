import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployeeDailyProgress } from '@/lib/monitoring';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);
    const preset = searchParams.get('preset') || 'today';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const date = searchParams.get('date');

    const data = await getEmployeeDailyProgress({
      user: session.user,
      preset,
      from,
      to,
      date,
    });

    return NextResponse.json(data);
  } catch (err) {
    if (err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err.status === 403 || err.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('[GET /api/monitoring/today-progress] error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
