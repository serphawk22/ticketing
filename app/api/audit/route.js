import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getAuditLogs } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') || 100;
  const entityType = searchParams.get('entityType') || null;
  const entityId = searchParams.get('entityId') || null;
  const action = searchParams.get('action') || null;

  const logs = await getAuditLogs({ limit, entityType, entityId, action });
  return NextResponse.json({ logs });
}

