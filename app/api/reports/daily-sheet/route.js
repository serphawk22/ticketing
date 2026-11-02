import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { sendDailySheetReport } from '@/lib/dailySheetReport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isReportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin' && session.user.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const reportDate = String(body.reportDate || '').trim();
  if (!isReportDate(reportDate)) {
    return NextResponse.json({ error: 'Choose a valid reporting date.' }, { status: 400 });
  }

  try {
    const result = await sendDailySheetReport({ reportDate, force: true });
    return NextResponse.json(result, {
      status: result.status === 'partial_failure' ? 502 : 200,
    });
  } catch (error) {
    console.error('[daily-sheet-report:manual] failed:', error);
    return NextResponse.json({ error: 'The daily report could not be sent.' }, { status: 500 });
  }
}
