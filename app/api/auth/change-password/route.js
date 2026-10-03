import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAuth } from '@/lib/auth';
import { getUserByEmail, setUserPassword, passwordProblems } from '@/lib/users';

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { currentPassword, newPassword } = await request.json();

  const user = await getUserByEmail(session.user.email);
  if (!user) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }

  if (!currentPassword || !bcrypt.compareSync(currentPassword, user.password)) {
    return NextResponse.json({ error: 'Your current password is incorrect.' }, { status: 401 });
  }

  const problems = passwordProblems(newPassword);
  if (problems.length > 0) {
    return NextResponse.json(
      { error: `Choose a password with ${problems.join(', ')}.` },
      { status: 400 }
    );
  }

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: 'Choose a password you have not used here before.' },
      { status: 400 }
    );
  }

  // setUserPassword also clears must_change_password, which is what makes the
  // temporary password single-use: after this the account signs in normally.
  await setUserPassword(user.id, newPassword);

  return NextResponse.json({ ok: true, role: session.user.role });
}