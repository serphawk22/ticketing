import requireTeamUser from '@/lib/requireTeamUser';
import { redirect } from 'next/navigation';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import AppShell from '@/components/AppShell';
import PeriodDetailView from '@/components/payroll/PeriodDetailView';

export const dynamic = 'force-dynamic';

export default async function PayrollPeriodPage({ params }) {
  const session = await requireTeamUser();
  if (session.user.role === 'client') {
    redirect('/');
  }

  const { id } = await params;
  const [projects, tickets] = await Promise.all([
    getAllProjects(),
    getAllTickets(),
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
    <AppShell
      currentUser={session.user}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      view="payroll"
    >
      <div className="board" style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px' }}>
        <PeriodDetailView periodId={Number(id)} />
      </div>
    </AppShell>
  );
}
