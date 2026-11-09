import requireAdminUser from '@/lib/requireAdminUser';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets, getArchivedClientRequestTickets } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import { CLIENT_REQUESTS_PROJECT } from '@/lib/clientRequestsProject';
import ArchivedView from '@/components/ArchivedView';

export const dynamic = 'force-dynamic';

export default async function ClientRequestsArchivedPage() {
  const session = await requireAdminUser();

  const [archived, projects, allTickets, employees] = await Promise.all([
    getArchivedClientRequestTickets(),
    getAllProjects(),
    getAllTickets(),
    getEmployees(),
  ]);

  const userId = session.user.id;
  const myIssuesCount = allTickets.filter(
    (t) => t.created_by === userId || t.assigned_to === userId
  ).length;

  const projectCounts = {};
  for (const t of allTickets) {
    if (t.project_id == null) continue;
    projectCounts[t.project_id] = (projectCounts[t.project_id] || 0) + 1;
  }

  return (
    <ArchivedView
      initialTickets={archived}
      project={CLIENT_REQUESTS_PROJECT}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      employees={employees}
      currentUser={session.user}
      clientRequests
    />
  );
}
