import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createDailyNote, listDailyNotes } from '@/lib/dailyNotes';
import { todayKolkataDate } from '@/lib/workLedger';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');
  const from = searchParams.get('from') || dateParam || null;
  const to = searchParams.get('to') || dateParam || null;
  const employeeId = searchParams.get('employeeId');

  try {
    const notes = await listDailyNotes({
      user: session.user,
      from: from || todayKolkataDate(),
      to: to || todayKolkataDate(),
      employeeId,
    });
    return NextResponse.json({ notes });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to load daily updates.' },
      { status: err.statusCode || 500 }
    );
  }
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const note = await createDailyNote({
      user: session.user,
      body: body.body,
      category: body.category || 'general',
      workDate: body.workDate || null,
      ticketId: body.ticketId ?? null,
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to save daily update.' },
      { status: err.statusCode || 500 }
    );
  }
}
