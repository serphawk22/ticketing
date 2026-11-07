import { redirect } from 'next/navigation';
import requireTeamUser from './requireTeamUser';

export default async function requireAdminUser() {
  const session = await requireTeamUser();
  if (session.user.role !== 'admin') redirect('/');
  return session;
}
