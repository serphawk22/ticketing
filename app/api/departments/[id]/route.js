import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartmentEmployees,
} from '@/lib/departments';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role === 'client') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const dept = await getDepartment(id);
  if (!dept) {
    return NextResponse.json({ error: 'Department not found' }, { status: 404 });
  }

  const employees = await getDepartmentEmployees(id);
  return NextResponse.json({ department: dept, employees });
}

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can modify departments.' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const body = await request.json();
    const updated = await updateDepartment(id, body, session.user);
    return NextResponse.json({ department: updated });
  } catch (err) {
    console.error('[API /api/departments/[id]] PATCH error:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can delete departments.' }, { status: 403 });
  }

  const { id } = await params;
  try {
    await deleteDepartment(id, session.user);
    return NextResponse.json({ success: true, message: 'Department deleted successfully.' });
  } catch (err) {
    console.error('[API /api/departments/[id]] DELETE error:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

