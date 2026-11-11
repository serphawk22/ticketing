import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getTicketDetail } from '@/lib/ticketDetail';
import { assertCanAccessTicket } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const detail = await getTicketDetail(id);
  if (!detail) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const access = await assertCanAccessTicket(session.user, detail.ticket);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  return NextResponse.json(detail);
}
