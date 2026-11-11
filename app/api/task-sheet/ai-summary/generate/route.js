import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { generateAndCacheTaskSheetAiPulse } from '@/lib/taskSheetAi';
import { extractIstDate } from '@/lib/taskSheetAiAggregator';
import { indiaToday } from '@/lib/indiaDate';
import { isTeamUser } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const session = await requireAuth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Role guard: Only internal team members can trigger generation
    if (!isTeamUser(session.user)) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have permission to generate AI Team Pulse summaries.' },
        { status: 403 }
      );
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const targetDate = extractIstDate(body.date) || indiaToday();

    const result = await generateAndCacheTaskSheetAiPulse({
      anchorDate: targetDate,
      lookbackDays: 3,
      user: session.user,
    });

    return NextResponse.json({
      success: true,
      summary: result,
      targetDate,
    });
  } catch (err) {
    console.error('Error in POST /api/task-sheet/ai-summary/generate:', err);

    const isKeyError =
      err.message && (err.message.includes('OPENAI_API_KEY') || err.message.includes('GEMINI_API_KEY'));
    const isTimeout = err.message && err.message.includes('timed out');
    const status = isKeyError ? 400 : isTimeout ? 504 : 500;

    return NextResponse.json(
      { error: err.message || 'Failed to generate AI Team Pulse summary.' },
      { status }
    );
  }
}
