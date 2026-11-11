import requireTeamUser from '@/lib/requireTeamUser';
import { redirect } from 'next/navigation';
import { getAllProjects } from '@/lib/projects';
import { getOwnerOverview, getManagerOverview } from '@/lib/monitoring';
import { isAdminOrOwner, isManager } from '@/lib/rbac';
import OwnerDashboard from '@/components/OwnerDashboard';
import ManagerDashboard from '@/components/ManagerDashboard';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }) {
  const session = await requireTeamUser();
  const query = await (searchParams || Promise.resolve({}));
  const preset = query?.preset || 'this_month';
  const startDate = query?.startDate || '';
  const endDate = query?.endDate || '';

  if (isAdminOrOwner(session.user)) {
    const [overview, projects] = await Promise.all([
      getOwnerOverview({
        user: session.user,
        preset,
        from: startDate || null,
        to: endDate || null,
      }),
      getAllProjects(),
    ]);

    return (
      <OwnerDashboard
        initialOverview={overview}
        projects={projects}
        currentUser={session.user}
      />
    );
  }

  if (isManager(session.user)) {
    const [overview, projects] = await Promise.all([
      getManagerOverview({
        user: session.user,
        preset,
        from: startDate || null,
        to: endDate || null,
      }),
      getAllProjects(),
    ]);

    return (
      <ManagerDashboard
        initialOverview={overview}
        projects={projects}
        currentUser={session.user}
      />
    );
  }

  redirect('/my-dashboard');
}
