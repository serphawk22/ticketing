import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { deleteDailyNote, updateDailyNote } from '@/lib/dailyNotes';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const note = await updateDailyNote({
      user: session.user,
      noteId: id,
      body: body.body,
      category: body.category,
    });
    return NextResponse.json({ note });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to update note.' },
      { status: err.statusCode || 500 }
    );
  }
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  try {
    const result = await deleteDailyNote({
      user: session.user,
      noteId: id,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to delete note.' },
      { status: err.statusCode || 500 }
    );
  }
}
