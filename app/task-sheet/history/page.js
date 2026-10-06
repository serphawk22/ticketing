import { redirect } from 'next/navigation';
import requireTeamUser from '@/lib/requireTeamUser';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { listHappyFacets, listHappySubmissions } from '@/lib/happySheet';
import { listSubmissionFacets, listSubmissions } from '@/lib/taskSheet';
import TaskSheetHistoryView from '@/components/TaskSheetHistoryView';

export const dynamic = 'force-dynamic';

/**
 * Every row of the daily timesheet, one page for the people who run the shop.
 *
 * Admin only: a timesheet history answers "who did what, when" across a team,
 * which is a manager's question, not one a row's own author is entitled to
 * answer about everyone else.
 */
export default async function TaskSheetHistoryPage() {
  const session = await requireTeamUser();
  if (session.user.role !== 'admin') redirect('/');

  const [submissions, facets, happySubmissions, happyFacets, projects, tickets] =
    await Promise.all([
      listSubmissions(),
      listSubmissionFacets(),
      listHappySubmissions(),
      listHappyFacets(),
      getAllProjects(),
      getAllTickets(),
    ]);

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
    <TaskSheetHistoryView
      currentUser={session.user}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      initial={submissions}
      facets={facets}
      happyInitial={happySubmissions}
      happyFacets={happyFacets}
    />
  );
}