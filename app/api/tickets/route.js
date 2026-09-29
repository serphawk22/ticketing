import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getAllTickets, getTicket } from '@/lib/tickets';
import { employeeExists, getEmployee } from '@/lib/employees';
import { notifyAssignment } from '@/lib/mail';

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_TYPES = ['task', 'bug', 'story', 'epic'];

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    role: session.user.role,
    tickets: await getAllTickets(),
  });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can create tickets.' }, { status: 403 });
  }

  const {
    title,
    description,
    priority = 'medium',
    type = 'task',
    project_id = null,
    employee_id = null,
  } = await request.json();

  if (!title?.trim() || !description?.trim()) {
    return NextResponse.json({ error: 'Title and description are required.' }, { status: 400 });
  }

  if (!VALID_PRIORITIES.includes(priority)) {
    return NextResponse.json({ error: 'Invalid priority.' }, { status: 400 });
  }

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid type.' }, { status: 400 });
  }

  if (employee_id && !await employeeExists(employee_id)) {
    return NextResponse.json(
      { error: 'Employee not found or deactivated.' },
      { status: 400 }
    );
  }

  const info = await db
    .prepare(
      `INSERT INTO tickets (title, description, priority, type, created_by, project_id, employee_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title.trim(),
      description.trim(),
      priority,
      type,
      session.user.id,
      project_id || null,
      employee_id || null
    );

  const ticket = await getTicket(info.lastInsertRowid);

  let notification = null;
  if (employee_id) {
    const employee = await getEmployee(employee_id);
    notification = await notifyAssignment({
      ticket,
      employee,
      actorName: session.user.name,
      trigger: 'assignment',
    });
  }

  return NextResponse.json({ ticket, notification }, { status: 201 });
}
