import { redirect, notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getAllProjects, getProject } from '@/lib/projects';
import { getAllTickets, getBlockLinks, getTicketsForProject } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import TimelineView from '@/components/TimelineView';
import { toISO } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

export default async function ProjectTimelinePage({ params }) {
  const session = await requireAuth();
  if (!session) redirect('/login');

  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [projects, projectTickets, allTickets, employees, links] = await Promise.all([
    getAllProjects(),
    getTicketsForProject(project.id),
    getAllTickets(),
    getEmployees(),
    getBlockLinks(project.id),
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
    <TimelineView
      initialTickets={projectTickets}
      initialLinks={links}
      project={project}
      projects={projects}
      employees={employees}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={session.user}
      today={toISO(new Date())}
    />
  );
}
