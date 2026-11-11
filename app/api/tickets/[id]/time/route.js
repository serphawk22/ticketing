import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { getLoggedSeconds, getTimeLogs } from '@/lib/ticketDetail';
import { logAuditEvent } from '@/lib/audit';
import { assertCanAccessTicket, isTeamUser } from '@/lib/rbac';
import { todayKolkataDate } from '@/lib/workLedger';

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

  const access = await assertCanAccessTicket(session.user, ticket);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
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
  if (!isTeamUser(session.user)) {
    return NextResponse.json({ error: 'Clients are not permitted to log time.' }, { status: 403 });
  }

  const { id } = await params;
  const ticketId = Number(id);
  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const access = await assertCanAccessTicket(session.user, ticket);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body = await request.json().catch(() => ({}));
  const { seconds, duration_minutes, minutes, note, work_date, categoryCode, category_code } = body;

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

  let cleanWorkDate = todayKolkataDate();
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

  const cleanCategory = String(categoryCode || category_code || 'development').trim().toLowerCase() || 'development';

  await db.transaction(async (tx) => {
    const ttlRes = await tx
      .prepare(
        'INSERT INTO ticket_time_logs (ticket_id, user_id, seconds, duration_minutes, note, work_date) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(ticketId, session.user.id, valueInSeconds, durationMinutes, cleanNote, cleanWorkDate);

    // Mirror manual ticket time log into the canonical employee_work_logs ledger
    const empRow = await tx
      .prepare('SELECT id FROM employees WHERE user_id = ?')
      .get(Number(session.user.id));

    if (empRow?.id && durationMinutes > 0) {
      const catRow = await tx
        .prepare('SELECT code FROM work_categories WHERE code = ? AND is_active = 1')
        .get(cleanCategory);
      const validCat = catRow ? catRow.code : 'development';

      await tx
        .prepare(
          `INSERT INTO employee_work_logs (
            employee_id, user_id, work_date, entry_type, entry_kind,
            project_id, ticket_id, category_code, duration_minutes,
            work_description, source_type, source_id, source_item_index
          ) VALUES (?, ?, ?, 'ticket_work', 'initial', ?, ?, ?, ?, ?, 'ticket_time_log', ?, 0)`
        )
        .run(
          Number(empRow.id),
          Number(session.user.id),
          cleanWorkDate,
          ticket.project_id || null,
          ticketId,
          validCat,
          durationMinutes,
          cleanNote || `Manual ticket time log (#${ticketId})`,
          Number(ttlRes.lastInsertRowid)
        );
    }
  });

  await logAuditEvent({
    actorId: session.user.id,
    actorName: session.user.name,
    action: 'log_time',
    entityType: 'ticket',
    entityId: ticketId,
    details: {
      ticketId,
      durationMinutes,
      workDate: cleanWorkDate,
      note: cleanNote,
    },
  });

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
