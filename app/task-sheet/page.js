import { getSession } from '@/lib/auth';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { getActiveEmployees } from '@/lib/employees';
import TaskSheetView from '@/components/TaskSheetView';
import PublicTaskSheetView from '@/components/PublicTaskSheetView';
import { getTodayAttendance, getAttendanceSettings, checkHoliday, isSundayWeeklyOff } from '@/lib/attendance';
import { toKolkata } from '@/lib/businessHours';

export const dynamic = 'force-dynamic';

/**
 * The daily task sheet.
 *
 * The route is public:
 * A signed-in team member gets the in-app page with the sidebar and the attendance card,
 * and public/anonymous visitors get the standalone card.
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

  const projects = await getAllProjects();
  const projectNames = projects.map((p) => p.name);

  if (!isTeamUser) {
    return (
      <PublicTaskSheetView
        people={people}
        projects={projects.map((p) => ({ id: p.id, name: p.name, key: p.key, color: p.color }))}
        projectNames={projectNames}
        defaults={defaults}
      />
    );
  }

  const tickets = await getAllTickets();

  const projectCounts = {};
  for (const t of tickets) {
    if (t.project_id == null) continue;
    projectCounts[t.project_id] = (projectCounts[t.project_id] || 0) + 1;
  }

  const userId = session.user.id;
  const myIssuesCount = tickets.filter(
    (t) => t.created_by === userId || t.assigned_to === userId
  ).length;

  let initialAttendance = null;
  if (session.user.employee_id) {
    try {
      const now = new Date();
      const todayStr = toKolkata(now).toISOString().slice(0, 10);
      const [att, settings, holiday] = await Promise.all([
        getTodayAttendance(session.user.employee_id),
        getAttendanceSettings(),
        checkHoliday(now),
      ]);
      initialAttendance = {
        todayStr,
        isSunday: isSundayWeeklyOff(now),
        holiday,
        settings,
        attendance: att,
      };
    } catch {
      // Fallback
    }
  }

  return (
    <TaskSheetView
      currentUser={session.user}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      people={people}
      projectNames={projectNames}
      defaults={defaults}
      initialAttendance={initialAttendance}
    />
  );
}
