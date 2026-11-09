import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getDesignation,
  updateDesignation,
  deleteDesignation,
} from '@/lib/departments';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role === 'client') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const desig = await getDesignation(id);
  if (!desig) {
    return NextResponse.json({ error: 'Designation not found' }, { status: 404 });
  }

  return NextResponse.json({ designation: desig });
}

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can modify designations.' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const body = await request.json();
    const updated = await updateDesignation(id, body, session.user);
    return NextResponse.json({ designation: updated });
  } catch (err) {
    console.error('[API /api/designations/[id]] PATCH error:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can delete designations.' }, { status: 403 });
  }

  const { id } = await params;
  try {
    await deleteDesignation(id, session.user);
    return NextResponse.json({ success: true, message: 'Designation deleted successfully.' });
  } catch (err) {
    console.error('[API /api/designations/[id]] DELETE error:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

