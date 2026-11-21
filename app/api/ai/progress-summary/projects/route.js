import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getManagementProjectSummaries } from '@/lib/aiSummaryService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireAuth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await getManagementProjectSummaries(session.user);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to load project summaries.' },
      { status: err.statusCode || 500 }
    );
  }
}
