import { redirect, notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getAllProjects, getProject } from '@/lib/projects';
import { getAllTickets, getTicketsForProject } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import CalendarView from '@/components/CalendarView';
import { toISO } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

export default async function ProjectCalendarPage({ params }) {
  const session = await requireAuth();
  if (!session) redirect('/login');

  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [projects, projectTickets, allTickets, employees] = await Promise.all([
    getAllProjects(),
    getTicketsForProject(project.id),
    getAllTickets(),
    getEmployees(),
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
    <CalendarView
      initialTickets={projectTickets}
      project={project}
      projects={projects}
      employees={employees}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={session.user}
      // Resolved here rather than in the client component: the server and the
      // browser can sit in different time zones, and letting each pick its own
      // "today" is what causes a hydration mismatch. The browser inherits
      // whichever day the server saw, which is at most a few seconds stale.
      today={toISO(new Date())}
    />
  );
}
