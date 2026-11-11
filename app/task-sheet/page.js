import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { getActiveEmployees } from '@/lib/employees';
import TaskSheetView from '@/components/TaskSheetView';
import PublicTaskSheetView from '@/components/PublicTaskSheetView';
import { getTodayAttendance, getAttendanceSettings, checkHoliday, isSundayWeeklyOff } from '@/lib/attendance';
import { toKolkata } from '@/lib/businessHours';
import { isAdminOrOwner, isTeamUser as checkIsTeamUser } from '@/lib/rbac';
import {
  TASK_SHEET_CSRF_COOKIE,
  TASK_SHEET_SESSION_COOKIE,
  validateTaskSheetCookieSession,
} from '@/lib/taskSheetTokens';
import { getWorkCategories } from '@/lib/workLedger';

export const dynamic = 'force-dynamic';

/**
 * The daily task sheet.
 *
 * - Authenticated team users get the in-app Task Sheet with Attendance.
 * - External/shared links MUST exchange an employee-specific token via
 *   `/api/task-sheet/exchange-token` (setting HttpOnly cookie + CSRF token
 *   and stripping the plaintext token from the URL).
 */
export default async function TaskSheetPage({ searchParams }) {
  const sp = await (searchParams || Promise.resolve({}));
  const rawToken = typeof sp?.token === 'string' ? sp.token.trim() : '';
  if (rawToken) {
    redirect(`/api/task-sheet/exchange-token?token=${encodeURIComponent(rawToken)}`);
  }

  const session = await getSession();
  const teamUser = checkIsTeamUser(session?.user);

  const [projects, workCategories] = await Promise.all([
    getAllProjects(),
    getWorkCategories({ activeOnly: true }),
  ]);
  const projectNames = projects.map((p) => p.name);

  if (!teamUser) {
    const cookieStore = await cookies();
    const tsCookie = cookieStore.get(TASK_SHEET_SESSION_COOKIE)?.value || '';
    const tsCsrf = cookieStore.get(TASK_SHEET_CSRF_COOKIE)?.value || '';
    const tsSession = tsCookie
      ? await validateTaskSheetCookieSession({ sessionCookieValue: tsCookie })
      : null;

    const verifiedEmployee = tsSession ? tsSession.employee : null;
    const tokenError =
      typeof sp?.token_error === 'string'
        ? sp.token_error
        : !verifiedEmployee && tsCookie
          ? 'expired'
          : !verifiedEmployee
            ? 'missing'
            : null;

    const people = verifiedEmployee ? [{ name: verifiedEmployee.name, active: true }] : [];
    const defaults = verifiedEmployee ? { name: verifiedEmployee.name } : {};

    return (
      <PublicTaskSheetView
        people={people}
        projects={projects.map((p) => ({ id: p.id, name: p.name, key: p.key, color: p.color }))}
        projectNames={projectNames}
        defaults={defaults}
        verifiedEmployee={verifiedEmployee}
        csrfToken={verifiedEmployee ? tsCsrf : ''}
        tokenError={tokenError}
        workCategories={workCategories}
      />
    );
  }

  const people = (await getActiveEmployees()).map((e) => ({ name: e.name }));
  const defaults =
    session && people.some((p) => p.name === session.user.name)
      ? { name: session.user.name }
      : {};
  const identityLocked = !isAdminOrOwner(session.user);

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
      identityLocked={identityLocked}
      workCategories={workCategories}
    />
  );
}
