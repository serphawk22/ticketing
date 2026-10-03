import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getAllTickets, getTicketsRaisedBy } from '@/lib/tickets';
import { getAllProjects } from '@/lib/projects';
import RaiseTicketView from '@/components/RaiseTicketView';

export const dynamic = 'force-dynamic';

export default async function RaiseTicketPage() {
  const session = await requireAuth();
  if (!session) redirect('/login');

  const userId = session.user.id;

  // The sidebar needs the project list, and the panel needs this person's own
  // requests. Both are read once here and kept in the client afterwards.
  const [projects, raised] = await Promise.all([
    getAllProjects(),
    getTicketsRaisedBy(userId, 8),
  ]);

  // Reuse the same definition of "mine" the rest of the app counts with, so
  // the sidebar count does not jump around between pages.
  const tickets = await getAllTickets();
  const myIssuesCount = tickets.filter(
    (t) =>
      t.created_by === userId ||
      t.assigned_to === userId ||
      t.employee_id === session.user.employee_id
  ).length;

  return (
    <RaiseTicketView
      initialRaised={raised}
      currentUser={session.user}
      myIssuesCount={myIssuesCount}
      projects={projects}
    />
  );
}