import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { status } = await request.json();

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(id));
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  if (session.user.role !== 'developer') {
    return NextResponse.json(
      { error: 'Only developers can update ticket status.' },
      { status: 403 }
    );
  }

  const info = db
    .prepare(
      `UPDATE tickets
       SET status = ?, assigned_to = COALESCE(assigned_to, ?), updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(status, session.user.id, Number(id));

  if (info.changes === 0) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(id));
  return NextResponse.json({ ticket: updated });
}