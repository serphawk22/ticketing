import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getAttendanceReconciliation } from '@/lib/reconciliation';
import { resolveMonitoringWindow } from '@/lib/monitoring';
import { getEmployeeIdForUser, resolveUserScope } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scope = await resolveUserScope(session.user);
  if (scope.isClient) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const win = resolveMonitoringWindow({
    from: params.get('from'),
    to: params.get('to'),
    preset: params.get('preset') || 'this_month',
  });

  const requestedEmpId = params.get('employee_id') || params.get('employeeId');
  let employeeIds = null;

  if (scope.isEmployee) {
    const selfEmpId = await getEmployeeIdForUser(session.user.id);
    if (!selfEmpId) {
      return NextResponse.json({ error: 'Employee profile not linked.' }, { status: 404 });
    }
    if (requestedEmpId && Number(requestedEmpId) !== selfEmpId) {
      return NextResponse.json({ error: 'Forbidden: you can only view your own reconciliation.' }, { status: 403 });
    }
    employeeIds = [selfEmpId];
  } else if (scope.isManager) {
    if (requestedEmpId) {
      const targetId = Number(requestedEmpId);
      if (!scope.scopedEmployeeIds.has(targetId)) {
        return NextResponse.json({ error: 'Forbidden: employee is outside your management scope.' }, { status: 403 });
      }
      employeeIds = [targetId];
    } else {
      employeeIds = Array.from(scope.scopedEmployeeIds);
    }
  } else if (requestedEmpId) {
    const targetId = Number(requestedEmpId);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return NextResponse.json({ error: 'Invalid employee_id.' }, { status: 400 });
    }
    employeeIds = [targetId];
  }

  const data = await getAttendanceReconciliation({
    employeeIds,
    fromDate: win.fromDate,
    toDate: win.toDate,
  });

  return NextResponse.json(data);
}
