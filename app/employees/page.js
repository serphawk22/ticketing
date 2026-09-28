import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getAllTickets } from '@/lib/tickets';
import { getAllProjects } from '@/lib/projects';
import { getEmployees } from '@/lib/employees';
import { getOutbox, isSmtpConfigured } from '@/lib/mail';
import EmployeesView from '@/components/EmployeesView';

export const dynamic = 'force-dynamic';

export default async function EmployeesPage() {
  const session = await requireAuth();
  if (!session) redirect('/login');

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
    />
  );
}
