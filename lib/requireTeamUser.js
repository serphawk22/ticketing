import { redirect } from 'next/navigation';
import { requireAuth } from './auth';

/**
 * Guard for the team app.
 *
 * Client accounts sign in to their own portal and have no business in the
 * board, the directory or the project views -- those pages assume a session
 * that can see every ticket. Rather than repeat that caveat in a dozen page
 * components, each one asks for a team session here and a client is sent to
 * their portal instead.
 *
 * An unauthenticated visitor still goes to the team login, because that is the
 * page that knows which door to send them back to.
 */
export default async function requireTeamUser() {
  const session = await requireAuth();
  if (!session) redirect('/login');

  if (session.user.role === 'client') {
    redirect(session.user.must_change_password ? '/change-password' : '/client');
  }

  return session;
}