import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployee } from '@/lib/employees';
import { getUserByEmail, resetUserPassword } from '@/lib/users';
import { sendEmployeeInvite } from '@/lib/mail';

export const dynamic = 'force-dynamic';

/**
 * Reissues an invite.
 *
 * The original temporary password cannot be repeated: only its bcrypt hash was
 * ever stored, which is the point. So a resend mints a fresh temporary
 * password, re-arms the forced change at first login, and emails it. Any
 * earlier unused password stops working, which is also what an admin retrying
 * a failed send actually wants.
 */
export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can resend invites.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  const account = await getUserByEmail(employee.email);
  if (!account) {
    return NextResponse.json(
      { error: `${employee.email} has no login to invite yet.` },
      { status: 409 }
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