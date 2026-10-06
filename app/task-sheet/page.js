import { getSession } from '@/lib/auth';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { getActiveEmployees } from '@/lib/employees';
import { TASK_SHEET_PROJECTS } from '@/lib/taskSheet';
import TaskSheetView from '@/components/TaskSheetView';
import PublicTaskSheetView from '@/components/PublicTaskSheetView';

export const dynamic = 'force-dynamic';

/**
 * The daily task sheet.
 *
 * The whole point of the sheet is that it can be handed to someone without
 * setting up an account first -- the link that used to go to Microsoft Forms
 * has to keep working for the person it was sent to. So the route is public:
 * a signed-in team member gets the in-app page with the sidebar, and everyone
 * else (signed out, or in the client portal) gets the standalone card. The row
 * their answers save as is anonymous on the server; the name in the dropdown is
 * the person's own pick, the way the external form filled in.
 */
export default async function TaskSheetPage() {
  const session = await getSession();
  const isTeamUser = Boolean(
    session && (session.user.role === 'admin' || session.user.role === 'developer')
  );

  const people = (await getActiveEmployees()).map((e) => ({ name: e.name }));
  const defaults =
    session && people.some((p) => p.name === session.user.name)
      ? { name: session.user.name }
      : {};

  if (!isTeamUser) {
    return (
      <PublicTaskSheetView
        people={people}
        projectNames={TASK_SHEET_PROJECTS}
        defaults={defaults}
      />
    );
  }

  const [projects, tickets] = await Promise.all([getAllProjects(), getAllTickets()]);

  const projectCounts = {};
  for (const t of tickets) {
    if (t.project_id == null) continue;
    projectCounts[t.project_id] = (projectCounts[t.project_id] || 0) + 1;
  }

  const userId = session.user.id;
  const myIssuesCount = tickets.filter(
    (t) => t.created_by === userId || t.assigned_to === userId
  ).length;

  return (
    <TaskSheetView
      currentUser={session.user}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      people={people}
      projectNames={TASK_SHEET_PROJECTS}
      defaults={defaults}
    />
  );
}