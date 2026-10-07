import { getUserByEmail, resetUserPassword, deleteUserSessions } from '@/lib/users';
import { getEmployeeByEmail } from '@/lib/employees';
import { sendPasswordReset } from '@/lib/mail';

/**
 * The "Forgot password" flow on the sign-in screen.
 *
 * An unauthenticated user can never recover a forgotten password on this app's
 * own: plaintext passwords are never stored, so the only way back in is a fresh
 * temporary password delivered by email. That is exactly what this endpoint
 * does, reusing the reset helpers behind "Resend invite".
 *
 * Two things make the response deliberately vague. First, saying whether an
 * account exists would tell anyone a valid email they could probe. Second,
 * resetting accounts on demand is what this endpoint is for, but it should
 * only act when there is a real account to reset AND a real mailbox to send
 * the password to, so an unknown or mailbox-less email is a deliberate no-op.
 */
export async function POST(req) {
  let email = '';
  try {
    const body = await req.json();
    email = String(body?.email || '').trim().toLowerCase();
  } catch {
    // Non-JSON bodies are treated as an empty request, which is a no-op.
  }

  if (email.includes('@') && email.includes('.')) {
    const user = await getUserByEmail(email);
    if (user) {
      const employee = await getEmployeeByEmail(email);
      if (employee) {
        const tempPassword = await resetUserPassword(user.id);
        await deleteUserSessions(user.id);
        await sendPasswordReset({ employee, tempPassword });
      }
    }
  }

  return Response.json({
    ok: true,
    message:
      'If that account exists, a reset email with a temporary password is on its way.',
  });
}