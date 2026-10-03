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
} from '@/lib/employees';
import {
  getUserByEmail,
  syncUserFromEmployee,
  deleteUserByEmail,
  deleteUserSessions,
} from '@/lib/users';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Clients are accounts too: they live in the same directory so one page
// manages every login, but they are never assignable work.
const VALID_ROLES = ['admin', 'developer', 'client'];

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
  const email =
    body.email === undefined ? existing.email : String(body.email).trim().toLowerCase();
  const role = body.role === undefined ? existing.role : body.role;
  const department =
    body.department === undefined ? existing.department : String(body.department).trim();
  const title = body.title === undefined ? existing.title : String(body.title).trim();
  const active = body.active === undefined ? Boolean(existing.active) : Boolean(body.active);

  if (!name) {
    return NextResponse.json({ error: 'Employee name is required.' }, { status: 400 });
  }

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
  }

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Role must be admin or developer.' }, { status: 400 });
  }

  const clash = await getEmployeeByEmail(email);
  if (clash && clash.id !== existing.id) {
    return NextResponse.json(
      { error: `${email} is already in the directory.` },
      { status: 409 }
    );
  }

  const employee = await updateEmployee(id, { name, email, role, department, title, active });

  // Mirror the change onto the login account, keyed by the email it had before
  // the edit: renaming the address moves both rows or login breaks.
  if (await getUserByEmail(existing.email)) {
    try {
      await syncUserFromEmployee({
        email,
        previousEmail: existing.email,
        name,
        role,
      });
    } catch (error) {
      console.error(`[employees] could not sync login for ${existing.email}:`, error);
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
  if (session.user.email === existing.email) {
    return NextResponse.json(
      { error: 'You cannot remove your own account.' },
      { status: 400 }
    );
  }

  // Body is optional: without it the old behaviour stands and an employee who
  // still owns work is refused rather than silently stripped of it.
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const assigned = await employeeTicketCount(id);

  if (assigned > 0 && body.reassign !== 'unassign') {
    return NextResponse.json(
      {
        error: `${existing.name} still has ${assigned} assigned ${
          assigned === 1 ? 'ticket' : 'tickets'
        }. Reassign them or deactivate the employee instead.`,
        assigned,
      },
      { status: 409 }
    );
  }

  // Unassign before deleting so no ticket is left pointing at a missing row.
  const unassigned = assigned > 0 ? await unassignEmployeeTickets(id) : 0;

  await deleteEmployee(id);

  // The directory entry and the login account are separate tables joined by
  // email, so removing one without the other would leave someone able to sign
  // in to a workspace they are no longer part of.
  try {
    const account = await getUserByEmail(existing.email);
    if (account) {
      await deleteUserSessions(account.id);
      await deleteUserByEmail(existing.email);
    }
  } catch (error) {
    console.error(`[employees] removed ${existing.email} but could not delete login:`, error);
    return NextResponse.json(
      {
        error:
          'The employee was removed from the directory but their login could not be deleted. Remove it manually to revoke access.',
        unassigned,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ deleted: true, unassigned, name: existing.name });
}
