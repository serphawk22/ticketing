import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getArchivedTickets } from '@/lib/tickets';

export const dynamic = 'force-dynamic';

// Backs the "Archived work items" view. Archived rows stay in the database and
// come back through this route rather than through the project list, which
// filters them out.
export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({ tickets: await getArchivedTickets() });
}
