import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationsRead,
} from '@/lib/notifications';

export const dynamic = 'force-dynamic';

// The bell is a team feature: clients never see it (requireTeamUser sends them
// to their portal), and admins and developers see every event in the system
// rather than only the ones touching their own tickets.
async function requireTeamSession() {
  const session = await requireAuth();
  if (!session) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (session.user.role !== 'admin' && session.user.role !== 'developer') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { session };
}

export async function GET(request) {
  const { session, error } = await requireTeamSession();
  if (error) return error;

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit')) || 20;
  const before = url.searchParams.get('before');

  const { notifications, hasMore } = await getNotifications(session.user.id, {
    limit,
    before: before ? Number(before) : null,
  });
  const unreadCount = await getUnreadNotificationCount(session.user.id);

  return NextResponse.json({ notifications, unreadCount, hasMore });
}

// Marking read is per user: the WHERE clause always carries the caller's
// user_id, so one person clearing their bell never touches anyone else's
// unread state.
export async function POST(request) {
  const { session, error } = await requireTeamSession();
  if (error) return error;

  const body = await request.json().catch(() => ({}));

  if (body.all === true) {
    const markedRead = await markAllNotificationsRead(session.user.id);
    return NextResponse.json({ markedRead, unreadCount: 0 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids
    : body.id != null
      ? [body.id]
      : [];
  const markedRead = ids.length
    ? await markNotificationsRead(session.user.id, ids)
    : 0;
  const unreadCount = await getUnreadNotificationCount(session.user.id);

  return NextResponse.json({ markedRead, unreadCount });
}
