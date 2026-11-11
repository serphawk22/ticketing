import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getManagerOverview } from '@/lib/monitoring';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  try {
    const overview = await getManagerOverview({
      user: session.user,
      from: params.get('from'),
      to: params.get('to'),
      preset: params.get('preset') || 'this_month',
    });
    return NextResponse.json(overview);
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to load manager overview.' }, { status: err.statusCode || 403 });
  }
}
