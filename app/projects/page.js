import requireTeamUser from '@/lib/requireTeamUser';
import { getAllTickets } from '@/lib/tickets';
import { getAllProjects } from '@/lib/projects';
import ProjectsView from '@/components/ProjectsView';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const session = await requireTeamUser();

  const projects = await getAllProjects();
  const tickets = await getAllTickets();
  const userId = session.user.id;

  const myIssuesCount = tickets.filter(
    (t) => t.created_by === userId || t.assigned_to === userId
  ).length;

  return (
    <ProjectsView
      initialProjects={projects}
      currentUser={session.user}
      myIssuesCount={myIssuesCount}
    />
  );
}
