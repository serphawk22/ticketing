import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCachedTaskSheetAiSummary } from '@/lib/taskSheetAi';
import { aggregateTaskSheetPulseMetrics, extractIstDate } from '@/lib/taskSheetAiAggregator';
import { indiaToday } from '@/lib/indiaDate';
import { isTeamUser } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await requireAuth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only internal team members (owner, admin, manager, employee/developer) can access team pulse
    if (!isTeamUser(session.user)) {
      return NextResponse.json(
        { error: 'Forbidden: Access to AI Team Pulse is restricted to internal team users.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const targetDate = extractIstDate(dateParam) || indiaToday();

    // 1. Fetch factual metrics from database
    const metrics = await aggregateTaskSheetPulseMetrics({
      anchorDate: targetDate,
      lookbackDays: 3,
    });

    // 2. Fetch cached summary if present
    const cachedResult = await getCachedTaskSheetAiSummary({
      anchorDate: targetDate,
      lookbackDays: 3,
    });

    return NextResponse.json({
      cached: cachedResult.exists,
      summary: cachedResult.summary,
      metrics,
      comparisonDays: metrics.comparisonDays,
      targetDate: metrics.targetDate,
      targetDateFormatted: metrics.targetDateFormatted,
    });
  } catch (err) {
    console.error('Error in GET /api/task-sheet/ai-summary:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to retrieve AI Team Pulse summary.' },
      { status: 500 }
    );
  }
}
