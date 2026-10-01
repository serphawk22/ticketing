import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getAllTickets } from '@/lib/tickets';
import { getAllProjects } from '@/lib/projects';
import { getEmployees, getEmployeeByUserId } from '@/lib/employees';
import { toISO } from '@/lib/calendar';
import Board from '@/components/Board';
import DevDashboard from '@/components/DevDashboard';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await requireAuth();
  if (!session) redirect('/login');

  const isAdmin = session.user.role === 'admin';

  // A ticket records its assignee as an employee, while a session records the
  // signed-in account, and the two are separate tables joined only by email.
  // Resolving the link here is what lets a developer see the tasks an admin
  // created for them.
  const employee = isAdmin ? null : await getEmployeeByUserId(session.user.id);

  const [tickets, projects, employees] = await Promise.all([
    getAllTickets(),
    getAllProjects(),
    getEmployees(),
  ]);

  const today = toISO(new Date());

  if (!isAdmin) {
    return (
      <DevDashboard
        initialTickets={tickets}
        initialProjects={projects}
        initialEmployees={employees}
        currentUser={session.user}
        currentEmployeeId={employee?.id ?? null}
        today={today}
      />
    );
  }

  return (
    <Board
      initialTickets={tickets}
      initialProjects={projects}
      initialEmployees={employees}
      currentUser={session.user}
      currentEmployeeId={employee?.id ?? null}
      today={today}
    />
  );
}
