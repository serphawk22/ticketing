import requireTeamUser from '@/lib/requireTeamUser';
import { getAllTickets } from '@/lib/tickets';
import { getAllProjects } from '@/lib/projects';
import { getEmployees } from '@/lib/employees';
import { getOutbox, isSmtpConfigured } from '@/lib/mail';
import EmployeesView from '@/components/EmployeesView';

export const dynamic = 'force-dynamic';

export default async function EmployeesPage() {
  const session = await requireTeamUser();

  const employees = await getEmployees();
  const projects = await getAllProjects();
  const outbox = await getOutbox({ limit: 100 });
  const tickets = await getAllTickets();
  const userId = session.user.id;

  const myIssuesCount = tickets.filter(
    (t) =>
      t.created_by === userId ||
      t.assigned_to === userId ||
      t.employee_id === session.user.employee_id
  ).length;

  return (
    <EmployeesView
      initialEmployees={employees}
      initialOutbox={outbox}
      currentUser={session.user}
      myIssuesCount={myIssuesCount}
      smtpConfigured={isSmtpConfigured()}
      projects={projects}
      initialTickets={tickets}
    />
  );
}
