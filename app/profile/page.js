import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getUserProfile } from '@/lib/profiles';
import { getAllTickets } from '@/lib/tickets';
import { getAllProjects } from '@/lib/projects';
import ProfileView from '@/components/ProfileView';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const session = await requireAuth();
  if (!session) {
    redirect('/login');
  }

  const profile = await getUserProfile(session.user.id);

  let projects = [];
  let tickets = [];
  let myIssuesCount = 0;

  if (session.user.role !== 'client') {
    try {
      [projects, tickets] = await Promise.all([
        getAllProjects(),
        getAllTickets(),
      ]);
      const userId = session.user.id;
      myIssuesCount = tickets.filter(
        (t) =>
          t.created_by === userId ||
          t.assigned_to === userId ||
          t.employee_id === session.user.employee_id
      ).length;
    } catch {
      // Continue even if tickets fail to load
    }
  }

  return (
    <ProfileView
      initialProfile={profile}
      currentUser={session.user}
      projects={projects}
      initialTickets={tickets}
      myIssuesCount={myIssuesCount}
    />
  );
}

