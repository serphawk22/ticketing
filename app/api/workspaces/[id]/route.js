import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getWorkspace, updateWorkspace, deleteWorkspace } from '@/lib/workspaces';
import { isValidProjectColor } from '@/lib/projectValidation';

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can edit workspaces.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const existing = await getWorkspace(id);
  if (!existing) {
    return NextResponse.json({ error: 'Workspace not found.' }, { status: 404 });
  }

  const { name, description, color } = await request.json();

  if (name !== undefined && !name?.trim()) {
    return NextResponse.json(
      { error: 'Workspace name is required.' },
      { status: 400 }
    );
  }

  if (color !== undefined && !isValidProjectColor(color)) {
    return NextResponse.json(
      { error: 'Workspace color must be a hex value.' },
      { status: 400 }
    );
  }

  const workspace = await updateWorkspace(id, {
    name: name === undefined ? existing.name : name.trim(),
    description:
      description === undefined ? existing.description : String(description).trim(),
    color: color === undefined ? existing.color : color,
  });

  return NextResponse.json({ workspace });
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can delete workspaces.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const existing = await getWorkspace(id);
  if (!existing) {
    return NextResponse.json({ error: 'Workspace not found.' }, { status: 404 });
  }

  const detached = await deleteWorkspace(id);

  return NextResponse.json({ deleted: true, detachedProjects: detached });
}
