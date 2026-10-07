import requireTeamUser from '@/lib/requireTeamUser';
import { notFound } from 'next/navigation';
import { getAllProjects, getProject } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import ReportsGallery from '@/components/ReportsGallery';

export const dynamic = 'force-dynamic';

export default async function ProjectReportsPage({ params }) {
  const session = await requireTeamUser();
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

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
      project={project}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={session.user}
    />
  );
}
