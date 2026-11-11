import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCanAccessTicket } from '@/lib/rbac';
import { getTicketTimeAudit } from '@/lib/ticketStageService';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  const access = await assertCanAccessTicket(session.user, ticketId);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const audit = await getTicketTimeAudit(ticketId);
  if (!audit) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  return NextResponse.json(audit);
}
