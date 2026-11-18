import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { sendEndOfDayEmails, getEndOfDayReport } from '@/lib/endOfDayReportService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only Admin users can trigger or retry End of Day Report email deliveries
  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: Only administrators can trigger report email delivery.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const reportId = Number(body.reportId);
  const retryOnly = Boolean(body.retryOnly);

  if (!reportId || !Number.isInteger(reportId)) {
    return NextResponse.json({ error: 'Valid report ID is required.' }, { status: 400 });
  }

  try {
    const outcome = await sendEndOfDayEmails({
      reportId,
      retryOnly,
    });

    return NextResponse.json({
      ok: true,
      ...outcome,
    });
  } catch (err) {
    console.error('[end-of-day:send] Email dispatch failed:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to dispatch End of Day emails.' },
      { status: 500 }
    );
  }
}

