import requireTeamUser from '@/lib/requireTeamUser';
import { notFound } from 'next/navigation';
import { getAllProjects, getProject } from '@/lib/projects';
import { getAllTickets, getTicketsForProject } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import { getDoc, getProjectDocs } from '@/lib/docs';
import DocsView from '@/components/DocsView';

export const dynamic = 'force-dynamic';

export default async function ProjectDocPage({ params }) {
  const session = await requireTeamUser();
  const { projectId, docId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [docs, doc, projects, tickets, allTickets, employees] = await Promise.all([
    getProjectDocs(project.id),
    getDoc(project.id, docId),
    getAllProjects(),
    getTicketsForProject(project.id),
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
      project={project}
      projects={projects}
      employees={employees}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={session.user}
    />
  );
}
