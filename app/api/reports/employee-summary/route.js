import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployeeDashboardSummary } from '@/lib/analytics';
import { getEmployeeByUserId } from '@/lib/employees';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const preset = searchParams.get('preset') || 'this_month';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  const projectId = searchParams.get('projectId') || 'all';

  const employee = await getEmployeeByUserId(session.user.id);

  const summary = await getEmployeeDashboardSummary({
    userId: session.user.id,
    employeeId: employee?.id || null,
    preset,
    startDate,
    endDate,
    projectId,
  });

  return NextResponse.json(summary);
}

