import requireTeamUser from '@/lib/requireTeamUser';
import { notFound, redirect } from 'next/navigation';
import { getAllProjects, getProject } from '@/lib/projects';
import { getAllTickets, getTicketsForProject } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import { getProjectDocs } from '@/lib/docs';
import DocsView from '@/components/DocsView';

export const dynamic = 'force-dynamic';

function firstDoc(docs) {
  const roots = docs
    .filter((doc) => doc.parent_id == null)
    .sort((a, b) => a.position - b.position || a.id - b.id);
  return roots[0] || docs[0] || null;
}

export default async function ProjectDocsPage({ params }) {
  const session = await requireTeamUser();
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const docs = await getProjectDocs(project.id);
  const first = firstDoc(docs);
  if (first) redirect(`/projects/${project.id}/docs/${first.id}`);

  const [projects, tickets, allTickets, employees] = await Promise.all([
    getAllProjects(),
    getTicketsForProject(project.id),
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
      project={project}
      projects={projects}
      employees={employees}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={session.user}
    />
  );
}
