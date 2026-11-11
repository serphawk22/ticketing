import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { ticketKey } from '@/lib/ticketMeta';
import { parseTicketKey } from '@/lib/ticketRefs';
import { assertCanAccessTicket } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

function sanitizeTicketForClient(ticket) {
  return {
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    type: ticket.type,
    project_id: ticket.project_id,
    project_name: ticket.project_name,
    project_key: ticket.project_key,
    project_color: ticket.project_color,
    employee_id: ticket.employee_id,
    employee_name: ticket.employee_name,
    created_by: ticket.created_by,
    created_by_name: ticket.created_by_name,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    archived: ticket.archived,
  };
}

export async function GET(_request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { key } = await params;
  const parsed = parseTicketKey(decodeURIComponent(String(key || '')));
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid ticket key.' }, { status: 400 });
  }

  const ticket = await getTicket(parsed.id);
  if (!ticket || ticketKey(ticket).toUpperCase() !== parsed.key) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const access = await assertCanAccessTicket(session.user, ticket);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Clients may only view active (unarchived) requests they raised themselves.
  if (access.scope?.isClient && Number(ticket.archived) === 1) {
    return NextResponse.json(
      { error: 'Forbidden: ticket is outside your client scope.' },
      { status: 403 }
    );
  }

  return NextResponse.json({
    ticket: access.scope?.isClient ? sanitizeTicketForClient(ticket) : ticket,
  });
}
