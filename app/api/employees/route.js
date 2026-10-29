import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployees, createEmployee, getEmployeeByEmail, toSafeEmployee } from '@/lib/employees';
import { ensureEmployeeLeaveBalances } from '@/lib/attendance';
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

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId');

  const isAdmin = session.user.role === 'admin';
  const allEmployees = await getEmployees({ workspaceId: workspaceId ? Number(workspaceId) : null });
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
    secondary_email,
    role = 'developer',
    department = '',
    title = '',
    base_salary = null,
    salary_currency = 'USD',
    last_payment_date = null,
    payment_status = '',
    employment_type = 'full_time',
    workspace_id = null,
  } = await request.json();

  const cleanName = String(name ?? '').trim();
  const rawEmail = email !== undefined && email !== null ? String(email).trim() : '';
  const cleanEmail = rawEmail ? rawEmail.toLowerCase() : null;

  const rawSecondary = secondary_email !== undefined && secondary_email !== null ? String(secondary_email).trim() : '';
  const cleanSecondaryEmail = rawSecondary ? rawSecondary.toLowerCase() : null;

  if (!cleanName) {
    return NextResponse.json({ error: 'Employee name is required.' }, { status: 400 });
  }

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json(
      { error: 'Role must be admin, developer or client.' },
      { status: 400 }
    );
  }

  const isClient = role === 'client';

  // Secondary email is only permitted for client role
  if (!isClient && cleanSecondaryEmail) {
    return NextResponse.json(
      { error: 'Secondary email is only applicable for clients.' },
      { status: 400 }
    );
  }

  // Role-specific validation
  if (!isClient) {
    if (!cleanEmail) {
      return NextResponse.json({ error: 'Email is required for employees.' }, { status: 400 });
    }
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }
  } else {
    // Client role: primary email is required and must be valid format
    if (!cleanEmail) {
      return NextResponse.json({ error: 'Primary email is required for clients.' }, { status: 400 });
    }
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }
    if (cleanSecondaryEmail && !EMAIL_PATTERN.test(cleanSecondaryEmail)) {
      return NextResponse.json({ error: 'A valid secondary email address is required.' }, { status: 400 });
    }
    if (cleanEmail && cleanSecondaryEmail && cleanEmail === cleanSecondaryEmail) {
      return NextResponse.json(
        { error: 'Secondary email must be different from primary email.' },
        { status: 400 }
      );
    }
    // Prevent unauthorized assignment of compensation/employment data to clients
    if (base_salary !== null && base_salary !== undefined && String(base_salary).trim() !== '') {
      return NextResponse.json(
        { error: 'Compensation cannot be assigned to clients.' },
        { status: 400 }
      );
    }
    if (payment_status && String(payment_status).trim() !== '') {
      return NextResponse.json(
        { error: 'Payment status cannot be assigned to clients.' },
        { status: 400 }
      );
    }
    if (last_payment_date && String(last_payment_date).trim() !== '') {
      return NextResponse.json(
        { error: 'Payment date cannot be assigned to clients.' },
        { status: 400 }
      );
    }
    if (department && String(department).trim() !== '') {
      return NextResponse.json(
        { error: 'Department cannot be assigned to clients.' },
        { status: 400 }
      );
    }
    if (title && String(title).trim() !== '') {
      return NextResponse.json(
        { error: 'Job title cannot be assigned to clients.' },
        { status: 400 }
      );
    }
  }

  // Duplicate email check (only when cleanEmail is provided)
  if (cleanEmail) {
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
  }

  // Duplicate check for secondary email (against directory primary email and user logins)
  if (cleanSecondaryEmail) {
    if (await getEmployeeByEmail(cleanSecondaryEmail)) {
      return NextResponse.json(
        { error: `${cleanSecondaryEmail} is already in the directory.` },
        { status: 409 }
      );
    }

    if (await getUserByEmail(cleanSecondaryEmail)) {
      return NextResponse.json(
        { error: `${cleanSecondaryEmail} already has a Ticket Manager login.` },
        { status: 409 }
      );
    }
  }

  // The account is created first: an employee with no way to sign in would be
  // a directory entry that does nothing.
  if (isClient) {
    const account = await createClientAccount({ name: cleanName, email: cleanEmail });

    const employee = await createEmployee({
      name: cleanName,
      email: cleanEmail,
      secondary_email: cleanSecondaryEmail,
      role,
      department: '',
      title: '',
      base_salary: null,
      salary_currency: 'USD',
      last_payment_date: null,
      payment_status: '',
      user_id: account.id,
      workspace_id: workspace_id ? Number(workspace_id) : null,
    });

    // A client authenticates with one passkey, emailed to the address if provided.
    // There is no temporary password to change at first login.
    const passkey = await issueClientPasskey(account.id);
    let sent = false;
    let mail = null;

    if (cleanEmail) {
      mail = await sendClientPasskey({
        client: employee,
        passkey,
        actorName: session.user.name,
      });
      sent = mail?.status === 'sent';

      if (!sent) {
        console.error(
          `[employees] client ${cleanEmail} created but passkey not delivered (${mail?.status || 'unknown'}): ${
            mail?.error || 'SMTP is not configured'
          }`
        );
      }
    }

    return NextResponse.json(
      {
        employee,
        invite: {
          sent,
          status: cleanEmail ? (mail?.status || 'unknown') : 'not_applicable',
          error: sent
            ? null
            : cleanEmail
            ? mail?.error || 'SMTP is not configured, so no email was sent.'
            : 'No email address provided for this client.',
        },
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
    user_id: account.id,
    employment_type: employment_type || 'full_time',
    workspace_id: workspace_id ? Number(workspace_id) : null,
  });

  // Automatically allocate leave balances for the employee's workspace
  try {
    await ensureEmployeeLeaveBalances(employee.id);
  } catch (err) {
    console.error('[employees] Initial leave balance allocation failed:', err);
  }

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