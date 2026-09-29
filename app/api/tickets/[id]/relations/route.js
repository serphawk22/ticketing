import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { getRelations } from '@/lib/ticketDetail';
import { RELATION_ORDER, CHILD_RELATION } from '@/lib/ticketMeta';

const VALID_TYPES = [...RELATION_ORDER, CHILD_RELATION, 'child_of'];

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!await getTicket(id)) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  return NextResponse.json({ relations: await getRelations(id) });
}

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  if (!await getTicket(ticketId)) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const { related_ticket_id, relation_type } = await request.json();
  const relatedId = Number(related_ticket_id);
  const type = String(relation_type || 'relates_to');

  if (!Number.isInteger(relatedId) || !await getTicket(relatedId)) {
    return NextResponse.json({ error: 'Related ticket not found.' }, { status: 404 });
  }
  if (relatedId === ticketId) {
    return NextResponse.json({ error: 'A ticket cannot link to itself.' }, { status: 400 });
  }
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid relationship type.' }, { status: 400 });
  }

  const existing = await db
    .prepare(
      'SELECT id FROM ticket_relations WHERE ticket_id = ? AND related_ticket_id = ? AND relation_type = ?'
    )
    .get(ticketId, relatedId, type);
  if (existing) {
    return NextResponse.json({ error: 'That link already exists.' }, { status: 409 });
  }

  // Parenting is a hierarchy, so refuse the two links that would make it a
  // cycle: the other ticket already claims this one as its child.
  if (type === CHILD_RELATION) {
    const reverse = await db
      .prepare(
        "SELECT id FROM ticket_relations WHERE ticket_id = ? AND related_ticket_id = ? AND relation_type = 'child_of'"
      )
      .get(relatedId, ticketId);
    if (reverse) {
      return NextResponse.json(
        { error: 'That would make the two tickets each other parent and child.' },
        { status: 409 }
      );
    }
  }

  await db
    .prepare(
      'INSERT INTO ticket_relations (ticket_id, related_ticket_id, relation_type) VALUES (?, ?, ?)'
    )
    .run(ticketId, relatedId, type);

  return NextResponse.json({ relations: await getRelations(ticketId) }, { status: 201 });
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  const relationId = Number(new URL(request.url).searchParams.get('relation'));
  if (!Number.isInteger(relationId)) {
    return NextResponse.json({ error: 'Invalid link.' }, { status: 400 });
  }

  const result = await db
    .prepare('DELETE FROM ticket_relations WHERE id = ? AND ticket_id = ?')
    .run(relationId, ticketId);

  if (!result.changes) {
    return NextResponse.json({ error: 'Link not found.' }, { status: 404 });
  }

  return NextResponse.json({ relations: await getRelations(ticketId) });
}
