import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getWorkforceAttendanceForDate } from '@/lib/attendance';
import { toKolkata } from '@/lib/businessHours';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized: Admin access required.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const todayStr = toKolkata(new Date()).toISOString().slice(0, 10);
  const workDate = searchParams.get('date') || todayStr;
  const department = searchParams.get('department') || 'all';
  const search = searchParams.get('search') || '';

  const data = await getWorkforceAttendanceForDate({
    workDate,
    department,
    search,
  });

  return NextResponse.json(data);
}

