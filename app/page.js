import requireTeamUser from '@/lib/requireTeamUser';
import { getAllTickets } from '@/lib/tickets';
import { getAllProjects } from '@/lib/projects';
import { getEmployees, getEmployeeByUserId } from '@/lib/employees';
import { toISO } from '@/lib/calendar';
import Board from '@/components/Board';
import DevDashboard from '@/components/DevDashboard';

export const dynamic = 'force-dynamic';

export default async function HomePage({ searchParams }) {
  const session = await requireTeamUser();
  const { filter } = await searchParams;

  const isAdmin = session.user.role === 'admin';

  // A developer always lands on the "My tickets" dashboard. An admin lands on
  // the board but reaches the very same two-section dashboard (Assigned to me /
  // Assigned by me) through the sidebar or the "Your work" top-nav link, both of
  // which point at /?filter=mine.
  const showDevDashboard = !isAdmin || filter === 'mine';

  const employee = await getEmployeeByUserId(session.user.id);

  const [tickets, projects, employees] = await Promise.all([
    getAllTickets(),
    getAllProjects(),
    getEmployees(),
  ]);

  const today = toISO(new Date());

  if (showDevDashboard) {
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
