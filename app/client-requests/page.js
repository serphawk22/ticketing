import { redirect } from 'next/navigation';
import requireTeamUser from '@/lib/requireTeamUser';
import { getClientRequestQueue, getAllTickets } from '@/lib/tickets';
import { getAllProjects } from '@/lib/projects';
import { getEmployees } from '@/lib/employees';
import ClientRequestsView from '@/components/ClientRequestsView';

export const dynamic = 'force-dynamic';

/**
 * The client request queue as a full page.
 *
 * The sidebar carries the same list for routing at a glance; this is where an
 * admin opens one, reads it, and decides who should own it. Admin only, because
 * routing other people's requests is not something a developer or a client does.
 */
export default async function ClientRequestsPage() {
  const session = await requireTeamUser();
  if (session.user.role !== 'admin') redirect('/');

  const [requests, employees, projects, tickets] = await Promise.all([
    getClientRequestQueue(),
    getEmployees({ includeInactive: false }),
    getAllProjects(),
    getAllTickets(),
  ]);

  const projectCounts = {};
  for (const t of tickets) {
    if (t.project_id == null) continue;
    projectCounts[t.project_id] = (projectCounts[t.project_id] || 0) + 1;
  }

  const userId = session.user.id;
  const myIssuesCount = tickets.filter(
    (t) => t.created_by === userId || t.assigned_to === userId
  ).length;

  return (
    <ClientRequestsView
      currentUser={session.user}
      requests={requests}
      assignable={employees.filter((e) => e.role !== 'client')}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
    />
  );
}