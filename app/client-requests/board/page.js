import requireAdminUser from '@/lib/requireAdminUser';
import { getAllProjects } from '@/lib/projects';
import { getClientRequestTickets } from '@/lib/tickets';
import { getActiveEmployees, getEmployeeByUserId } from '@/lib/employees';
import { toISO } from '@/lib/calendar';
import Board from '@/components/Board';

export const dynamic = 'force-dynamic';

export default async function ClientRequestsBoardPage() {
  const session = await requireAdminUser();

  const [tickets, projects, employees, employee] = await Promise.all([
    getClientRequestTickets(),
    getAllProjects(),
    getActiveEmployees(),
    getEmployeeByUserId(session.user.id),
  ]);

  return (
    <Board
      initialTickets={tickets}
      initialProjects={projects}
      initialEmployees={employees}
      currentUser={session.user}
      currentEmployeeId={employee?.id ?? null}
      today={toISO(new Date())}
      clientRequests
    />
  );
}
