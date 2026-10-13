import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { deleteDoc, getDoc, moveDoc, updateDoc } from '@/lib/docs';

export const dynamic = 'force-dynamic';

async function teamSession() {
  const session = await requireAuth();
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (session.user.role === 'client') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { session };
}

async function load(params) {
  const { id, docId } = await params;
  const project = await getProject(id);
  if (!project) return { error: NextResponse.json({ error: 'Project not found.' }, { status: 404 }) };
  const doc = await getDoc(project.id, docId);
  if (!doc) return { error: NextResponse.json({ error: 'Doc not found.' }, { status: 404 }) };
  return { project, doc };
}

export async function GET(_request, { params }) {
  const { error: authError } = await teamSession();
  if (authError) return authError;
  const { error, doc } = await load(params);
  if (error) return error;
  return NextResponse.json({ doc });
}

export async function PATCH(request, { params }) {
  const { session, error: authError } = await teamSession();
  if (authError) return authError;
  const { error, project, doc } = await load(params);
  if (error) return error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid doc.' }, { status: 400 });
  }

  try {
    const updated = body.move === 'up' || body.move === 'down'
      ? await moveDoc(project.id, doc.id, body.move)
      : await updateDoc(project.id, doc.id, body, session.user.id);
    return NextResponse.json({ doc: updated });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 400 });
  }
}

export async function DELETE(_request, { params }) {
  const { error: authError } = await teamSession();
  if (authError) return authError;
  const { error, project, doc } = await load(params);
  if (error) return error;
  await deleteDoc(project.id, doc.id);
  return NextResponse.json({ deleted: true, parent_id: doc.parent_id });
}
