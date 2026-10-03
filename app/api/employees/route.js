import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployees, createEmployee, getEmployeeByEmail } from '@/lib/employees';
import { createUserWithTempPassword, getUserByEmail } from '@/lib/users';
import { sendEmployeeInvite } from '@/lib/mail';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Clients are accounts too: they live in the same directory so one page
// manages every login, but they are never assignable work.
const VALID_ROLES = ['admin', 'developer', 'client'];

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({ employees: await getEmployees() });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can add employees.' },
      { status: 403 }
    );
  }

  const { name, email, role = 'developer', department = '', title = '' } =
    await request.json();

  const cleanName = String(name ?? '').trim();
  const cleanEmail = String(email ?? '').trim().toLowerCase();

  if (!cleanName) {
    return NextResponse.json({ error: 'Employee name is required.' }, { status: 400 });
  }

  if (!EMAIL_PATTERN.test(cleanEmail)) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
  }

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Role must be admin or developer.' }, { status: 400 });
  }

  // Both tables are keyed by email, so a clash in either one has to stop the
  // insert. Otherwise the account is created with no matching directory entry,
  // and the next boot's mirror step invents one with the wrong role.
  if (await getEmployeeByEmail(cleanEmail)) {
    return NextResponse.json(
      { error: `${cleanEmail} is already in the directory.` },
      { status: 409 }
    );
  }

  if (await getUserByEmail(cleanEmail)) {
    return NextResponse.json(
      { error: `${cleanEmail} already has a Ticket Manager login.` },
      { status: 409 }
    );
  }

  // The account is created first: an employee with no way to sign in would be
  // a directory entry that does nothing.
  const account = await createUserWithTempPassword({
    name: cleanName,
    email: cleanEmail,
    role,
  });

  const employee = await createEmployee({
    name: cleanName,
    email: cleanEmail,
    role,
    department: String(department ?? '').trim(),
    title: String(title ?? '').trim(),
  });

  const invite = await sendEmployeeInvite({
    employee,
    tempPassword: account.tempPassword,
    actorName: session.user.name,
  });

  // The employee is saved either way. A failed invite is reported so the UI
  // can warn the admin and offer a resend, rather than looking like success.
  const sent = invite?.status === 'sent';

  if (!sent) {
    console.error(
      `[employees] ${cleanEmail} created but invite not delivered (${invite?.status || 'unknown'}): ${
        invite?.error || 'SMTP is not configured'
      }`
    );
  }

  return NextResponse.json(
    {
      employee,
      invite: {
        sent,
        status: invite?.status || 'unknown',
        error: sent ? null : invite?.error || 'SMTP is not configured, so no email was sent.',
      },
    },
    { status: 201 }
  );
}