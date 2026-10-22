import requireTeamUser from '@/lib/requireTeamUser';
import { getEmployeeDashboardSummary } from '@/lib/analytics';
import { getAllProjects } from '@/lib/projects';
import { getEmployeeByUserId } from '@/lib/employees';
import EmployeeDashboard from '@/components/EmployeeDashboard';

export const dynamic = 'force-dynamic';

export default async function MyDashboardPage({ searchParams }) {
  const session = await requireTeamUser();
  const query = await searchParams;

  const preset = query?.preset || 'this_month';
  const startDate = query?.startDate || '';
  const endDate = query?.endDate || '';
  const projectId = query?.projectId || 'all';

  const employee = await getEmployeeByUserId(session.user.id);

  const [summary, projects] = await Promise.all([
    getEmployeeDashboardSummary({
      userId: session.user.id,
      employeeId: employee?.id || null,
      preset,
      startDate,
      endDate,
      projectId,
    }),
    getAllProjects(),
  ]);

  return (
    <EmployeeDashboard
      initialSummary={summary}
      projects={projects}
      currentUser={session.user}
    />
  );
}

