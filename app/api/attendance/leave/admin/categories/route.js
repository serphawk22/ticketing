import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  saveOrganizationLeaveCategory,
  deleteOrganizationLeaveCategory,
  getOrganizationLeavePolicy,
} from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: Only authorized administrators can configure leave categories.' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const result = await saveOrganizationLeaveCategory({
      ...body,
      adminUser: session.user,
    });
    return NextResponse.json({ ok: true, category: result });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to save leave category.' },
      { status: 400 }
    );
  }
}

export async function PUT(request) {
  return POST(request);
}

export async function DELETE(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: Only authorized administrators can delete leave categories.' },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    const code = searchParams.get('code');

    if (!code) {
      return NextResponse.json({ error: 'Category code is required.' }, { status: 400 });
    }

    const result = await deleteOrganizationLeaveCategory({
      workspaceId: workspaceId ? Number(workspaceId) : null,
      code,
      adminUser: session.user,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to delete leave category.' },
      { status: 400 }
    );
  }
}
