import requireTeamUser from '@/lib/requireTeamUser';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { indiaToday } from '@/lib/indiaDate';
import { getEndOfDayReport, getEndOfDayReportHistory, sanitizeReportForUser } from '@/lib/endOfDayReportService';
import EndOfDayReportView from '@/components/EndOfDayReportView';

export const dynamic = 'force-dynamic';

export default async function EndOfDayReportPage() {
  const session = await requireTeamUser();

  const today = indiaToday();
  const [projects, tickets, rawReport, history] = await Promise.all([
    getAllProjects(),
    getAllTickets(),
    getEndOfDayReport(today),
    getEndOfDayReportHistory(30),
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

  const initialReport = sanitizeReportForUser(rawReport, session.user);

  return (
    <EndOfDayReportView
      currentUser={session.user}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      initialDate={today}
      initialReport={initialReport}
      initialHistory={history}
    />
  );
}

