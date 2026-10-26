import requireTeamUser from '@/lib/requireTeamUser';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { getEmployeeAttendanceHistory } from '@/lib/attendance';
import { toKolkata } from '@/lib/businessHours';
import MyAttendanceView from '@/components/MyAttendanceView';

export const dynamic = 'force-dynamic';

export default async function MyAttendancePage({ searchParams }) {
  const session = await requireTeamUser();
  const query = await searchParams;

  const now = new Date();
  const currentMonthStr = toKolkata(now).toISOString().slice(0, 7);
  const month = query?.month || currentMonthStr;
  const startDate = `${month}-01`;
  const endDate = `${month}-31`;

  const [projects, tickets, initialData] = await Promise.all([
    getAllProjects(),
    getAllTickets(),
    session.user.employee_id
      ? getEmployeeAttendanceHistory({
          employeeId: session.user.employee_id,
          startDate,
          endDate,
        })
      : { records: [], summary: {} },
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
    <MyAttendanceView
      currentUser={session.user}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      initialData={{
        month,
        startDate,
        endDate,
        ...initialData,
      }}
    />
  );
}

