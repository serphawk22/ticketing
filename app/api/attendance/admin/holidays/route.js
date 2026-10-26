import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getCompanyHolidays } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const holidays = await getCompanyHolidays();
  return NextResponse.json({ holidays });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized: Admin access required.' }, { status: 403 });
  }

  try {
    const { holidayDate, name, isRecurring = 0, fallsOnSunday = 0 } = await request.json();
    if (!holidayDate || !name) {
      return NextResponse.json({ error: 'Holiday date and name are required.' }, { status: 400 });
    }

    await db
      .prepare(
        `INSERT INTO company_holidays (holiday_date, name, is_recurring, falls_on_sunday)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (holiday_date) DO UPDATE SET name = excluded.name, is_recurring = excluded.is_recurring, falls_on_sunday = excluded.falls_on_sunday`
      )
      .run(holidayDate.trim(), name.trim(), isRecurring ? 1 : 0, fallsOnSunday ? 1 : 0);

    const holidays = await getCompanyHolidays();
    return NextResponse.json({ ok: true, holidays });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to save holiday.' }, { status: 400 });
  }
}

