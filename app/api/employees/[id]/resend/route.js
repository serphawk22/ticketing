import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployee } from '@/lib/employees';
import { getUserByEmail, issueClientPasskey, resetUserPassword } from '@/lib/users';
import { sendClientPasskey, sendEmployeeInvite } from '@/lib/mail';

export const dynamic = 'force-dynamic';

/**
 * Reissues the sign-in credential.
 *
 * For team members that is an invite: the original temporary password cannot
 * be repeated -- only its bcrypt hash was ever stored, which is the point -- so
 * a resend mints a fresh temporary password, re-arms the forced change at
 * first login, and emails it. Any earlier unused password stops working.
 *
 * For a client the credential is their passkey. Same hash-only rule, so a
 * resend rotates to a brand-new passkey and the old one stops working
 * immediately -- which is also what an admin retrying a failed send actually
 * wants.
 */
export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can resend credentials.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  const account = employee.user_id
    ? await getUserById(employee.user_id)
    : await getUserByEmail(employee.email);
  if (!account) {
    return NextResponse.json(
      { error: `${employee.name} has no login yet.` },
      { status: 409 }
    );
  }

  const isClient = employee.role === 'client';

  if (isClient) {
    const passkey = await issueClientPasskey(account.id);
    let sent = false;
    let mail = null;

    if (employee.email) {
      mail = await sendClientPasskey({
        client: employee,
        passkey,
        actorName: session.user.name,
        trigger: 'client-passkey-resend',
      });
      sent = mail?.status === 'sent';

      if (!sent) {
        console.error(
          `[employees] passkey resend to ${employee.email} failed (${mail?.status || 'unknown'}): ${
            mail?.error || 'SMTP is not configured'
          }`
        );
      }
    }

    return NextResponse.json(
      {
        resent: sent,
        status: employee.email ? (mail?.status || 'unknown') : 'not_applicable',
        error: sent
          ? null
          : employee.email
          ? mail?.error || 'SMTP is not configured, so no email was sent.'
          : 'No email address provided for this client.',
        // Echo back on failure or when no email so the fresh passkey can be relayed by hand
        passkey: sent ? null : passkey,
        employee,
      },
      { status: sent || !employee.email ? 200 : 502 }
    );
  }

  const tempPassword = await resetUserPassword(account.id);

  const invite = await sendEmployeeInvite({
    employee,
    tempPassword,
    actorName: session.user.name,
    trigger: 'invite-resend',
  });

  const sent = invite?.status === 'sent';

  if (!sent) {
    console.error(
      `[employees] resend to ${employee.email} failed (${invite?.status || 'unknown'}): ${
        invite?.error || 'SMTP is not configured'
      }`
    );
  }

  // The password was already re-armed, so report the failure rather than
  // pretending the resend worked.
  return NextResponse.json(
    {
      resent: sent,
      status: invite?.status || 'unknown',
      error: sent
        ? null
        : invite?.error || 'SMTP is not configured, so no email was sent.',
      employee,
    },
    { status: sent ? 200 : 502 }
  );
}