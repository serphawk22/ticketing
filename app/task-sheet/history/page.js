import requireTeamUser from '@/lib/requireTeamUser';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { listHappyFacets, listHappySubmissions } from '@/lib/happySheet';
import { listSubmissionFacets, listSubmissions } from '@/lib/taskSheet';
import TaskSheetHistoryView from '@/components/TaskSheetHistoryView';

export const dynamic = 'force-dynamic';

/**
 * Every row of the daily timesheet, one page for the whole team.
 *
 * Open to admins and developers: a timesheet history answers "who did what,
 * when" across a team, and the people filing the sheets are the ones who read
 * it back. Clients are kept out by requireTeamUser.
 */
export default async function TaskSheetHistoryPage() {
  // requireTeamUser already keeps clients out; the history is open to admins
  // and developers alike, so there is no further role check here.
  const session = await requireTeamUser();

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