import requireTeamUser from '@/lib/requireTeamUser';
import { redirect } from 'next/navigation';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { getAllWorkspaces } from '@/lib/workspaces';
import AppShell from '@/components/AppShell';
import PayrollDashboard from '@/components/payroll/PayrollDashboard';

export const dynamic = 'force-dynamic';

export default async function PayrollPage() {
  const session = await requireTeamUser();
  if (session.user.role === 'client') {
    redirect('/');
  }

  const [projects, tickets, workspaces] = await Promise.all([
    getAllProjects(),
    getAllTickets(),
    getAllWorkspaces(),
  ]);

  const defaultWorkspaceId = workspaces && workspaces.length > 0 ? workspaces[0].id : 1;

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
    <AppShell
      currentUser={session.user}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      view="payroll"
    >
      <div className="board" style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px' }}>
        <PayrollDashboard
          currentUser={session.user}
          workspaces={workspaces}
          workspaceId={defaultWorkspaceId}
        />
      </div>
    </AppShell>
  );
}
