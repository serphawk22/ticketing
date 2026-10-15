import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployees, createEmployee, getEmployeeByEmail, toSafeEmployee } from '@/lib/employees';
import {
  createClientAccount,
  createUserWithTempPassword,
  getUserByEmail,
  issueClientPasskey,
} from '@/lib/users';
import { sendClientPasskey, sendEmployeeInvite } from '@/lib/mail';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Clients are accounts too: they live in the same directory so one page
// manages every login, but they are never assignable work.
const VALID_ROLES = ['admin', 'developer', 'client'];

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isAdmin = session.user.role === 'admin';
  const allEmployees = await getEmployees();
  // Safe filtering: non-admins NEVER receive base_salary, last_payment_date, payment_status
  const employees = allEmployees.map((e) => toSafeEmployee(e, isAdmin));

  return NextResponse.json({ employees });
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

  const {
    name,
    email,
    role = 'developer',
    department = '',
    title = '',
    base_salary = null,
    salary_currency = 'USD',
    last_payment_date = null,
    payment_status = '',
  } = await request.json();

  const cleanName = String(name ?? '').trim();
  const cleanEmail = String(email ?? '').trim().toLowerCase();

  if (!cleanName) {
    return NextResponse.json({ error: 'Employee name is required.' }, { status: 400 });
  }

  if (!EMAIL_PATTERN.test(cleanEmail)) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
  }

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json(
      { error: 'Role must be admin, developer or client.' },
      { status: 400 }
    );
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
  if (role === 'client') {
    const account = await createClientAccount({ name: cleanName, email: cleanEmail });

    const employee = await createEmployee({
      name: cleanName,
      email: cleanEmail,
      role,
      department: String(department ?? '').trim(),
      title: String(title ?? '').trim(),
      base_salary,
      salary_currency,
      last_payment_date,
      payment_status,
    });

    // A client authenticates with one passkey, emailed to the address the admin
    // just entered -- there is no temporary password to change at first login.
    const passkey = await issueClientPasskey(account.id);
    const mail = await sendClientPasskey({
      client: employee,
      passkey,
      actorName: session.user.name,
    });

    const sent = mail?.status === 'sent';

    if (!sent) {
      console.error(
        `[employees] client ${cleanEmail} created but passkey not delivered (${mail?.status || 'unknown'}): ${
          mail?.error || 'SMTP is not configured'
        }`
      );
    }

    return NextResponse.json(
      {
        employee,
        invite: {
          sent,
          status: mail?.status || 'unknown',
          error: sent ? null : mail?.error || 'SMTP is not configured, so no email was sent.',
        },
        // The passkey is a live credential, so it is not echoed back once the
        // email is away. On a failed delivery the account would otherwise be
        // unusable -- only a hash is stored -- so the admin who just created it
        // gets the plaintext to relay by hand instead.
        passkey: sent ? null : passkey,
      },
      { status: 201 }
    );
  }

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
    base_salary,
    salary_currency,
    last_payment_date,
    payment_status,
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