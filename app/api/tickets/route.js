import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getAllTickets } from '@/lib/tickets';
import { projectExists } from '@/lib/projects';

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    role: session.user.role,
    tickets: getAllTickets(),
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
    assigned_to,
    project_id = null,
  } = await request.json();

  if (!title?.trim() || !description?.trim()) {
    return NextResponse.json({ error: 'Title and description are required.' }, { status: 400 });
  }

  if (project_id && !projectExists(project_id)) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 400 });
  }

  const info = db
    .prepare(
      `INSERT INTO tickets (title, description, priority, created_by, assigned_to, project_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      title.trim(),
      description.trim(),
      priority,
      session.user.id,
      assigned_to || null,
      project_id || null
    );

  const ticket = db
    .prepare('SELECT * FROM tickets WHERE id = ?')
    .get(info.lastInsertRowid);

  return NextResponse.json({ ticket }, { status: 201 });
}