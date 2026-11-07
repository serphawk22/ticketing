import requireAdminUser from '@/lib/requireAdminUser';
import { notFound } from 'next/navigation';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets, getClientRequestTickets } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import { getClientRequestDoc, getClientRequestDocs } from '@/lib/clientRequestDocs';
import { CLIENT_REQUESTS_PROJECT } from '@/lib/clientRequestsProject';
import DocsView from '@/components/DocsView';

export const dynamic = 'force-dynamic';

export default async function ClientRequestsDocPage({ params }) {
  const session = await requireAdminUser();
  const { docId } = await params;

  const [docs, doc, tickets, projects, allTickets, employees] = await Promise.all([
    getClientRequestDocs(),
    getClientRequestDoc(docId),
    getClientRequestTickets(),
    getAllProjects(),
    getAllTickets(),
    getEmployees(),
  ]);
  if (!doc) notFound();

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
      activeDoc={doc}
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
