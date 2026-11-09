import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { returnAsset } from '@/lib/assets';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can process asset returns.' }, { status: 403 });
  }

  const { id } = await params;
  const assetId = Number(id);

  try {
    const body = await request.json();
    const { returned_at, condition, notes } = body;

    const asset = await returnAsset({
      workspaceId: session.user.workspace_id,
      assetId,
      returnedAt: returned_at || null,
      condition: condition || null,
      notes: notes || '',
      returnedTo: session.user.id,
    });

    return NextResponse.json({ asset });
  } catch (err) {
    console.error('[api/assets/[id]/return] POST error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to return asset.' }, { status: 400 });
  }
}

