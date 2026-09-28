import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getProject, updateProject, deleteProject } from '@/lib/projects';
import { isValidProjectColor } from '@/lib/projectValidation';

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can edit projects.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const existing = getProject(id);
  if (!existing) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const { name, description, color } = await request.json();

  if (name !== undefined && !name?.trim()) {
    return NextResponse.json({ error: 'Project name is required.' }, { status: 400 });
  }

  if (color !== undefined && !isValidProjectColor(color)) {
    return NextResponse.json({ error: 'Project color must be a hex value.' }, { status: 400 });
  }

  const project = updateProject(id, {
    name: name === undefined ? existing.name : name.trim(),
    description:
      description === undefined ? existing.description : String(description).trim(),
    color: color === undefined ? existing.color : color,
  });

  return NextResponse.json({ project });
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can delete projects.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const existing = getProject(id);
  if (!existing) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const detached = deleteProject(id);

  return NextResponse.json({ deleted: true, detachedTickets: detached });
}
