import requireAdminUser from '@/lib/requireAdminUser';
import { getAllProjects } from '@/lib/projects';
import {
  getAllTickets,
  getClientRequestBlockLinks,
  getClientRequestTickets,
} from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import { CLIENT_REQUESTS_PROJECT } from '@/lib/clientRequestsProject';
import { toISO } from '@/lib/calendar';
import TimelineView from '@/components/TimelineView';

export const dynamic = 'force-dynamic';

export default async function ClientRequestsTimelinePage() {
  const session = await requireAdminUser();

  const [tickets, projects, allTickets, employees, links] = await Promise.all([
    getClientRequestTickets(),
    getAllProjects(),
    getAllTickets(),
    getEmployees(),
    getClientRequestBlockLinks(),
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
    <TimelineView
      initialTickets={tickets}
      initialLinks={links}
      project={CLIENT_REQUESTS_PROJECT}
      projects={projects}
      employees={employees}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={session.user}
      today={toISO(new Date())}
      clientRequests
    />
  );
}
