import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getAllTickets, getDevelopers } from '@/lib/tickets';
import { getAllProjects } from '@/lib/projects';
import Board from '@/components/Board';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await requireAuth();
  if (!session) redirect('/login');

  const tickets = getAllTickets();
  const developers = getDevelopers();
  const projects = getAllProjects();

  return (
    <Board
      initialTickets={tickets}
      initialProjects={projects}
      currentUser={session.user}
      developers={developers}
    />
  );
}