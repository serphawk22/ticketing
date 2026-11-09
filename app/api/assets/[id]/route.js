import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getAsset, updateAsset, deleteAsset } from '@/lib/assets';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const assetId = Number(id);

  try {
    const asset = await getAsset(assetId, session.user.workspace_id);
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
    }
    return NextResponse.json({ asset });
  } catch (err) {
    console.error('[api/assets/[id]] GET error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch asset.' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can update assets.' }, { status: 403 });
  }

  const { id } = await params;
  const assetId = Number(id);

  try {
    const body = await request.json();
    const { asset_tag, name, category, serial_number, condition, status, purchase_date, notes } = body;

    const updated = await updateAsset(assetId, {
      workspaceId: session.user.workspace_id,
      assetTag: asset_tag,
      name,
      category,
      serialNumber: serial_number,
      condition,
      status,
      purchaseDate: purchase_date,
      notes,
    });

    return NextResponse.json({ asset: updated });
  } catch (err) {
    console.error('[api/assets/[id]] PATCH error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to update asset.' }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can delete assets.' }, { status: 403 });
  }

  const { id } = await params;
  const assetId = Number(id);

  try {
    await deleteAsset(assetId, session.user.workspace_id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/assets/[id]] DELETE error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to delete asset.' }, { status: 400 });
  }
}

