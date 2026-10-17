import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { createDoc, duplicateDoc, getProjectDocs } from '@/lib/docs';

export const dynamic = 'force-dynamic';

async function teamSession() {
  const session = await requireAuth();
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (session.user.role === 'client') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { session };
}

export async function GET(_request, { params }) {
  const { error } = await teamSession();
  if (error) return error;

  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  return NextResponse.json({ docs: await getProjectDocs(project.id) });
}

export async function POST(request, { params }) {
  const { session, error } = await teamSession();
  if (error) return error;

  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  try {
    const doc = body.duplicate_of
      ? await duplicateDoc(project.id, body.duplicate_of, session.user.id)
      : await createDoc({
          projectId: project.id,
          parentId: body.parent_id || null,
          title: body.title || '',
          body: body.body || '',
          userId: session.user.id,
        });
    if (!doc) return NextResponse.json({ error: 'Doc not found.' }, { status: 404 });
    return NextResponse.json({ doc }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 400 });
  }
}
