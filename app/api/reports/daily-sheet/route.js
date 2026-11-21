import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { sendDailySheetReport } from '@/lib/dailySheetReport';
import { isTeamUser } from '@/lib/rbac';

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
  if (!isTeamUser(session.user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const reportDate = String(body.reportDate || '').trim();
  if (!isReportDate(reportDate)) {
    return NextResponse.json({ error: 'Choose a valid reporting date.' }, { status: 400 });
  }

  try {
    const force = body.force !== false;
    const result = await sendDailySheetReport({ reportDate, force });
    const statusCode =
      result.status === 'failed'
        ? 502
        : result.status === 'partial_failure'
        ? 207
        : result.status === 'no_responses'
        ? 404
        : result.status === 'no_admins'
        ? 422
        : 200;
    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    console.error('[daily-sheet-report:manual] failed:', error);
    return NextResponse.json(
      { error: error?.message || 'The daily report could not be sent.', status: 'failed' },
      { status: 500 }
    );
  }
}
