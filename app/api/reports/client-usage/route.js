import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getClientBoxUsageData } from '@/lib/clientUsageReport';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const days = searchParams.get('days');
  const workspaceId = searchParams.get('workspace_id');

  // Enforce tenant boundary:
  // If the user is a client account, scope strictly to tickets raised by this client.
  const clientUserId = session.user.role === 'client' ? session.user.id : null;

  try {
    const data = await getClientBoxUsageData({
      days: days && days !== 'all' ? Number(days) : null,
      workspaceId: workspaceId && workspaceId !== 'all' ? Number(workspaceId) : null,
      clientUserId,
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error('Failed to compute client box usage report:', err);
    return NextResponse.json(
      { error: 'Failed to compute client box usage report.' },
      { status: 500 }
    );
  }
}

