import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { getLoggedSeconds, getTimeLogs } from '@/lib/ticketDetail';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  if (!await getTicket(ticketId)) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  return NextResponse.json({
    timeLogs: await getTimeLogs(ticketId),
    loggedSeconds: await getLoggedSeconds(ticketId),
  });
}

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  if (!await getTicket(ticketId)) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const { seconds, note } = await request.json();
  const value = Math.round(Number(seconds));
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: 'Enter a time greater than zero.' }, { status: 400 });
  }
  if (value > 24 * 60 * 60) {
    return NextResponse.json({ error: 'That is more than a day.' }, { status: 400 });
  }

  await db
    .prepare('INSERT INTO ticket_time_logs (ticket_id, user_id, seconds, note) VALUES (?, ?, ?, ?)')
    .run(ticketId, session.user.id, value, String(note ?? '').trim());

  return NextResponse.json(
    {
      timeLogs: await getTimeLogs(ticketId),
      loggedSeconds: await getLoggedSeconds(ticketId),
    },
    { status: 201 }
  );
}
