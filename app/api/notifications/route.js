import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
  markAllNotificationsRead,
} from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const limit = url.searchParams.get('limit');
  const before = url.searchParams.get('before');

  const { notifications, hasMore } = await getNotifications(session.user.id, {
    limit: limit ? Number(limit) : undefined,
    before: before ? Number(before) : undefined,
  });
  const unreadCount = await getUnreadNotificationCount(session.user.id);

  return NextResponse.json({ notifications, unreadCount, hasMore });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  if (body.all === true) {
    const changed = await markAllNotificationsRead(session.user.id);
    return NextResponse.json({ changed });
  }

  if (body.id !== undefined && body.id !== null) {
    const changed = await markNotificationsRead(session.user.id, [body.id]);
    return NextResponse.json({ changed });
  }

  return NextResponse.json({ error: 'No notification id or all flag provided.' }, { status: 400 });
}
