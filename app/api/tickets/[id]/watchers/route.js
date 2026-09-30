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

  // A body naming a user adds them as a watcher on somebody else's behalf,
  // which is what the "add watcher" picker does. With no body the signed-in
  // user is added, which is what the eye button does.
  const body = await request.json().catch(() => ({}));
  const requestedId = body.user_id == null ? session.user.id : Number(body.user_id);
  if (!Number.isInteger(requestedId)) {
    return NextResponse.json({ error: 'Invalid user.' }, { status: 400 });
  }
  if (requestedId !== session.user.id && session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can add watchers for other people.' },
      { status: 403 }
    );
  }

  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(requestedId);
  if (!user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  const existing = await db
    .prepare('SELECT id FROM ticket_watchers WHERE ticket_id = ? AND user_id = ?')
    .get(ticketId, requestedId);
  if (existing) {
    return NextResponse.json({ error: 'That person is already watching this issue.' }, { status: 409 });
  }

  await db
    .prepare('INSERT INTO ticket_watchers (ticket_id, user_id) VALUES (?, ?)')
    .run(ticketId, requestedId);

  const watchers = await getWatchers(ticketId);
  return NextResponse.json(
    {
      watchers,
      watching: watchers.some((w) => w.user_id === session.user.id),
    },
    { status: 201 }
  );
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);

  // Same rule as adding: anyone may stop watching, admins may remove anybody.
  const userId = Number(new URL(request.url).searchParams.get('user'));
  const targetId = Number.isInteger(userId) ? userId : session.user.id;
  if (targetId !== session.user.id && session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can remove other watchers.' },
      { status: 403 }
    );
  }

  await db
    .prepare('DELETE FROM ticket_watchers WHERE ticket_id = ? AND user_id = ?')
    .run(ticketId, targetId);

  const watchers = await getWatchers(ticketId);
  return NextResponse.json({
    watchers,
    watching: watchers.some((w) => w.user_id === session.user.id),
  });
}
