import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getAllProjects, createProject, getProjectByKey } from '@/lib/projects';
import { isValidProjectKey, isValidProjectColor } from '@/lib/projectValidation';

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({ projects: getAllProjects() });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can create projects.' },
      { status: 403 }
    );
  }

  const { key, name, description = '', color } = await request.json();
  const projectKey = String(key ?? '').trim().toUpperCase();

  if (!isValidProjectKey(projectKey)) {
    return NextResponse.json(
      { error: 'Project key must be 2-6 letters or numbers.' },
      { status: 400 }
    );
  }

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Project name is required.' }, { status: 400 });
  }

  if (!isValidProjectColor(color)) {
    return NextResponse.json({ error: 'Project color must be a hex value.' }, { status: 400 });
  }

  if (getProjectByKey(projectKey)) {
    return NextResponse.json(
      { error: `Project key ${projectKey} is already in use.` },
      { status: 409 }
    );
  }

  const project = createProject({
    key: projectKey,
    name: name.trim(),
    description: String(description ?? '').trim(),
    color,
  });

  return NextResponse.json({ project }, { status: 201 });
}
