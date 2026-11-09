import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getAssets, createAsset } from '@/lib/assets';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || null;
  const category = searchParams.get('category') || null;
  const search = searchParams.get('search') || null;

  try {
    const assets = await getAssets({
      workspaceId: session.user.workspace_id,
      status,
      category,
      search,
    });
    return NextResponse.json({ assets });
  } catch (err) {
    console.error('[api/assets] GET error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch assets.' }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can add assets.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { asset_tag, name, category, serial_number, condition, status, purchase_date, notes } = body;

    if (!asset_tag || !asset_tag.trim()) {
      return NextResponse.json({ error: 'Asset tag is required.' }, { status: 400 });
    }
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Asset name is required.' }, { status: 400 });
    }

    const asset = await createAsset({
      workspaceId: session.user.workspace_id,
      assetTag: asset_tag,
      name,
      category: category || 'Laptop',
      serialNumber: serial_number || '',
      condition: condition || 'new',
      status: status || 'available',
      purchaseDate: purchase_date || null,
      notes: notes || '',
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    console.error('[api/assets] POST error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to create asset.' }, { status: 400 });
  }
}

