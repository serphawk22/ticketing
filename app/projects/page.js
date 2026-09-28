import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getAllTickets } from '@/lib/tickets';
import { getAllProjects } from '@/lib/projects';
import ProjectsView from '@/components/ProjectsView';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const session = await requireAuth();
  if (!session) redirect('/login');

  const projects = getAllProjects();
  const tickets = getAllTickets();
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
