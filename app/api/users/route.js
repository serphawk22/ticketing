import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { isAdminOrOwner } from '@/lib/rbac';

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminOrOwner(session.user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await db.prepare('SELECT id, name, email, role FROM users').all();
  return NextResponse.json({ users });
}