import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import {
  createDefaultSidebarPreferences,
  normalizeSidebarPreferences,
} from '@/lib/sidebarPreferences';

export const dynamic = 'force-dynamic';

async function readPreferences(userId) {
  const row = await db
    .prepare('SELECT sidebar FROM user_preferences WHERE user_id = ?')
    .get(userId);
  return row ? normalizeSidebarPreferences(row.sidebar) : createDefaultSidebarPreferences();
}

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({ preferences: await readPreferences(session.user.id) });
}

export async function PUT(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const preferences = normalizeSidebarPreferences(
    body?.preferences !== undefined ? body.preferences : body
  );
  const sidebar = JSON.stringify(preferences);

  if (sidebar.length > 20000) {
    return NextResponse.json({ error: 'Sidebar preferences are too large.' }, { status: 400 });
  }

  const updated = await db
    .prepare(
      "UPDATE user_preferences SET sidebar = ?, updated_at = datetime('now') WHERE user_id = ?"
    )
    .run(sidebar, session.user.id);

  if (!updated.rowCount) {
    await db
      .prepare('INSERT INTO user_preferences (user_id, sidebar) VALUES (?, ?)')
      .run(session.user.id, sidebar);
  }

  return NextResponse.json({ preferences });
}
