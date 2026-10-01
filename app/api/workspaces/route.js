import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getAllWorkspaces, createWorkspace, getWorkspaceByKey } from '@/lib/workspaces';
import { isValidProjectKey, isValidProjectColor } from '@/lib/projectValidation';

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({ workspaces: await getAllWorkspaces() });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can create workspaces.' },
      { status: 403 }
    );
  }

  const { key, name, description = '', color } = await request.json();
  const workspaceKey = String(key ?? '').trim().toUpperCase();

  if (!isValidProjectKey(workspaceKey)) {
    return NextResponse.json(
      { error: 'Workspace key must be 2-6 letters or numbers.' },
      { status: 400 }
    );
  }

  if (!name?.trim()) {
    return NextResponse.json(
      { error: 'Workspace name is required.' },
      { status: 400 }
    );
  }

  if (!isValidProjectColor(color)) {
    return NextResponse.json(
      { error: 'Workspace color must be a hex value.' },
      { status: 400 }
    );
  }

  if (await getWorkspaceByKey(workspaceKey)) {
    return NextResponse.json(
      { error: `Workspace key ${workspaceKey} is already in use.` },
      { status: 409 }
    );
  }

  const workspace = await createWorkspace({
    key: workspaceKey,
    name: name.trim(),
    description: String(description ?? '').trim(),
    color,
  });

  return NextResponse.json({ workspace }, { status: 201 });
}
