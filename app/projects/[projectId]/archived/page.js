import { redirect, notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getAllProjects, getProject } from '@/lib/projects';
import { getAllTickets, getArchivedTickets } from '@/lib/tickets';
import ArchivedView from '@/components/ArchivedView';

export const dynamic = 'force-dynamic';

export default async function ProjectArchivedPage({ params }) {
  const session = await requireAuth();
  if (!session) redirect('/login');

  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [projects, allTickets] = await Promise.all([getAllProjects(), getAllTickets()]);
  const archived = (await getArchivedTickets()).filter((t) => t.project_id === project.id);

  // Counts come from the active set, so the sidebar keeps matching the working
  // views rather than the archived table's contents.
  const projectCounts = {};
  for (const t of allTickets) {
    if (t.project_id == null) continue;
    projectCounts[t.project_id] = (projectCounts[t.project_id] || 0) + 1;
  }

  return (
    <ArchivedView
      initialTickets={archived}
      project={project}
      projects={projects}
      projectCounts={projectCounts}
      currentUser={session.user}
    />
  );
}
