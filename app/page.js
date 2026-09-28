import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getAllTickets } from '@/lib/tickets';
import { getAllProjects } from '@/lib/projects';
import { getEmployees } from '@/lib/employees';
import Board from '@/components/Board';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await requireAuth();
  if (!session) redirect('/login');

  const tickets = await getAllTickets();
  const projects = await getAllProjects();
  const employees = await getEmployees();

  return (
    <Board
      initialTickets={tickets}
      initialProjects={projects}
      initialEmployees={employees}
      currentUser={session.user}
    />
  );
}