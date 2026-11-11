import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getAdminDashboardSummary } from '@/lib/analytics';
import { isAdminOrOwner } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session || !isAdminOrOwner(session.user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const preset = searchParams.get('preset') || 'this_month';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  const projectId = searchParams.get('projectId') || 'all';

  const summary = await getAdminDashboardSummary({ preset, startDate, endDate, projectId });
  return NextResponse.json(summary);
}

