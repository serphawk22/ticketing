import requireAdminUser from '@/lib/requireAdminUser';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { CLIENT_REQUESTS_PROJECT } from '@/lib/clientRequestsProject';
import ReportsGallery from '@/components/ReportsGallery';

export const dynamic = 'force-dynamic';

export default async function ClientRequestsReportsPage() {
  const session = await requireAdminUser();

  const [projects, tickets] = await Promise.all([getAllProjects(), getAllTickets()]);
  const userId = session.user.id;
  const myIssuesCount = tickets.filter(
    (ticket) => ticket.created_by === userId || ticket.assigned_to === userId
  ).length;

  const projectCounts = {};
  for (const ticket of tickets) {
    if (ticket.project_id == null) continue;
    projectCounts[ticket.project_id] = (projectCounts[ticket.project_id] || 0) + 1;
  }

  return (
    <ReportsGallery
      project={CLIENT_REQUESTS_PROJECT}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={session.user}
      clientRequests
    />
  );
}
