import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { getComments } from '@/lib/ticketDetail';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!await getTicket(id)) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  return NextResponse.json({ comments: await getComments(id) });
}

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  if (!await getTicket(ticketId)) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const { body } = await request.json();
  const text = String(body ?? '').trim();
  if (!text) {
    return NextResponse.json({ error: 'Comment cannot be empty.' }, { status: 400 });
  }
  if (text.length > 5000) {
    return NextResponse.json({ error: 'Comment is too long.' }, { status: 400 });
  }

  const result = await db
    .prepare(
      `INSERT INTO ticket_comments (ticket_id, author_id, body)
       VALUES (?, ?, ?)
       RETURNING id`
    )
    .run(ticketId, session.user.id, text);

  return NextResponse.json(
    { comments: await getComments(ticketId) },
    { status: 201 }
  );
}
