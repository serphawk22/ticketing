import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getReportExecutionData } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { report: slug } = await params;
  const { searchParams } = new URL(request.url);

  const filters = {
    preset: searchParams.get('preset') || 'this_month',
    startDate: searchParams.get('startDate') || '',
    endDate: searchParams.get('endDate') || '',
    projectId: searchParams.get('projectId') || 'all',
    employeeId: searchParams.get('employeeId') || 'all',
    department: searchParams.get('department') || 'all',
    status: searchParams.get('status') || 'all',
    priority: searchParams.get('priority') || 'all',
    clientId: searchParams.get('clientId') || 'all',
    search: searchParams.get('search') || '',
  };

  try {
    const data = await getReportExecutionData({
      reportSlug: slug,
      filters,
      currentUser: session.user,
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error(`Report execution error (${slug}):`, err);
    const status = err.message.includes('Access denied') || err.message.includes('authorization') ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
