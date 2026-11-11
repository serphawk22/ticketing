import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployeeMonitoringDetail } from '@/lib/monitoring';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const search = new URL(request.url).searchParams;

  try {
    const detail = await getEmployeeMonitoringDetail({
      user: session.user,
      employeeId: id,
      from: search.get('from'),
      to: search.get('to'),
      preset: search.get('preset') || 'this_month',
    });
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to load employee monitoring.' },
      { status: err.statusCode || 400 }
    );
  }
}
