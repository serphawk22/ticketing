import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getClientRequestQueue } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';

export const dynamic = 'force-dynamic';

/**
 * The client request queue.
 *
 * Admin-only, and it answers two questions at once: which client requests are
 * still unrouted, and who could take one. The assignee list comes back with the
 * queue so the sidebar can offer a developer without a second round trip.
 */
export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [requests, employees] = await Promise.all([
    getClientRequestQueue(),
    getEmployees({ includeInactive: false }),
  ]);

  return NextResponse.json({
    count: requests.length,
    requests,
    // Clients raise work, they do not take it, so they are never offered here.
    assignable: employees
      .filter((e) => e.role !== 'client')
      .map((e) => ({ id: e.id, name: e.name })),
  });
}