import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import ChangePasswordView from '@/components/ChangePasswordView';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const session = await requireAuth();
  if (!session) redirect('/login');

  return (
    <ChangePasswordView
      currentUser={session.user}
      forced={Boolean(session.user.must_change_password)}
    />
  );
}