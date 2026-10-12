import { NextResponse } from 'next/server';
import { createSession } from '@/lib/auth';
import { getClientByPasskey } from '@/lib/users';

/**
 * The client door.
 *
 * A client signs in with a single per-client passkey -- no email, no password.
 * The passkey is minted when an admin adds the client and emailed to them, so
 * the only thing this route has to answer is "which client does this belong
 * to?". The passkey is stored hashed, so the lookup is a compare across client
 * accounts; there are few of them, so that stays fast.
 */
export async function POST(request) {
  const { passkey } = await request.json();

  if (!passkey) {
    return NextResponse.json({ error: 'Passkey is required.' }, { status: 400 });
  }

  const user = await getClientByPasskey(passkey);

  if (!user) {
    return NextResponse.json(
      { error: 'That passkey does not match any client account.' },
      { status: 401 }
    );
  }

  await createSession(user.id);

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
}