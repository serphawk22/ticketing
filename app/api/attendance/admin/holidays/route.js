import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCompanyHolidays, addCompanyHoliday, deleteCompanyHoliday } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId');

  const holidays = await getCompanyHolidays({ workspaceId: workspaceId ? Number(workspaceId) : null });
  return NextResponse.json({ holidays });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized: Admin access required.' }, { status: 403 });
  }

  try {
    const { holidayDate, name, isRecurring = 0, fallsOnSunday = 0, workspaceId = null } = await request.json();
    if (!holidayDate || !name) {
      return NextResponse.json({ error: 'Holiday date and name are required.' }, { status: 400 });
    }

    const holidays = await addCompanyHoliday({
      holidayDate,
      name,
      isRecurring,
      fallsOnSunday,
      workspaceId: workspaceId ? Number(workspaceId) : null,
      adminUser: session.user,
    });

    return NextResponse.json({ ok: true, holidays });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to save holiday.' }, { status: 400 });
  }
}

export async function DELETE(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized: Admin access required.' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const workspaceId = searchParams.get('workspaceId');

    if (!id) {
      return NextResponse.json({ error: 'Holiday ID is required.' }, { status: 400 });
    }

    const holidays = await deleteCompanyHoliday({
      id: Number(id),
      workspaceId: workspaceId ? Number(workspaceId) : null,
      adminUser: session.user,
    });

    return NextResponse.json({ ok: true, holidays });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to delete holiday.' }, { status: 400 });
  }
}
