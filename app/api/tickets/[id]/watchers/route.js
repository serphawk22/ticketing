import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { getWatchers } from '@/lib/ticketDetail';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  if (!await getTicket(ticketId)) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const watchers = await getWatchers(ticketId);
  return NextResponse.json({
    watchers,
    watching: watchers.some((w) => w.user_id === session.user.id),
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

  const existing = await db
    .prepare('SELECT id FROM ticket_watchers WHERE ticket_id = ? AND user_id = ?')
    .get(ticketId, session.user.id);
  if (existing) {
    return NextResponse.json({ error: 'You are already watching this issue.' }, { status: 409 });
  }

  await db
    .prepare('INSERT INTO ticket_watchers (ticket_id, user_id) VALUES (?, ?)')
    .run(ticketId, session.user.id);

  return NextResponse.json(
    { watchers: await getWatchers(ticketId), watching: true },
    { status: 201 }
  );
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);

  await db
    .prepare('DELETE FROM ticket_watchers WHERE ticket_id = ? AND user_id = ?')
    .run(ticketId, session.user.id);

  return NextResponse.json({ watchers: await getWatchers(ticketId), watching: false });
}
