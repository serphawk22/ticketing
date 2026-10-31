import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getEmployee,
  updateEmployee,
  setEmployeeActive,
  deleteEmployee,
  employeeTicketCount,
  unassignEmployeeTickets,
  getEmployeeByEmail,
  toSafeEmployee,
} from '@/lib/employees';
import {
  getUserByEmail,
  syncUserFromEmployee,
  deleteUserByEmail,
  deleteUserSessions,
  getUserById,
  purgeUserSafely,
} from '@/lib/users';
import { syncEmployeeEmploymentTypeLeaveEligibility } from '@/lib/attendance';
import { db } from '@/lib/db';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Clients are accounts too: they live in the same directory so one page
// manages every login, but they are never assignable work.
const VALID_ROLES = ['admin', 'developer', 'client'];

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  const isAdmin = session.user.role === 'admin';
  const isSelf =
    (session.user.id && employee.user_id && session.user.id === employee.user_id) ||
    (session.user.email && employee.email && session.user.email === employee.email);

  // Non-admins can only see sensitive salary/payment info for themselves
  const canSeeSalary = isAdmin || isSelf;

  // Permitted profile details (age, github, linkedin, avatar)
  let profile = null;
  const user = employee.user_id
    ? await getUserById(employee.user_id)
    : await getUserByEmail(employee.email);
  if (user) {
    try {
      profile = await db
        .prepare('SELECT avatar_url, age, github_url, linkedin_url FROM user_profiles WHERE user_id = ?')
        .get(user.id);
    } catch {
      // Table might not exist yet
    }
  }

  const safeEmployee = toSafeEmployee(employee, canSeeSalary);

  return NextResponse.json({
    employee: {
      ...safeEmployee,
      joined_at: user?.created_at || employee.created_at,
      avatar_url: profile?.avatar_url || '',
      age: profile?.age ?? null,
      github_url: profile?.github_url || '',
      linkedin_url: profile?.linkedin_url || '',
    },
  });
}

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can edit employees.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const existing = await getEmployee(id);
  if (!existing) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  const body = await request.json();

  if (body.active !== undefined && Object.keys(body).length === 1) {
    return NextResponse.json({ employee: await setEmployeeActive(id, Boolean(body.active)) });
  }

  const name = body.name === undefined ? existing.name : String(body.name).trim();
  const rawEmail =
    body.email !== undefined
      ? body.email !== null
        ? String(body.email).trim()
        : ''
      : existing.email || '';
  const email = rawEmail ? rawEmail.toLowerCase() : null;
  const role = body.role === undefined ? existing.role : body.role;
  const isClient = role === 'client';

  const department = isClient
    ? ''
    : body.department === undefined
    ? existing.department
    : String(body.department).trim();
  const title = isClient
    ? ''
    : body.title === undefined
    ? existing.title
    : String(body.title).trim();
  const active = body.active === undefined ? Boolean(existing.active) : Boolean(body.active);

  const base_salary = isClient
    ? null
    : body.base_salary !== undefined
    ? body.base_salary !== null && body.base_salary !== ''
      ? Number(body.base_salary)
      : null
    : existing.base_salary;

  const salary_currency = isClient
    ? 'USD'
    : body.salary_currency !== undefined
    ? String(body.salary_currency).trim().toUpperCase()
    : existing.salary_currency || 'USD';

  const last_payment_date = isClient
    ? null
    : body.last_payment_date !== undefined
    ? body.last_payment_date || null
    : existing.last_payment_date;

  const payment_status = isClient
    ? ''
    : body.payment_status !== undefined
    ? String(body.payment_status).trim()
    : existing.payment_status;

  const rawSecondary =
    body.secondary_email !== undefined
      ? body.secondary_email !== null
        ? String(body.secondary_email).trim()
        : ''
      : existing.secondary_email || '';
  const secondary_email = isClient ? (rawSecondary ? rawSecondary.toLowerCase() : null) : null;

  if (!name) {
    return NextResponse.json({ error: 'Employee name is required.' }, { status: 400 });
  }

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Role must be admin, developer or client.' }, { status: 400 });
  }

  if (!isClient && body.secondary_email !== undefined && body.secondary_email !== null && String(body.secondary_email).trim() !== '') {
    return NextResponse.json({ error: 'Secondary email is only applicable for clients.' }, { status: 400 });
  }

  if (!isClient) {
    if (!email) {
      return NextResponse.json({ error: 'Email is required for employees.' }, { status: 400 });
    }
    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }
  } else {
    if (!email) {
      return NextResponse.json({ error: 'Primary email is required for clients.' }, { status: 400 });
    }
    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }
    if (secondary_email && !EMAIL_PATTERN.test(secondary_email)) {
      return NextResponse.json({ error: 'A valid secondary email address is required.' }, { status: 400 });
    }
    if (email && secondary_email && email === secondary_email) {
      return NextResponse.json({ error: 'Secondary email must be different from primary email.' }, { status: 400 });
    }
  }

  if (base_salary !== null && (Number.isNaN(base_salary) || base_salary < 0)) {
    return NextResponse.json({ error: 'Base salary must be a positive number.' }, { status: 400 });
  }

  if (email) {
    const clash = await getEmployeeByEmail(email);
    if (clash && clash.id !== existing.id) {
      return NextResponse.json(
        { error: `${email} is already in the directory.` },
        { status: 409 }
      );
    }
  }

  if (secondary_email) {
    const clash = await getEmployeeByEmail(secondary_email);
    if (clash && clash.id !== existing.id) {
      return NextResponse.json(
        { error: `${secondary_email} is already in the directory.` },
        { status: 409 }
      );
    }
  }

  const VALID_EMPLOYMENT_TYPES = ['full_time', 'part_time', 'intern', 'probation', 'freelancer'];
  const employment_type =
    body.employment_type !== undefined
      ? String(body.employment_type).trim().toLowerCase()
      : existing.employment_type || 'full_time';

  if (body.employment_type !== undefined && !VALID_EMPLOYMENT_TYPES.includes(employment_type)) {
    return NextResponse.json(
      { error: `Invalid employment type "${body.employment_type}". Allowed values: ${VALID_EMPLOYMENT_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  const workspace_id =
    body.workspace_id !== undefined
      ? body.workspace_id ? Number(body.workspace_id) : null
      : existing.workspace_id;

  const employee = await updateEmployee(id, {
    name,
    email,
    secondary_email,
    role,
    department,
    title,
    active,
    base_salary,
    salary_currency,
    last_payment_date,
    payment_status,
    employment_type,
    workspace_id,
  });

  // Automatically allocate leave entitlements if employment type or workspace changes
  const employmentTypeChanged = body.employment_type && body.employment_type !== existing.employment_type;
  const workspaceChanged = body.workspace_id !== undefined && Number(body.workspace_id) !== Number(existing.workspace_id);
  if (employmentTypeChanged || workspaceChanged) {
    try {
      await syncEmployeeEmploymentTypeLeaveEligibility({
        employeeId: id,
        oldType: existing.employment_type,
        newType: employment_type,
        newWorkspaceId: workspace_id,
        adminUser: session.user,
      });
    } catch (allocErr) {
      console.error('[employees] Automatic leave allocation on transition error:', allocErr);
    }
  }

  // Mirror the change onto the login account
  const linkedUser = existing.user_id
    ? await getUserById(existing.user_id)
    : await getUserByEmail(existing.email);
  if (linkedUser) {
    try {
      await syncUserFromEmployee({
        email,
        previousEmail: existing.email,
        name,
        role,
        userId: linkedUser.id,
      });
    } catch (error) {
      console.error(`[employees] could not sync login for ${existing.email || existing.name}:`, error);
      return NextResponse.json(
        {
          error:
            'The directory entry was saved but the linked login could not be updated. Check the new email address is not already in use.',
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ employee });
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can remove employees.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const existing = await getEmployee(id);
  if (!existing) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  // Removing yourself would delete the account making the request.
  const isRemovingSelf =
    (session.user.id && existing.user_id && session.user.id === existing.user_id) ||
    (session.user.email && existing.email && session.user.email.toLowerCase() === existing.email.toLowerCase());
  if (isRemovingSelf) {
    return NextResponse.json(
      { error: 'You cannot remove your own account.' },
      { status: 400 }
    );
  }

  try {
    // 1. Identify all user account IDs associated with this employee
    const userIds = new Set();
    if (existing.user_id) {
      userIds.add(Number(existing.user_id));
    }
    if (existing.email) {
      const u = await getUserByEmail(existing.email);
      if (u) userIds.add(Number(u.id));
    }

    const userIdList = Array.from(userIds);

    // 2. Unassign tickets from employee & linked user accounts
    const unassigned = await unassignEmployeeTickets(id, userIdList);

    // 3. Purge linked user account(s) safely before deleting the directory entry
    for (const uid of userIdList) {
      if (uid !== session.user.id) {
        await purgeUserSafely(uid, session.user.id);
      }
    }

    // 4. Permanently delete the employee directory record
    await deleteEmployee(id);

    return NextResponse.json({ deleted: true, unassigned, name: existing.name });
  } catch (error) {
    console.error(`[employees] failed to permanently remove ${existing.email || existing.name}:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to remove employee.' },
      { status: 500 }
    );
  }
}
