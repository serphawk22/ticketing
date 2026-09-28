import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployees, createEmployee, getEmployeeByEmail } from '@/lib/employees';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['admin', 'developer'];

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

  if (await getEmployeeByEmail(cleanEmail)) {
    return NextResponse.json(
      { error: `${cleanEmail} is already in the directory.` },
      { status: 409 }
    );
  }

  const employee = await createEmployee({
    name: cleanName,
    email: cleanEmail,
    role,
    department: String(department ?? '').trim(),
    title: String(title ?? '').trim(),
  });

  return NextResponse.json({ employee }, { status: 201 });
}
