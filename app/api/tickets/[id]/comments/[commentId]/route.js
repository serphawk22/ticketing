import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { getComments } from '@/lib/ticketDetail';

async function load(request, { params }) {
  const session = await requireAuth();
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const { id, commentId } = await params;
  const ticketId = Number(id);
  if (!await getTicket(ticketId)) {
    return { error: NextResponse.json({ error: 'Ticket not found.' }, { status: 404 }) };
  }

  const comment = await db
    .prepare('SELECT * FROM ticket_comments WHERE id = ? AND ticket_id = ?')
    .get(Number(commentId), ticketId);
  if (!comment) {
    return { error: NextResponse.json({ error: 'Comment not found.' }, { status: 404 }) };
  }

  return { session, ticketId, comment };
}

export async function PATCH(request, { params }) {
  const ctx = await load(request, { params });
  if (ctx.error) return ctx.error;
  const { session, ticketId, comment } = ctx;

  if (comment.author_id !== session.user.id && session.user.role !== 'admin') {
    return NextResponse.json({ error: 'You can only edit your own comments.' }, { status: 403 });
  }

  const { body } = await request.json();
  const text = String(body ?? '').trim();
  if (!text) {
    return NextResponse.json({ error: 'Comment cannot be empty.' }, { status: 400 });
  }

  await db
    .prepare("UPDATE ticket_comments SET body = ?, updated_at = datetime('now') WHERE id = ?")
    .run(text, comment.id);

  return NextResponse.json({ comments: await getComments(ticketId) });
}

export async function DELETE(request, { params }) {
  const ctx = await load(request, { params });
  if (ctx.error) return ctx.error;
  const { session, ticketId, comment } = ctx;

  if (comment.author_id !== session.user.id && session.user.role !== 'admin') {
    return NextResponse.json({ error: 'You can only delete your own comments.' }, { status: 403 });
  }

  await db.prepare('DELETE FROM ticket_comments WHERE id = ?').run(comment.id);

  return NextResponse.json({ comments: await getComments(ticketId) });
}
