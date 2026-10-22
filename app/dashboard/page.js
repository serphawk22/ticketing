import requireTeamUser from '@/lib/requireTeamUser';
import { redirect } from 'next/navigation';
import { getAdminDashboardSummary } from '@/lib/analytics';
import { getAllProjects } from '@/lib/projects';
import { getEmployees } from '@/lib/employees';
import AdminDashboard from '@/components/AdminDashboard';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }) {
  const session = await requireTeamUser();
  if (session.user.role !== 'admin') {
    redirect('/my-dashboard');
  }

  const query = await searchParams;
  const preset = query?.preset || 'this_month';
  const startDate = query?.startDate || '';
  const endDate = query?.endDate || '';
  const projectId = query?.projectId || 'all';

  const [summary, projects, employees] = await Promise.all([
    getAdminDashboardSummary({ preset, startDate, endDate, projectId }),
    getAllProjects(),
    getEmployees(),
  ]);

  return (
    <AdminDashboard
      initialSummary={summary}
      projects={projects}
      employees={employees}
      currentUser={session.user}
    />
  );
}

