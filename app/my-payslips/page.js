import requireTeamUser from '@/lib/requireTeamUser';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { db } from '@/lib/db';
import AppShell from '@/components/AppShell';
import MyPayslipsView from '@/components/payroll/MyPayslipsView';

export const dynamic = 'force-dynamic';

export default async function MyPayslipsPage() {
  const session = await requireTeamUser();

  const [projects, tickets, emp] = await Promise.all([
    getAllProjects(),
    getAllTickets(),
    db.prepare('SELECT id FROM employees WHERE user_id = ?').get(session.user.id),
  ]);

  const employeeId = emp ? emp.id : null;

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
      view="my-payslips"
    >
      <div className="board" style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px' }}>
        <MyPayslipsView employeeId={employeeId} />
      </div>
    </AppShell>
  );
}
