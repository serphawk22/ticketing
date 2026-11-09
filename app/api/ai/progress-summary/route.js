import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCachedAiSummary, canUserAccessScope } from '@/lib/aiSummaryService';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await requireAuth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId') || 'all';
    const scopeType = !projectId || projectId === 'all' ? 'overall' : 'project';

    // Verify project/scope authorization
    const isAuthorized = await canUserAccessScope(session.user, scopeType, projectId);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden: You do not have access to this project.' }, { status: 403 });
    }

    const result = await getCachedAiSummary(projectId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Error fetching cached AI progress summary:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to retrieve AI summary.' },
      { status: 500 }
    );
  }
}
