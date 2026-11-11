import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isAdminOrOwner } from '@/lib/rbac';
import { applyStageCorrection, getTicketTimeAudit } from '@/lib/ticketStageService';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isAdminOrOwner(session.user)) {
    return NextResponse.json(
      { error: 'Forbidden: Only Business Owners or Administrators can correct historical stage durations.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const ticketId = Number(id);
  const body = await request.json().catch(() => ({}));

  try {
    const correction = await applyStageCorrection({
      ticketId,
      stageHistoryId: body.stage_history_id ?? body.stageHistoryId,
      correctedEntryAt: body.corrected_entry_at ?? body.correctedEntryAt ?? null,
      correctedExitAt: body.corrected_exit_at ?? body.correctedExitAt ?? null,
      correctedToStatus: body.corrected_to_status ?? body.correctedToStatus ?? null,
      reason: body.reason || '',
      actor: session.user,
    });
    const audit = await getTicketTimeAudit(ticketId);
    return NextResponse.json({ ok: true, correction, audit }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Stage correction failed.' },
      { status: 400 }
    );
  }
}
