import requireTeamUser from '@/lib/requireTeamUser';
import { notFound } from 'next/navigation';
import { getAllProjects, getProject } from '@/lib/projects';
import { getAllTickets, getTicketsForProject } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import { getProjectAttachments } from '@/lib/attachments';
import AttachmentsView from '@/components/AttachmentsView';

export const dynamic = 'force-dynamic';

export default async function ProjectAttachmentsPage({ params }) {
  const session = await requireTeamUser();

  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [projects, projectTickets, allTickets, employees, files] = await Promise.all([
    getAllProjects(),
    getTicketsForProject(project.id),
    getAllTickets(),
    getEmployees(),
    getProjectAttachments(project.id),
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
      tickets={projectTickets}
      project={project}
      projects={projects}
      employees={employees}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={session.user}
    />
  );
}
