import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getTicketsForClient } from '@/lib/tickets';
import { getComments } from '@/lib/ticketDetail';
import ClientPortalView from '@/components/ClientPortalView';

export const dynamic = 'force-dynamic';

/**
 * The client portal.
 *
 * A client account has no place in the team app: it cannot see the board, the
 * directory or other people's work. Everything it needs is its own requests, so
 * this page reads exactly those and nothing else. Comment threads are loaded up
 * front because the portal shows the conversation inline rather than behind a
 * click into the full ticket view.
 */
export default async function ClientPortalPage() {
  const session = await requireAuth();
  if (!session) redirect('/client/login');

  // Anyone else who lands here belongs in the team app.
  if (session.user.role !== 'client') {
    redirect(session.user.must_change_password ? '/change-password' : '/');
  }

  const tickets = await getTicketsForClient(session.user.id);

  const comments = {};
  for (const ticket of tickets) {
    comments[ticket.id] = await getComments(ticket.id);
  }

  return (
    <ClientPortalView
      currentUser={session.user}
      tickets={tickets}
      comments={comments}
    />
  );
}