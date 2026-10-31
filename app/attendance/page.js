import requireTeamUser from '@/lib/requireTeamUser';
import { redirect } from 'next/navigation';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import {
  getWorkforceAttendanceForDate,
  getAttendanceSettings,
  getCompanyHolidays,
} from '@/lib/attendance';
import { toKolkata } from '@/lib/businessHours';
import AdminAttendanceView from '@/components/AdminAttendanceView';

export const dynamic = 'force-dynamic';

export default async function AttendanceManagementPage({ searchParams }) {
  const session = await requireTeamUser();
  if (session.user.role !== 'admin') {
    redirect('/my-attendance');
  }

  const query = await searchParams;
  const now = new Date();
  const todayStr = toKolkata(now).toISOString().slice(0, 10);
  const workDate = query?.date || todayStr;
  const department = query?.department || 'all';
  const search = query?.search || '';

  const [projects, tickets, initialData, initialSettings, initialHolidays] = await Promise.all([
    getAllProjects(),
    getAllTickets(),
    getWorkforceAttendanceForDate({ workDate, department, search }),
    getAttendanceSettings(),
    getCompanyHolidays(),
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
    <AdminAttendanceView
      currentUser={session.user}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      initialData={initialData}
      initialSettings={initialSettings}
      initialHolidays={initialHolidays}
    />
  );
}

