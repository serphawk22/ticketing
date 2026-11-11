import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isAdminOrOwner } from '@/lib/rbac';
import { verifyBaselineSchedule } from '@/lib/businessScheduleService';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminOrOwner(session.user)) {
    return NextResponse.json(
      { error: 'Forbidden: Only Business Owners or Administrators can verify the baseline schedule.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  try {
    const baseline = await verifyBaselineSchedule({
      actor: session.user,
      workspaceId: body.workspaceId ?? body.workspace_id ?? null,
      effectiveFrom: body.effective_from ?? body.effectiveFrom,
      workStartTime: body.work_start_time ?? body.workStartTime ?? null,
      workEndTime: body.work_end_time ?? body.workEndTime ?? null,
      workingDays: body.working_days ?? body.workingDays ?? null,
      reason: body.reason || '',
    });
    return NextResponse.json({ ok: true, baseline });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Baseline verification failed.' }, { status: 400 });
  }
}
