import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  createClientRequestDoc,
  duplicateClientRequestDoc,
  getClientRequestDocs,
} from '@/lib/clientRequestDocs';

export const dynamic = 'force-dynamic';

async function adminSession() {
  const session = await requireAuth();
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (session.user.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const { error } = await adminSession();
  if (error) return error;
  return NextResponse.json({ docs: await getClientRequestDocs() });
}

export async function POST(request) {
  const { session, error } = await adminSession();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  try {
    const doc = body.duplicate_of
      ? await duplicateClientRequestDoc(body.duplicate_of, session.user.id)
      : await createClientRequestDoc({
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
