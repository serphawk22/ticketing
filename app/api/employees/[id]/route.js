import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getEmployee,
  updateEmployee,
  setEmployeeActive,
  deleteEmployee,
  employeeTicketCount,
  getEmployeeByEmail,
} from '@/lib/employees';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['admin', 'developer'];

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

  const assigned = await employeeTicketCount(id);
  if (assigned > 0) {
    return NextResponse.json(
      {
        error: `${existing.name} still has ${assigned} assigned ${
          assigned === 1 ? 'ticket' : 'tickets'
        }. Reassign them or deactivate the employee instead.`,
      },
      { status: 409 }
    );
  }

  await deleteEmployee(id);
  return NextResponse.json({ deleted: true });
}
