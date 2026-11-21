import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isAdminOrOwner } from '@/lib/rbac';
import { retryFailedDeliveries } from '@/lib/weeklyEmailService';

export async function POST(request, { params }) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const user = session.user;
    if (!isAdminOrOwner(user)) {
      return NextResponse.json(
        { error: 'Forbidden: Only Owner and Admin roles may retry failed deliveries' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const runId = parseInt(id, 10);
    if (!runId || Number.isNaN(runId)) {
      return NextResponse.json({ error: 'Invalid run ID' }, { status: 400 });
    }

    const result = await retryFailedDeliveries(runId);

    return NextResponse.json({
      success: true,
      runId,
      ...result,
    });
  } catch (err) {
    console.error('[api/weekly-reports/retry] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to retry deliveries' },
      { status: 500 }
    );
  }
}
