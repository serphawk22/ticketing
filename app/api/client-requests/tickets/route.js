import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getClientRequestTickets,
  getArchivedClientRequestTickets,
} from '@/lib/tickets';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const archived = new URL(request.url).searchParams.get('archived') === '1';
  const tickets = archived
    ? await getArchivedClientRequestTickets()
    : await getClientRequestTickets();

  return NextResponse.json({ tickets });
}
