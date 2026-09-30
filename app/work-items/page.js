import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import ListView from '@/components/ListView';

export const dynamic = 'force-dynamic';

/**
 * Cross-project work items: the same list table with no project filter. The
 * view preferences are keyed off a null project id, so this page keeps its own
 * toggles rather than sharing each project's saved view.
 */
export default async function AllWorkItemsPage() {
  const session = await requireAuth();
  if (!session) redirect('/login');

  const [projects, allTickets, employees] = await Promise.all([
    getAllProjects(),
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
    <ListView
      initialTickets={allTickets}
      project={null}
      projects={projects}
      employees={employees}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={session.user}
    />
  );
}
