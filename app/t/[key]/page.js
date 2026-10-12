import { redirect, notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { ticketKey } from '@/lib/ticketMeta';

export const dynamic = 'force-dynamic';

/**
 * Landing page for the "View Ticket" links in notification email.
 *
 * The link cannot carry the recipient's identity, so it only carries the ticket
 * key. This page turns that key into the board URL for whoever is signed in,
 * sending a signed-out visitor through the login screen first and returning
 * them here afterwards. The key is re-checked against the row it resolves to,
 * so a hand-edited /t/<key> cannot silently point at a different ticket.
 */
export default async function TicketRedirect({ params }) {
  const { key } = await params;
  const here = `/t/${encodeURIComponent(key)}`;

  const session = await requireAuth();
  if (!session) redirect(`/login?next=${encodeURIComponent(here)}`);

  // A forced password change comes first, so the ticket cannot be used to skip
  // it. The destination rides along and is honoured once the password is set.
  if (session.user.must_change_password) {
    redirect(`/change-password?next=${encodeURIComponent(here)}`);
  }
  // Clients have their own portal and are never shown team work items.
  if (session.user.role === 'client') redirect('/client');

  const id = Number(String(key).split('-').pop());
  const ticket = Number.isInteger(id) && id > 0 ? await getTicket(id) : null;
  if (!ticket || ticketKey(ticket).toLowerCase() !== String(key).toLowerCase()) {
    notFound();
  }

  const selected = encodeURIComponent(ticketKey(ticket));
  redirect(
    ticket.project_id
      ? `/projects/${ticket.project_id}/list?selectedIssue=${selected}`
      : `/work-items?selectedIssue=${selected}`
  );
}
