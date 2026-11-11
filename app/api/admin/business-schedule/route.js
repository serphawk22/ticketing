import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isAdminOrOwner, isTeamUser } from '@/lib/rbac';
import { createScheduleVersion, loadScheduleContext } from '@/lib/businessScheduleService';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isTeamUser(session.user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const workspaceId = new URL(request.url).searchParams.get('workspaceId');
  const context = await loadScheduleContext(workspaceId ? Number(workspaceId) : null);

  const baseline = context.schedules[0] || null;
  const active = context.schedules[context.schedules.length - 1] || null;

  return NextResponse.json({
    schedules: context.schedules,
    holidays: context.holidays,
    baseline,
    active,
    isBaselineVerified: baseline?.effective_date_status === 'owner_confirmed',
  });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminOrOwner(session.user)) {
    return NextResponse.json(
      { error: 'Forbidden: Only Business Owners or Administrators can update the working schedule.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  try {
    const schedule = await createScheduleVersion({
      actor: session.user,
      workspaceId: body.workspaceId ?? body.workspace_id ?? null,
      effectiveFrom: body.effective_from ?? body.effectiveFrom,
      workStartTime: body.work_start_time ?? body.workStartTime ?? '09:00',
      workEndTime: body.work_end_time ?? body.workEndTime ?? '17:00',
      workingDays: body.working_days ?? body.workingDays ?? [1, 2, 3, 4, 5, 6],
      reason: body.reason || '',
    });
    return NextResponse.json({ ok: true, schedule }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Invalid schedule payload.' }, { status: 400 });
  }
}
