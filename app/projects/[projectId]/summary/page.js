import { redirect, notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getAllProjects, getProject } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import { getProjectSummary } from '@/lib/projectSummary';
import ProjectSummary from '@/components/ProjectSummary';

export const dynamic = 'force-dynamic';

export default async function ProjectSummaryPage({ params }) {
  const session = await requireAuth();
  if (!session) redirect('/login');

  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [projects, tickets, employees, summary] = await Promise.all([
    getAllProjects(),
    getAllTickets(),
    getEmployees(),
    getProjectSummary(project.id),
  ]);

  const userId = session.user.id;
  const myIssuesCount = tickets.filter(
    (t) => t.created_by === userId || t.assigned_to === userId
  ).length;

  const projectCounts = {};
  for (const t of tickets) {
    if (t.project_id == null) continue;
    projectCounts[t.project_id] = (projectCounts[t.project_id] || 0) + 1;
  }

  return (
    <ProjectSummary
      initialSummary={{ project, ...summary }}
      currentUser={session.user}
      projects={projects}
      employees={employees}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
    />
  );
}
