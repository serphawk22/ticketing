import { redirect } from 'next/navigation';
import requireTeamUser from '@/lib/requireTeamUser';
import { getAllProjects } from '@/lib/projects';
import { getProjectMonitoringDetail } from '@/lib/monitoring';
import ProjectMonitoringView from '@/components/ProjectMonitoringView';

export const dynamic = 'force-dynamic';

export default async function ProjectMonitoringPage({ params, searchParams }) {
  const session = await requireTeamUser();
  const { projectId } = await params;
  const query = await (searchParams || Promise.resolve({}));
  const preset = query?.preset || 'this_month';

  let initialDetail;
  try {
    initialDetail = await getProjectMonitoringDetail({
      user: session.user,
      projectId,
      preset,
    });
  } catch (err) {
    if (err.statusCode === 403 || err.statusCode === 404) {
      redirect('/projects');
    }
    throw err;
  }

  const projects = await getAllProjects();

  return (
    <ProjectMonitoringView
      initialDetail={initialDetail}
      projects={projects}
      currentUser={session.user}
    />
  );
}
