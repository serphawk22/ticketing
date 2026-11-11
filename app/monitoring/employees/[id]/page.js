import { redirect } from 'next/navigation';
import requireTeamUser from '@/lib/requireTeamUser';
import { getAllProjects } from '@/lib/projects';
import { getEmployeeMonitoringDetail } from '@/lib/monitoring';
import EmployeeMonitoringDetail from '@/components/EmployeeMonitoringDetail';

export const dynamic = 'force-dynamic';

export default async function EmployeeMonitoringPage({ params, searchParams }) {
  const session = await requireTeamUser();
  const { id } = await params;
  const query = await (searchParams || Promise.resolve({}));
  const preset = query?.preset || 'this_month';

  let initialDetail;
  try {
    initialDetail = await getEmployeeMonitoringDetail({
      user: session.user,
      employeeId: id,
      preset,
    });
  } catch (err) {
    if (err.statusCode === 403 || err.statusCode === 404) {
      redirect('/dashboard');
    }
    throw err;
  }

  const projects = await getAllProjects();

  return (
    <EmployeeMonitoringDetail
      initialDetail={initialDetail}
      projects={projects}
      currentUser={session.user}
    />
  );
}
