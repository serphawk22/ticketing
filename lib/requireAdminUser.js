import { redirect } from 'next/navigation';
import requireTeamUser from './requireTeamUser';
import { isAdminOrOwner } from './rbac';

export default async function requireAdminUser() {
  const session = await requireTeamUser();
  if (!isAdminOrOwner(session.user)) redirect('/');
  return session;
}
