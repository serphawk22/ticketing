import requireAdminUser from '@/lib/requireAdminUser';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets, getClientRequestTickets } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import { getClientRequestAttachments } from '@/lib/attachments';
import { CLIENT_REQUESTS_PROJECT } from '@/lib/clientRequestsProject';
import AttachmentsView from '@/components/AttachmentsView';

export const dynamic = 'force-dynamic';

export default async function ClientRequestsAttachmentsPage() {
  const session = await requireAdminUser();

  const [files, tickets, projects, allTickets, employees] = await Promise.all([
    getClientRequestAttachments(),
    getClientRequestTickets(),
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
    <AttachmentsView
      initialFiles={files}
      tickets={tickets}
      project={CLIENT_REQUESTS_PROJECT}
      projects={projects}
      employees={employees}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={session.user}
      clientRequests
    />
  );
}
