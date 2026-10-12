import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import ClientRaiseTicketView from '@/components/ClientRaiseTicketView';

export const dynamic = 'force-dynamic';

/**
 * Raise a request, as its own route.
 *
 * Triage is the team's job, so the client form asks for nothing but the request
 * itself. Once sent it lands in the admin queue and shows up back on the client
 * list with a status and, eventually, an owner.
 */
export default async function ClientRaiseTicketPage() {
  const session = await requireAuth();
  if (!session) redirect('/client/login');

  // Anyone else who lands here belongs in the team app.
  if (session.user.role !== 'client') {
    redirect(session.user.must_change_password ? '/change-password' : '/');
  }

  return <ClientRaiseTicketView currentUser={session.user} />;
}
