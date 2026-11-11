import requireAdminUser from '@/lib/requireAdminUser';
import { redirect } from 'next/navigation';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets, getClientRequestTickets } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import { getClientRequestDocs } from '@/lib/clientRequestDocs';
import { CLIENT_REQUESTS_PROJECT } from '@/lib/clientRequestsProject';
import DocsView from '@/components/DocsView';

export const dynamic = 'force-dynamic';

function firstDoc(docs) {
  const roots = docs
    .filter((doc) => doc.parent_id == null)
    .sort((a, b) => a.position - b.position || a.id - b.id);
  return roots[0] || docs[0] || null;
}

export default async function ClientRequestsDocsPage() {
  const session = await requireAdminUser();

  const docs = await getClientRequestDocs();
  const first = firstDoc(docs);
  if (first) redirect(`/client-requests/docs/${first.id}`);

  const [tickets, projects, allTickets, employees] = await Promise.all([
    getClientRequestTickets(),
    getAllProjects(),
    getAllTickets(),
    getEmployees(),
  ]);

  const userId = session.user.id;
  const myIssuesCount = allTickets.filter(
    (ticket) => ticket.created_by === userId || ticket.assigned_to === userId
  ).length;

  const projectCounts = {};
  for (const ticket of allTickets) {
    if (ticket.project_id == null) continue;
    projectCounts[ticket.project_id] = (projectCounts[ticket.project_id] || 0) + 1;
  }

  return (
    <DocsView
      docs={docs}
      activeDoc={null}
      tickets={tickets}
      allTickets={allTickets}
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
