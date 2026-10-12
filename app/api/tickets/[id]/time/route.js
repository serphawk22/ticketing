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
  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  // Clients can only access tickets they raised
  if (session.user.role === 'client' && ticket.created_by !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const timeLogs = await getTimeLogs(ticketId);
  const loggedSeconds = await getLoggedSeconds(ticketId);

  return NextResponse.json({
    timeLogs,
    loggedSeconds,
    totalMinutes: Math.round(loggedSeconds / 60),
  });
}

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Clients are external requesters and cannot record work time
  if (session.user.role === 'client') {
    return NextResponse.json({ error: 'Clients are not permitted to log time.' }, { status: 403 });
  }

  const { id } = await params;
  const ticketId = Number(id);
  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const { seconds, duration_minutes, minutes, note, work_date } = body;

  let valueInSeconds = 0;
  if (duration_minutes !== undefined && duration_minutes !== null) {
    valueInSeconds = Math.round(Number(duration_minutes) * 60);
  } else if (minutes !== undefined && minutes !== null) {
    valueInSeconds = Math.round(Number(minutes) * 60);
  } else if (seconds !== undefined && seconds !== null) {
    valueInSeconds = Math.round(Number(seconds));
  } else {
    return NextResponse.json({ error: 'Enter a valid work duration.' }, { status: 400 });
  }

  if (!Number.isFinite(valueInSeconds) || valueInSeconds <= 0) {
    return NextResponse.json({ error: 'Enter a duration greater than zero.' }, { status: 400 });
  }

  if (valueInSeconds > 24 * 60 * 60) {
    return NextResponse.json({ error: 'Duration cannot exceed 24 hours per work session.' }, { status: 400 });
  }

  let cleanWorkDate = new Date().toISOString().slice(0, 10);
  if (work_date) {
    const trimmed = String(work_date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return NextResponse.json({ error: 'Invalid work date format. Expected YYYY-MM-DD.' }, { status: 400 });
    }
    const parsedDate = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: 'Invalid work date value.' }, { status: 400 });
    }
    cleanWorkDate = trimmed;
  }

  const cleanNote = String(note ?? '').trim();
  const durationMinutes = Math.round(valueInSeconds / 60);

  // Prevent accidental rapid duplicate submissions (within 5 seconds for the exact same ticket, user, time, and note)
  const recent = await db
    .prepare(
      `SELECT id, created_at FROM ticket_time_logs
       WHERE ticket_id = ? AND user_id = ? AND seconds = ? AND note = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(ticketId, session.user.id, valueInSeconds, cleanNote);

  if (recent && recent.created_at) {
    const raw = String(recent.created_at).trim();
    const iso = raw.endsWith('Z') || raw.includes('+') ? raw : raw.replace(' ', 'T') + 'Z';
    const createdAtMs = new Date(iso).getTime();
    const elapsedMs = Math.abs(Date.now() - createdAtMs);
    if (elapsedMs < 5000) {
      const timeLogs = await getTimeLogs(ticketId);
      const loggedSeconds = await getLoggedSeconds(ticketId);
      return NextResponse.json(
        {
          duplicatePrevented: true,
          timeLogs,
          loggedSeconds,
          totalMinutes: Math.round(loggedSeconds / 60),
        },
        { status: 200 }
      );
    }
  }

  await db
    .prepare(
      'INSERT INTO ticket_time_logs (ticket_id, user_id, seconds, duration_minutes, note, work_date) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(ticketId, session.user.id, valueInSeconds, durationMinutes, cleanNote, cleanWorkDate);

  const timeLogs = await getTimeLogs(ticketId);
  const loggedSeconds = await getLoggedSeconds(ticketId);

  return NextResponse.json(
    {
      timeLogs,
      loggedSeconds,
      totalMinutes: Math.round(loggedSeconds / 60),
    },
    { status: 201 }
  );
}
