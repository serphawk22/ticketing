import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { generateAndCacheAiSummary, canUserAccessScope, canUserGenerateSummary } from '@/lib/aiSummaryService';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const session = await requireAuth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!canUserGenerateSummary(session.user)) {
      return NextResponse.json(
        { error: 'Forbidden: Your role does not permit generating AI progress summaries.' },
        { status: 403 }
      );
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const projectId = body.projectId || 'all';
    const scopeType = !projectId || projectId === 'all' ? 'overall' : 'project';

    const isAuthorized = await canUserAccessScope(session.user, scopeType, projectId);
    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have access to this project.' },
        { status: 403 }
      );
    }

    const summary = await generateAndCacheAiSummary({
      projectId,
      user: session.user,
    });

    return NextResponse.json({ success: true, summary });
  } catch (err) {
    console.error('Error generating AI progress summary:', err);

    const isKeyError =
      err.message && (err.message.includes('OPENAI_API_KEY') || err.message.includes('GEMINI_API_KEY'));
    const isForbidden = err.message && err.message.startsWith('Forbidden');

    const status = isForbidden ? 403 : isKeyError ? 400 : 500;
    return NextResponse.json(
      { error: err.message || 'Failed to generate AI progress summary.' },
      { status }
    );
  }
}
